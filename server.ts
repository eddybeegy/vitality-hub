import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import axios from "axios";
import qs from "qs";
import { execFile } from "child_process";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import fs from "fs";
import { parse } from "csv-parse/sync";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { GoogleGenAI } from "@google/genai";
import NodeCache from "node-cache";
import { EventEmitter } from "events";
import { modules } from "./modules";
import { DataSourceModule } from "./modules/types";
import { syncQueue } from "./src/lib/taskQueue.js";
import { AI_MODELS, METRIC_MAP } from "./src/constants";
import { AI_PROVIDERS } from "./ai_providers/index";
import { probeProvider } from "./ai_providers/openai_compatible";
import { setupDb } from "./src/lib/db";

// Increase MaxListeners limit to prevent TLSSocket warnings during concurrent API sync chunks
EventEmitter.defaultMaxListeners = 50;

// Default timeout for all outbound axios requests so a hung upstream can't stall
// a sync indefinitely. Long-running AI generation calls override this per-request.
axios.defaults.timeout = 60000;

export const db = setupDb();

// ── Password hashing (scrypt, no external dependency) ────────────────────────
const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}



const summaryCache = new Map<number, { data: any, timestamp: number }>();
const metricsCache = new NodeCache({ stdTTL: 300 }); // 5 minutes
const activeSyncs = new Set<number>();

// Log rotation and file logging setup
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

function getLogFilePath() {
  const today = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `system-${today}.log`);
}

// Cleanup old logs (keep 7 days)
function rotateLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = new Date();
    files.forEach(file => {
      if (file.startsWith('system-') && file.endsWith('.log')) {
        const filePath = path.join(LOG_DIR, file);
        const stats = fs.statSync(filePath);
        const diffDays = (now.getTime() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 7) {
          fs.unlinkSync(filePath);
          console.log(`Deleted old log file: ${file}`);
        }
      }
    });
  } catch (e) {
    console.error("Failed to rotate logs:", e);
  }
}

// Run rotation daily
setInterval(rotateLogs, 1000 * 60 * 60 * 24);
rotateLogs(); // Initial run

function getTodayInTimezone(timezone: string, date: Date = new Date()) {
  if (!date || isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date);
  } catch (e) {
    try {
      return date.toISOString().split('T')[0];
    } catch (e2) {
      return new Date().toISOString().split('T')[0];
    }
  }
}

function getDateTimeInTimezone(timezone: string, dateStr: string, timeStr: string): Date {
  const parts = `${dateStr}T${timeStr}:00`;
  const tempDate = new Date(parts + 'Z'); // Treat it as UTC first
  
  try {
    const tzDateStr = tempDate.toLocaleString('en-US', { timeZone: timezone });
    const utcDateStr = tempDate.toLocaleString('en-US', { timeZone: 'UTC' });
    
    const tzTime = new Date(tzDateStr).getTime();
    const utcTime = new Date(utcDateStr).getTime();
    
    if (!isNaN(tzTime) && !isNaN(utcTime)) {
      const offsetMs = tzTime - utcTime;
      return new Date(tempDate.getTime() - offsetMs);
    }
  } catch (e) {
    console.error(`Error calculating local time offset for timezone ${timezone}:`, e);
  }
  
  return new Date(parts);
}

/**
 * Filters metrics based on user priorities.
 * For each day and metric type, it selects the source with the highest priority (lowest rank).
 */
function filterMetricsByPriority(metrics: any[], prioritiesJson: string | null, timezone: string = 'UTC') {
  if (!prioritiesJson) return metrics;
  
  let priorities: Record<string, string[]> = {};
  try {
    priorities = JSON.parse(prioritiesJson);
  } catch (e) {
    return metrics;
  }

  // If no priorities are defined, return all
  if (Object.keys(priorities).length === 0) return metrics;

  const groupedByDayAndType: Record<string, Record<string, any[]>> = {};
  
  // Cache formatter to vastly speed up the loop (prevent millions of object initializations)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  for (const m of metrics) {
    if (!m.timestamp) continue;
    const dateObj = new Date(m.timestamp);
    if (isNaN(dateObj.getTime())) continue;
    
    // Shift sleep timestamps backward by 12 hours so overnight sessions map to the starting day
    if (m.type.startsWith('sleep')) {
      dateObj.setHours(dateObj.getHours() - 12);
    }
    
    let day;
    try {
      day = formatter.format(dateObj);
    } catch (e) {
      day = dateObj.toISOString().split('T')[0];
    }

    if (!groupedByDayAndType[day]) groupedByDayAndType[day] = {};
    if (!groupedByDayAndType[day][m.type]) groupedByDayAndType[day][m.type] = [];
    groupedByDayAndType[day][m.type].push(m);
  }

  const result: any[] = [];
  
  for (const day in groupedByDayAndType) {
    for (const type in groupedByDayAndType[day]) {
      const candidates = groupedByDayAndType[day][type];
      const metricPriorities = priorities[type];

      // Find best source for this day/type
      let bestSource = null;
      let highestRank = Infinity;

      if (!metricPriorities || metricPriorities.length === 0) {
        // Fallback: pick the first source encountered and keep all its records for that day
        bestSource = candidates[0].source;
      } else {
        for (const c of candidates) {
          const rank = metricPriorities.indexOf(c.source);
          if (rank !== -1 && rank < highestRank) {
            highestRank = rank;
            bestSource = c.source;
          }
        }
        // If none of the candidates match priorities, use first available source
        if (bestSource === null) {
          bestSource = candidates[0].source;
        }
      }

      // Keep records from the selected best source for this day, 
      // but deduplicate exact same timestamp/source/value entries 
      // which can happen during multi-sync events
      const addedKeys = new Set<string>();
      for (const c of candidates) {
        if (c.source === bestSource) {
          const key = `${c.timestamp}_${c.value}`;
          if (!addedKeys.has(key)) {
            result.push(c);
            addedKeys.add(key);
          }
        }
      }
    }
  }

  return result;
}



// Periodic cleanup task for logs (keep last 1000 logs)
setInterval(async () => {
  try {
    await db.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY timestamp DESC LIMIT 1000)").run();
  } catch (e) {
    console.error("Failed to cleanup logs", e);
  }
}, 1000 * 60 * 60); // Every hour

async function logEvent(level: 'debug' | 'info' | 'warn' | 'error', message: string, source: string, userId?: number) {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${source}] ${userId ? `[User ${userId}] ` : ''}${level.toUpperCase()}: ${message}\n`;
    
    // Always write to file
    fs.appendFileSync(getLogFilePath(), logLine);

    // Write to DB
    await db.prepare("INSERT INTO logs (user_id, level, message, source) VALUES (?, ?, ?, ?)").run(userId || null, level, message, source);
    
    // Conditional console logging
    // System logs (no userId) are controlled by the primary admin (ID 1)
    // User logs are controlled by that specific user's debug setting
    const targetId = userId || 1;
    const user = await db.prepare("SELECT show_debug_logs FROM users WHERE id = ?").get(targetId) as any;
    const debugMode = user?.show_debug_logs === 1;

    if (level !== 'debug' || debugMode) {
      console.log(`[${source}]${userId ? ` [User ${userId}]` : ''} ${level.toUpperCase()}: ${message}`);
    }
  } catch (e) {
    console.error("Failed to write log:", e);
  }
}

function clearUserCache(userId: any) {
  const uid = Number(userId);
  summaryCache.delete(uid);
  const keys = metricsCache.keys();
  const userKeys = keys.filter(k => k.startsWith(`${uid}-`));
  if (userKeys.length > 0) {
    metricsCache.del(userKeys);
  }
}

// Helper to call Go wrapper
async function fetchCronometerData(username: string, password: string, date: string): Promise<any> {
  const binaryPath = path.join(process.cwd(), 'go-wrapper', 'gocronometer-wrapper');
  return new Promise((resolve, reject) => {
    // For a single day, start and end are the same.
    // Use execFile with an args array (no shell) so credentials can't be interpreted as shell syntax.
    execFile(binaryPath, ['-u', username, '-p', password, '-s', date, '-e', date], (error, stdout, stderr) => {
      if (error) {
        console.error(`Go wrapper error: ${stderr}`);
        reject(error);
        return;
      }
      try {
        // Since the wrapper now outputs CSV, we need to parse it if we want JSON
        // However, if this is not used, we can just return the raw string or parse it
        const records = parse(stdout, {
          columns: true,
          skip_empty_lines: true
        });
        resolve(records);
      } catch (e) {
        reject(e);
      }
    });
  });
}


const BODY_METRICS = ['weight', 'body_fat', 'muscle_mass', 'lean_body_mass', 'bmi', 'height'];
const NUTRITION_METRICS = [
  'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 
  'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e', 
  'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water',
  'biotin', 'caffeine', 'cholesterol', 'copper', 'folate', 'niacin', 'iodine',
  'fat_monounsaturated', 'fat_polyunsaturated', 'fat_saturated', 'riboflavin',
  'phosphorus', 'manganese', 'thiamin', 'selenium', 'pantothenic_acid'
];

async function startServer() {
// Initialize database schema
async function ensureSchema() {
  const tables: Record<string, Record<string, string>> = {
    users: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      email: "TEXT UNIQUE",
      name: "TEXT",
      withings_token: "TEXT",
      withings_refresh_token: "TEXT",
      hevy_api_key: "TEXT",
      hevy_username: "TEXT",
      cronometer_api_key: "TEXT",
      last_cronometer_sync: "DATETIME",
      sync_history_days: "INTEGER DEFAULT 90",
      age: "INTEGER",
      gender: "TEXT",
      height: "REAL",
      dob: "TEXT",
      display_mode: "TEXT DEFAULT 'auto'",
      ai_provider: "TEXT DEFAULT 'gemini'",
      ai_api_key: "TEXT",
      ai_base_url: "TEXT",
      ai_hints: "TEXT",
      meal_suggestion_breakfast: "INTEGER DEFAULT 1",
      meal_suggestion_lunch: "INTEGER DEFAULT 1",
      meal_suggestion_dinner: "INTEGER DEFAULT 1",
      show_debug_logs: "INTEGER DEFAULT 0",
      ai_model: "TEXT",
      withings_client_id: "TEXT",
      withings_client_secret: "TEXT",
      modules_config: "TEXT",
      approved: "INTEGER DEFAULT 0",
      role: "TEXT DEFAULT 'user'",
      password_hash: "TEXT",
      export_token: "TEXT",
      medications: "TEXT",
      preferred_units: "TEXT DEFAULT 'metric'",
      default_graph_range: "TEXT DEFAULT '30d'",
      default_graph_grouping: "TEXT DEFAULT 'day'",
      timezone: "TEXT",
      ai_persona: "TEXT DEFAULT 'Encouraging Coach'",
      ai_focus: "TEXT DEFAULT 'General Health'",
      enable_correlations: "INTEGER DEFAULT 1",
      enable_daily_briefing: "INTEGER DEFAULT 1",
      daily_briefing: "TEXT",
      daily_briefing_updated_at: "DATETIME",
      ai_generation_times: "TEXT DEFAULT '[\"off\", \"off\", \"off\"]'",
      metric_priorities: "TEXT",
      font_size: "TEXT DEFAULT 'medium'",
      dashboard_widgets: "TEXT",
      ai_conversation_memory: "TEXT",
      ai_conversation_memory_updated_at: "DATETIME"
    },
    ai_configs: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      provider: "TEXT",
      api_key: "TEXT",
      model: "TEXT",
      base_url: "TEXT"
    },
    metrics: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      type: "TEXT",
      value: "REAL",
      unit: "TEXT",
      timestamp: "DATETIME DEFAULT CURRENT_TIMESTAMP",
      source: "TEXT"
    },
    workouts: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      name: "TEXT",
      duration: "INTEGER",
      volume: "REAL",
      timestamp: "DATETIME",
      source: "TEXT",
      external_id: "TEXT UNIQUE",
      routine_external_id: "TEXT"
    },
    workout_exercises: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      workout_id: "INTEGER",
      exercise_title: "TEXT",
      sets_count: "INTEGER",
      best_weight: "REAL",
      best_reps: "INTEGER",
      best_distance: "REAL",
      best_time: "INTEGER",
      exercise_type: "TEXT",
      best_steps: "INTEGER",
      best_calories: "REAL",
      best_avg_hr: "REAL",
      best_max_hr: "REAL",
      superset_id: "INTEGER"
    },
    workout_sets: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      exercise_id: "INTEGER",
      set_index: "INTEGER",
      weight: "REAL",
      reps: "INTEGER",
      distance: "REAL",
      time: "INTEGER",
      steps: "INTEGER",
      calories: "REAL",
      avg_hr: "REAL",
      max_hr: "REAL",
      type: "TEXT"
    },
    targets: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      type: "TEXT",
      value: "REAL",
      unit: "TEXT"
    },
    routines: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      name: "TEXT",
      description: "TEXT",
      folder_name: "TEXT",
      folder_id: "TEXT",
      external_id: "TEXT UNIQUE"
    },
    routine_exercises: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      routine_id: "INTEGER",
      exercise_title: "TEXT",
      sets_count: "INTEGER",
      rest_seconds: "INTEGER",
      superset_id: "INTEGER",
      target_weight: "REAL",
      target_reps: "INTEGER",
      target_distance: "REAL",
      target_time: "INTEGER"
    },
    logs: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      level: "TEXT",
      message: "TEXT",
      source: "TEXT",
      timestamp: "DATETIME DEFAULT CURRENT_TIMESTAMP"
    },
    meal_items: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      name: "TEXT",
      calories: "REAL",
      protein: "REAL",
      carbs: "REAL",
      fat: "REAL",
      fiber: "REAL",
      sodium: "REAL",
      iron: "REAL",
      calcium: "REAL",
      vitamin_c: "REAL",
      vitamin_a: "REAL",
      vitamin_d: "REAL",
      vitamin_e: "REAL",
      vitamin_k: "REAL",
      vitamin_b12: "REAL",
      vitamin_b6: "REAL",
      magnesium: "REAL",
      potassium: "REAL",
      zinc: "REAL",
      water: "REAL",
      timestamp: "DATETIME",
      source: "TEXT"
    },
    ai_insights: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      type: "TEXT",
      content: "TEXT",
      date: "TEXT",
      provider: "TEXT",
      model: "TEXT",
      batch_id: "TEXT",
      updated_at: "DATETIME DEFAULT CURRENT_TIMESTAMP"
    },
    chat_history: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "INTEGER",
      role: "TEXT",
      content: "TEXT",
      date: "TEXT",
      batch_id: "TEXT",
      timestamp: "DATETIME DEFAULT CURRENT_TIMESTAMP"
    },
    user_cache: {
      user_id: "INTEGER",
      cache_key: "TEXT",
      content: "TEXT",
      updated_at: "DATETIME DEFAULT CURRENT_TIMESTAMP"
    },
    system_config: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT"
    }
  };

  // Create tables and add missing columns
  for (const [tableName, schema] of Object.entries(tables)) {
    const columnDefs = Object.entries(schema).map(([col, type]) => `${col} ${type}`).join(', ');
    
    let createSql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs}`;
    if (tableName === 'metrics') createSql += `, UNIQUE(user_id, type, timestamp, source)`;
    if (tableName === 'targets') createSql += `, UNIQUE(user_id, type)`;
    if (tableName === 'meal_items') createSql += `, UNIQUE(user_id, timestamp, name, source)`;
    if (tableName === 'workout_exercises') createSql += `, FOREIGN KEY(workout_id) REFERENCES workouts(id) ON DELETE CASCADE`;
    if (tableName === 'workout_sets') createSql += `, FOREIGN KEY(exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE`;
    if (tableName === 'routine_exercises') createSql += `, FOREIGN KEY(routine_id) REFERENCES routines(id) ON DELETE CASCADE`;
    if (tableName === 'ai_configs') createSql += `, UNIQUE(user_id, provider)`;
    createSql += `)`;
    
    try {
      await db.exec(createSql);
    } catch (e) {
      console.error(`Error creating table ${tableName}:`, e);
    }

    // Performance Indices
    if (tableName === 'metrics') {
      try {
        await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS metrics_unique_idx ON metrics (user_id, type, timestamp, source)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS metrics_user_type_idx ON metrics (user_id, type)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS metrics_user_timestamp_idx ON metrics (user_id, timestamp)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS metrics_user_source_idx ON metrics (user_id, source)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS metrics_user_source_ts_idx ON metrics (user_id, source, timestamp)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS metrics_timestamp_idx ON metrics (timestamp)`);
      } catch (e) {
        console.warn(`Note: Could not create index on metrics:`, e.message);
      }
    }
    if (tableName === 'workouts') {
      try {
        await db.exec(`CREATE INDEX IF NOT EXISTS workouts_user_ts_idx ON workouts (user_id, timestamp)`);
      } catch (e) {
        console.warn(`Note: Could not create index on workouts:`, e.message);
      }
    }
    if (tableName === 'workout_exercises') {
      try {
        await db.exec(`CREATE INDEX IF NOT EXISTS workout_ex_workout_idx ON workout_exercises (workout_id)`);
      } catch (e) {
        console.warn(`Note: Could not create index on workout_exercises:`, e.message);
      }
    }
    if (tableName === 'workout_sets') {
      try {
        await db.exec(`CREATE INDEX IF NOT EXISTS workout_sets_ex_idx ON workout_sets (exercise_id)`);
      } catch (e) {
        console.warn(`Note: Could not create index on workout_sets:`, e.message);
      }
    }
    if (tableName === 'meal_items') {
      try {
        await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS meal_items_unique_idx ON meal_items (user_id, timestamp, name, source)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS meal_items_user_ts_idx ON meal_items (user_id, timestamp)`);
      } catch (e) {
        console.warn(`Note: Could not create index on meal_items:`, e.message);
      }
    }
    if (tableName === 'ai_insights') {
      try {
        await db.exec(`CREATE INDEX IF NOT EXISTS ai_insights_user_date_idx ON ai_insights (user_id, date)`);
      } catch (e) {
        console.warn(`Note: Could not create index on ai_insights:`, e.message);
      }
    }
    if (tableName === 'user_cache') {
      try {
        await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS user_cache_unique_idx ON user_cache (user_id, cache_key)`);
      } catch (e) {
        console.warn(`Note: Could not create index on user_cache:`, e.message);
      }
    }
    if (tableName === 'logs') {
      try {
        await db.exec(`CREATE INDEX IF NOT EXISTS logs_user_ts_idx ON logs (user_id, timestamp)`);
      } catch (e) {
        console.warn(`Note: Could not create index on logs:`, e.message);
      }
    }
    if (tableName === 'chat_history') {
      try {
        await db.exec(`CREATE INDEX IF NOT EXISTS chat_history_user_ts_idx ON chat_history (user_id, timestamp)`);
      } catch (e) {
        console.warn(`Note: Could not create index on chat_history:`, e.message);
      }
    }

    // Check for missing columns
    let existingColumns: any[] = [];
    try {
      if (db.type === 'sqlite') {
        const res = await db.prepare(`PRAGMA table_info(${tableName})`).all();
        existingColumns = (res as any[]).map(c => ({ name: c.name }));
      }
      else if (db.type === 'postgres') {
        const res = await db.prepare(`SELECT column_name as name FROM information_schema.columns WHERE table_name = ? AND table_schema = 'public'`).all(tableName);
        existingColumns = res as any[];
      }
      else {
        const res = await db.prepare(`SELECT COLUMN_NAME as name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()`).all(tableName);
        existingColumns = res as any[];
      }
    } catch(e) {
      console.error(`Failed to fetch existing columns for ${tableName}:`, e);
    }
    
    for (const [colName, colType] of Object.entries(schema)) {
      if (!existingColumns.find(c => c.name === colName)) {
        try {
          // Adjust INT AUTOINCREMENT
          const adjustType = (type: string) => {
            if (db.type === 'sqlite') return type;
            if (type.includes('INTEGER PRIMARY KEY AUTOINCREMENT')) {
              return db.type === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';
            }
            if (type.includes('DATETIME')) return db.type === 'postgres' ? type.replace('DATETIME', 'TIMESTAMP') : type;
            return type;
          };
          await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${adjustType(colType as string)}`);
          console.log(`Added missing column ${colName} to ${tableName}`);
        } catch (e) {
          console.error(`Error adding column ${colName} to ${tableName}:`, e);
        }
      }
    }
  }

  // Migration: Ensure dashboard_widgets and feature toggles are not NULL for existing users
  try {
    const defaultWidgets = ['readiness_card', 'stats', 'charts', 'nutrition', 'micronutrient_radar', 'macronutrient_radar', 'smart_adjustments', 'sleep_stages', 'lean_body_mass_chart'];
    await db.prepare("UPDATE users SET dashboard_widgets = ? WHERE dashboard_widgets IS NULL").run(JSON.stringify(defaultWidgets));
    await db.prepare("UPDATE users SET enable_correlations = 1 WHERE enable_correlations IS NULL").run();
    await db.prepare("UPDATE users SET enable_daily_briefing = 1 WHERE enable_daily_briefing IS NULL").run();
  } catch (e) {
    console.error("[Migration] Failed to populate defaults:", e);
  }

  // Migration: Normalize timestamps in metrics and workouts (handle DD/MM/YYYY and space formats)
  try {
    const normalize = (ts: string) => {
      if (!ts) return ts;
      let val = ts.trim();
      // Handle DD/MM/YYYY or D/M/YYYY formats
      const dmYMatch = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)/);
      if (dmYMatch) {
         const [_, d, m, y, rest] = dmYMatch;
         val = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}${rest.trim().replace(' ', 'T')}`;
      }
      // Handle YYYY-MM-DD HH:mm:SS +0000 by converting to ISO string
      if (val.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/)) {
        val = val.replace(' ', 'T').replace(/ ([+-])/, '$1');
      }
      try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString();
        return val;
      } catch { return val; }
    };

    let metricsToFix: any[] = [];
    if (db.type === 'sqlite') {
      try {
        metricsToFix = await db.prepare("SELECT id, timestamp FROM metrics WHERE CAST(timestamp AS TEXT) LIKE '%/%' OR CAST(timestamp AS TEXT) LIKE '% %'").all() as any[];
      } catch (e) {
        // Ignored, might be missing column or other error
      }
    }
    if (metricsToFix.length > 0) {
      console.log(`[Migration] Normalizing ${metricsToFix.length} metrics timestamps...`);
      const updateMetric = db.prepare("UPDATE metrics SET timestamp = ? WHERE id = ?");
      await db.transaction(async () => {
        for (const m of metricsToFix) {
          const normalized = normalize(m.timestamp);
          if (normalized !== m.timestamp) await updateMetric.run(normalized, m.id);
        }
      })();
    }

    let workoutsToFix: any[] = [];
    if (db.type === 'sqlite') {
      try {
        workoutsToFix = await db.prepare("SELECT id, timestamp FROM workouts WHERE CAST(timestamp AS TEXT) LIKE '%/%' OR CAST(timestamp AS TEXT) LIKE '% %'").all() as any[];
      } catch (e) {
      }
    }
    if (workoutsToFix.length > 0) {
      console.log(`[Migration] Normalizing ${workoutsToFix.length} workouts timestamps...`);
      const updateWorkout = db.prepare("UPDATE workouts SET timestamp = ? WHERE id = ?");
      await db.transaction(async () => {
        for (const w of workoutsToFix) {
          const normalized = normalize(w.timestamp);
          if (normalized !== w.timestamp) await updateWorkout.run(normalized, w.id);
        }
      })();
    }
  } catch (e) {
    console.warn("Timestamp normalization migration skipped or partially failed:", e.message);
  }

  // Populate ai_configs...
  try {
    const usersWithAI = await db.prepare("SELECT id, ai_provider, ai_api_key, ai_model, ai_base_url FROM users WHERE ai_api_key IS NOT NULL OR ai_provider != 'gemini'").all() as any[];
    for (const user of usersWithAI) {
      await db.prepare(`
        ${db.type === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT'} INTO ai_configs (user_id, provider, api_key, model, base_url)
        VALUES (?, ?, ?, ?, ?)
        ${db.type === 'postgres' ? 'ON CONFLICT (user_id, provider) DO NOTHING' : ''}
      `).run(user.id, user.ai_provider || 'gemini', user.ai_api_key, user.ai_model, user.ai_base_url);
    }
  } catch (e) {
    console.error("Failed to migrate AI configs:", e);
  }

  // Migration: Fix misclassified cardio exercises
  try {
    await db.prepare(`
      UPDATE workout_exercises 
      SET exercise_type = 'cardio' 
      WHERE exercise_type != 'cardio' 
      AND (
        exercise_title LIKE '%Rowing%' OR 
        exercise_title LIKE '%Run%' OR 
        exercise_title LIKE '%Cycle%' OR 
        exercise_title LIKE '%Swim%' OR
        exercise_title LIKE '%Elliptical%' OR
        exercise_title LIKE '%Stair%' OR
        exercise_title LIKE '%Walk%'
      )
    `).run();
  } catch (e) {
    console.error("Migration failed:", e);
  }

  // Aggressive cleanup for metrics and meal_items to handle millisecond-shifted duplicates
  try {
    console.log("Performing aggressive cleanup for nutrition duplicates...");
    
    // 1. Clean up meal_items (exact matches + minute-based for nutrition)
    const mealDuplicates = await db.prepare(`
      SELECT id, name, calories, timestamp, source FROM meal_items 
      WHERE id NOT IN (
        SELECT MIN(id) 
        FROM meal_items 
        GROUP BY user_id, source, name, 
          CASE 
            WHEN source IN ('cronometer', 'nutracheck') THEN ${ db.type === 'sqlite' ? "strftime('%Y-%m-%dT%H:%M', timestamp)" : "TO_CHAR(timestamp, 'YYYY-MM-DD\"T\"HH24:MI')" }
            ELSE ${ db.type === 'sqlite' ? "timestamp" : "CAST(timestamp AS TEXT)" } 
          END, 
          calories
      )
    `).all() as any[];

    if (mealDuplicates.length > 0) {
      const table = mealDuplicates.map(d => `ID: ${d.id} | Name: ${d.name} | Cal: ${d.calories} | TS: ${d.timestamp} | Source: ${d.source}`).join('\n');
      logEvent('debug', `Duplicate meal items found and cleaning up:\n${table}`, 'cleanup');
      
      await db.prepare(`
        DELETE FROM meal_items 
        WHERE id IN (${mealDuplicates.map(d => d.id).join(',')})
      `).run();
      console.log(`Cleaned up ${mealDuplicates.length} duplicate meal items.`);
    }
    
    // 2. Clean up metrics (exact matches + minute-based for nutrition)
    const metricsDuplicates = await db.prepare(`
      SELECT id, type, value, timestamp, source FROM metrics 
      WHERE id NOT IN (
        SELECT MIN(id) 
        FROM metrics 
        GROUP BY user_id, source, type, 
          CASE 
            WHEN source IN ('cronometer', 'nutracheck') THEN ${ db.type === 'sqlite' ? "strftime('%Y-%m-%dT%H:%M', timestamp)" : "TO_CHAR(timestamp, 'YYYY-MM-DD\"T\"HH24:MI')" }
            ELSE ${ db.type === 'sqlite' ? "timestamp" : "CAST(timestamp AS TEXT)" } 
          END, 
          value
      )
    `).all() as any[];

    if (metricsDuplicates.length > 0) {
      const table = metricsDuplicates.map(d => `ID: ${d.id} | Type: ${d.type} | Val: ${d.value} | TS: ${d.timestamp} | Source: ${d.source}`).join('\n');
      logEvent('debug', `Duplicate metrics found and cleaning up:\n${table}`, 'cleanup');

      await db.prepare(`
        DELETE FROM metrics 
        WHERE id IN (${metricsDuplicates.map(d => d.id).join(',')})
      `).run();
      console.log(`Cleaned up ${metricsDuplicates.length} duplicate metrics.`);
    }

    // 3. Try to create unique indexes again after cleanup if they failed before
    try {
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS metrics_unique_idx ON metrics (user_id, type, timestamp, source)`);
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS meal_items_unique_idx ON meal_items (user_id, timestamp, name, source)`);
    } catch (e) {
      // Ignore if still failing, we'll try again next boot
    }

    // 4. Cross-source cleanup for nutrition (if cronometer exists for a day, remove apple_health nutrition for that day)
    const nutritionTypes = [
      'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 
      'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e', 
      'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water'
    ];
    
    const crossSourceDuplicates = await db.prepare(`
      SELECT id, type, value, timestamp, source FROM metrics 
      WHERE source = 'apple_health'
      AND type IN (${nutritionTypes.map(t => `'${t}'`).join(',')})
      AND ${ db.type === 'sqlite' ? "substr(timestamp, 1, 10)" : "CAST(timestamp AS DATE)" } IN (
        SELECT ${ db.type === 'sqlite' ? "substr(timestamp, 1, 10)" : "CAST(timestamp AS DATE)" } 
        FROM metrics 
        WHERE source IN ('cronometer', 'nutracheck')
        AND type IN (${nutritionTypes.map(t => `'${t}'`).join(',')})
      )
    `).all() as any[];

    if (crossSourceDuplicates.length > 0) {
      const table = crossSourceDuplicates.map(d => `ID: ${d.id} | Type: ${d.type} | Val: ${d.value} | TS: ${d.timestamp} | Source: ${d.source}`).join('\n');
      logEvent('debug', `Cross-source nutrition duplicates found and cleaning up:\n${table}`, 'cleanup');

      await db.prepare(`
        DELETE FROM metrics 
        WHERE id IN (${crossSourceDuplicates.map(d => d.id).join(',')})
      `).run();
      console.log(`Cleaned up ${crossSourceDuplicates.length} cross-source nutrition duplicates.`);
    }
  } catch (e) {
    console.error("Error during aggressive cleanup:", e);
  }

  // Drop old, inefficient indexes
  const oldIndexes = ['idx_metrics_type_ts', 'idx_metrics_ts', 'idx_ai_insights_date'];
  for (const idxName of oldIndexes) {
    try {
      await db.exec(`DROP INDEX IF EXISTS ${idxName}`);
    } catch (e) {
      console.error(`Error dropping old index ${idxName}:`, e);
    }
  }

  // Add indexes
  const indexes = [
    { name: 'idx_metrics_unique', table: 'metrics', columns: 'user_id, type, timestamp, source', unique: true },
    { name: 'idx_metrics_user_type_ts', table: 'metrics', columns: 'user_id, type, timestamp' },
    { name: 'idx_metrics_user_ts', table: 'metrics', columns: 'user_id, timestamp' },
    { name: 'idx_workouts_user_ts', table: 'workouts', columns: 'user_id, timestamp' },
    { name: 'idx_workout_exercises_workout_id', table: 'workout_exercises', columns: 'workout_id' },
    { name: 'idx_workout_sets_exercise_id', table: 'workout_sets', columns: 'exercise_id' },
    { name: 'idx_routine_exercises_routine_id', table: 'routine_exercises', columns: 'routine_id' },
    { name: 'idx_logs_timestamp', table: 'logs', columns: 'timestamp' },
    { name: 'idx_meal_items_user_ts', table: 'meal_items', columns: 'user_id, timestamp' },
    { name: 'idx_meal_items_unique', table: 'meal_items', columns: 'user_id, timestamp, name, source', unique: true },
    { name: 'idx_ai_insights_user_date', table: 'ai_insights', columns: 'user_id, date' },
    { name: 'idx_chat_history_date', table: 'chat_history', columns: 'date' }
  ];

  for (const idx of indexes) {
    try {
      await db.exec(`CREATE ${idx.unique ? 'UNIQUE' : ''} INDEX IF NOT EXISTS ${idx.name} ON ${idx.table}(${idx.columns})`);
    } catch (e) {
      console.error(`Error creating index ${idx.name}:`, e);
    }
  }

  // Special migration for ai_insights UNIQUE constraint if needed
  if (db.type === 'sqlite') { try {
    const tableSchema = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_insights'").get() as any;
    if (tableSchema && tableSchema.sql.includes('UNIQUE(user_id, type, date)')) {
       console.log("Updating ai_insights table to remove UNIQUE(user_id, type, date) constraint");
       await db.exec(`
        ALTER TABLE ai_insights RENAME TO ai_insights_old;
        CREATE TABLE ai_insights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          type TEXT,
          content TEXT,
          date TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO ai_insights (id, user_id, type, content, date, updated_at)
        SELECT id, COALESCE(user_id, 1), type, content, COALESCE(date, substr(updated_at, 1, 10)), updated_at FROM ai_insights_old;
        DROP TABLE ai_insights_old;
      `);
    } else {
      // Ensure all existing rows have a date
      await db.prepare("UPDATE ai_insights SET date = substr(updated_at, 1, 10) WHERE date IS NULL").run();
    }
  } catch (e) {
    console.error("Failed to migrate ai_insights constraints:", e);
  } }
}

// Run schema check
await ensureSchema();

// Ensure user_id 1 is admin and approved
try {
  await db.prepare("UPDATE users SET role = 'admin', approved = 1 WHERE id = 1").run();

  // Bootstrap the primary admin's password from ADMIN_PASSWORD on first run.
  // Only sets it when user 1 exists and has no password yet, so it is safe to
  // leave ADMIN_PASSWORD set across restarts (and safer still to unset it after).
  if (process.env.ADMIN_PASSWORD) {
    const admin = await db.prepare("SELECT id, password_hash FROM users WHERE id = 1").get() as any;
    if (admin && !admin.password_hash) {
      await db.prepare("UPDATE users SET password_hash = ? WHERE id = 1")
        .run(await hashPassword(process.env.ADMIN_PASSWORD));
      console.log("[auth] Seeded password for primary administrator (user 1) from ADMIN_PASSWORD");
    }
  }
} catch (e) {
  console.error("Failed to set default admin:", e);
}

// Optimize database
try {
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA synchronous = NORMAL;");
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec("VACUUM;");
} catch (e) {
  console.error("Failed to optimize database", e);
}

// Metric updates
try {
  await db.prepare("UPDATE metrics SET type = 'active_energy' WHERE type = 'calories_out_active'").run();
  await db.prepare("UPDATE metrics SET type = 'basal_energy' WHERE type = 'calories_out_resting'").run();
} catch (e) {}

// Cleanup Apple Health nutrition data that might be skewing graphs
try {
  const nutritionTypes = [
    'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 
    'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e', 
    'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water',
    'biotin', 'caffeine', 'cholesterol', 'copper', 'folate', 'niacin', 'iodine',
    'fat_monounsaturated', 'fat_polyunsaturated', 'fat_saturated', 'riboflavin',
    'phosphorus', 'manganese', 'thiamin', 'selenium', 'pantothenic_acid'
  ];
  const placeholders = nutritionTypes.map(() => '?').join(',');
  await db.prepare(`DELETE FROM metrics WHERE source = 'apple_health' AND type IN (${placeholders})`).run(...nutritionTypes);
  console.log("Cleaned up Apple Health nutrition data");
} catch (e) {
  console.error("Failed to cleanup Apple Health nutrition data", e);
}
// One-time cleanup for sleep records that were incorrectly double-counted
try {
  // We'll rename all 'sleep' type records that are clearly aggregates or duplicates
  // to 'sleep_total' to ensure they don't bloat the primary sleep metric.
  // We'll run this if we detect any oversized sleep records (>14 hours) or multiple Apple Health sleep records.
  const oversizedCount = (await db.prepare("SELECT count(*) as count FROM metrics WHERE type = 'sleep' AND value > 50400").get() as any).count;
  
  if (oversizedCount > 0) {
    console.log(`[db] Detected ${oversizedCount} oversized sleep records. performing cleanup...`);
    // Rule 1: Any Apple Health sleep record > 12 hours is likely "Sleep Analysis" or an aggregate.
    await db.prepare("UPDATE metrics SET type = 'sleep_total' WHERE type = 'sleep' AND source = 'apple_health' AND value > 43200").run();
  }
} catch (e) {
  console.error("[db] Cleanup failed:", e);
}
  const app = express();
  app.set('trust proxy', true);
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Health Auto Export payloads can be large, so that one route gets a generous
  // limit; everything else is capped low to avoid trivial memory-exhaustion DoS.
  const HEALTH_EXPORT_PATH = '/health-export';
  const largeJson = express.json({ limit: '100mb' });
  const standardJson = express.json({ limit: '5mb' });
  app.use((req, res, next) => (req.path === HEALTH_EXPORT_PATH ? largeJson : standardJson)(req, res, next));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.use(cookieParser());
  
  // Suppress loud request aborted noise from standard fetching/JSON parsing
  app.use((err: any, req: any, res: any, next: any) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    if (err && err.type === 'request.aborted') {
      return res.status(400).end(); // Client disconnected early
    }
    next(err);
  });

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET is not set. Refusing to start with an insecure default. Generate one with: openssl rand -base64 32');
    process.exit(1);
  }

  const requireAuth = async (req: any, res: any, next: any) => {
    // Exclude auth routes
    if (req.path === '/auth/login' || req.path === '/auth/logout' || req.path === '/auth/register' || req.path === '/api/auth/login' || req.path === '/api/auth/logout' || req.path === '/api/auth/register') {
      return next();
    }
    
    const token = req.cookies.auth_token;
    if (!token) {
      if (req.path.startsWith('/api/')) {
        console.log(`[auth] Unauthorized API request to ${req.path}`);
      }
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
      
      // Check if user is approved
      const user = await db.prepare("SELECT approved, role FROM users WHERE id = ?").get(decoded.id) as any;
      if (!user) {
        console.log(`[auth] User not found for ID ${decoded.id}`);
        return res.status(401).json({ error: 'User not found' });
      }
      
      req.user.approved = user.approved;
      req.user.role = user.role;

      // Allow access to /api/auth/me even if not approved
      if (req.path === '/api/auth/me') {
        return next();
      }

      if (!user.approved) {
        console.log(`[auth] User ${decoded.id} pending approval`);
        return res.status(403).json({ error: 'Account pending approval' });
      }

      next();
    } catch (e) {
      console.log(`[auth] Invalid token for request to ${req.path}`);
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  app.use('/api', requireAuth);

  const setAuthCookie = (req: any, res: any, user: any) => {
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    const secureCookie = process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https');
    res.cookie('auth_token', token, { httpOnly: true, secure: secureCookie, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
  };

  // Simple in-memory fixed-window rate limiter (per IP) to slow credential
  // stuffing / brute force without adding a dependency. Fine for a single-instance
  // self-hosted deployment.
  const makeRateLimiter = (windowMs: number, max: number) => {
    const hits = new Map<string, { count: number; reset: number }>();
    return (req: any, res: any, next: any) => {
      const now = Date.now();
      const key = req.ip || 'unknown';
      const entry = hits.get(key);
      if (!entry || now > entry.reset) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return next();
      }
      entry.count++;
      if (entry.count > max) {
        return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      }
      next();
    };
  };
  const authLimiter = makeRateLimiter(15 * 60 * 1000, 10); // 10 attempts / 15 min / IP

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    // Use a generic message and always run a verify to limit user-enumeration / timing leaks.
    const ok = await verifyPassword(password, user?.password_hash);
    if (!user || !ok) {
      console.log(`[auth] Failed login for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    setAuthCookie(req, res, user);
    res.json({ user: { id: user.id, email: user.email } });
  });

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    // First-ever user becomes an approved admin so the instance is usable out of the box.
    const userCount = (await db.prepare("SELECT COUNT(*) as c FROM users").get() as any).c;
    const isFirst = userCount === 0;

    const passwordHash = await hashPassword(password);
    const exportToken = randomBytes(24).toString('hex');
    const defaultWidgets = ['readiness_card', 'stats', 'charts', 'nutrition', 'micronutrient_radar', 'macronutrient_radar', 'smart_adjustments', 'sleep_stages', 'lean_body_mass_chart'];
    const result = await db.prepare(
      "INSERT INTO users (email, password_hash, export_token, approved, role, sync_history_days, dashboard_widgets) VALUES (?, ?, ?, ?, ?, 90, ?)"
    ).run(email, passwordHash, exportToken, isFirst ? 1 : 0, isFirst ? 'admin' : 'user', JSON.stringify(defaultWidgets));
    const user = { id: result.lastInsertRowid, email } as any;

    // Default targets for new user
    await db.prepare("INSERT INTO targets (user_id, type, value, unit) VALUES (?, 'weight', 76, 'kg')").run(user.id);
    await db.prepare("INSERT INTO targets (user_id, type, value, unit) VALUES (?, 'body_fat', 20, '%')").run(user.id);
    await db.prepare("INSERT INTO targets (user_id, type, value, unit) VALUES (?, 'steps', 0, '')").run(user.id);
    await db.prepare("INSERT INTO targets (user_id, type, value, unit) VALUES (?, 'vo2_max', 0, 'ml/kg/min')").run(user.id);

    setAuthCookie(req, res, user);
    res.json({ user: { id: user.id, email: user.email } });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
  });

  await app.get('/api/auth/me', async (req: any, res: any) => {
    const user = await db.prepare("SELECT id, email, name, display_mode, approved, role FROM users WHERE id = ?").get(req.user.id) as any;
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user });
  });

  // Admin Routes
  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  await app.get('/api/admin/config', requireAdmin, async (req, res) => {
    const config = await db.prepare("SELECT * FROM system_config").all() as any[];
    const result: Record<string, string> = {};
    config.forEach(c => result[c.key] = c.value);
    res.json(result);
  });

  app.post('/api/admin/config', requireAdmin, async (req, res) => {
    const { key, value } = req.body;
    await db.prepare("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    res.json({ success: true });
  });

  await app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const users = await db.prepare("SELECT id, email, approved, role, show_debug_logs, enable_daily_briefing FROM users").all();
    res.json(users);
  });

  app.post('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
    const { id } = req.params;
    await db.prepare("UPDATE users SET approved = 1 WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.post('/api/admin/users/:id/purge', requireAdmin, async (req: any, res) => {
    console.log(`[admin purge] Request from user ${req.user.id} to purge user ${req.params.id}`);
    if (req.user.id !== 1) {
      console.warn(`[admin purge] Forbidden: user ${req.user.id} is not user 1`);
      return res.status(403).json({ error: 'Only the primary administrator can purge data' });
    }
    const targetUserId = parseInt(req.params.id, 10);
    const { metrics, workouts, routines, insights, logs, chat } = req.body;
    console.log(`[admin purge] Purging for user ${targetUserId}:`, req.body);

    try {
      await db.transaction(async () => {
        if (metrics) {
          const info = await db.prepare("DELETE FROM metrics WHERE user_id = ?").run(targetUserId);
          console.log(`[admin purge] Deleted ${info.changes} metrics for user ${targetUserId}`);
        }
        if (workouts) {
          // Delete workout sets and exercises first
          await db.prepare(`
            DELETE FROM workout_sets 
            WHERE exercise_id IN (
              SELECT id FROM workout_exercises 
              WHERE workout_id IN (
                SELECT id FROM workouts WHERE user_id = ?
              )
            )
          `).run(targetUserId);
          await db.prepare("DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE user_id = ?)").run(targetUserId);
          const info = await db.prepare("DELETE FROM workouts WHERE user_id = ?").run(targetUserId);
          console.log(`[admin purge] Deleted ${info.changes} workouts for user ${targetUserId}`);
        }
        if (routines) {
          await db.prepare("DELETE FROM routine_exercises WHERE routine_id IN (SELECT id FROM routines WHERE user_id = ?)").run(targetUserId);
          const info = await db.prepare("DELETE FROM routines WHERE user_id = ?").run(targetUserId);
          console.log(`[admin purge] Deleted ${info.changes} routines for user ${targetUserId}`);
        }
        if (insights) {
          const info = await db.prepare("DELETE FROM ai_insights WHERE user_id = ?").run(targetUserId);
          console.log(`[admin purge] Deleted ${info.changes} ai_insights for user ${targetUserId}`);
        }
        if (logs) {
          const info = await db.prepare("DELETE FROM logs WHERE user_id = ?").run(targetUserId);
          console.log(`[admin purge] Deleted ${info.changes} logs for user ${targetUserId}`);
        }
        if (chat) {
          const info = await db.prepare("DELETE FROM chat_history WHERE user_id = ?").run(targetUserId);
          console.log(`[admin purge] Deleted ${info.changes} chat_history for user ${targetUserId}`);
        }
      })();

      clearUserCache(targetUserId);
      logEvent('warn', `Admin purged data for user ${targetUserId}: ${JSON.stringify(req.body)}`, 'admin', req.user.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error(`[admin purge] Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/admin/users/:id/toggle-debug', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { enabled } = req.body;
    await db.prepare("UPDATE users SET show_debug_logs = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    res.json({ success: true });
  });

  app.post('/api/admin/users/:id/reject', requireAdmin, async (req, res) => {
    const { id } = req.params;
    // Don't allow deleting the main admin
    if (id === '1') return res.status(400).json({ error: 'Cannot delete main admin' });
    await db.prepare("DELETE FROM users WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // API Routes
  await app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Vitality Hub API is running" });
  });

  await app.get("/api/debug/logs", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    const logs = await db.prepare("SELECT * FROM logs WHERE user_id = ? OR user_id IS NULL ORDER BY timestamp DESC LIMIT 50").all(userId);
    res.json(logs);
  });

  // Returns the caller's Health Auto Export URL, generating a token on first use.
  await app.get("/api/export-token", requireAuth, async (req: any, res) => {
    let row = await db.prepare("SELECT export_token FROM users WHERE id = ?").get(req.user.id) as any;
    if (!row?.export_token) {
      const token = randomBytes(24).toString('hex');
      await db.prepare("UPDATE users SET export_token = ? WHERE id = ?").run(token, req.user.id);
      row = { export_token: token };
    }
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.json({
      token: row.export_token,
      url: `${base}/health-export?userId=${req.user.id}&token=${row.export_token}`,
    });
  });

  // Health Auto Export (iOS App) Listener.
  // This endpoint is not cookie-authenticated (the iOS app can't hold a session),
  // so it is gated by a per-user export token that must match the stored token.
  app.post('/health-export', async (req, res) => {
    const queryUserId = req.query.userId;
    const bodyUserId = req.body?.userId;
    const getFirst = (value: any) => Array.isArray(value) ? value[0] : value;
    const userId = parseInt(getFirst(queryUserId || bodyUserId) as string, 10);

    if (!userId || isNaN(userId)) {
      logEvent('error', 'Received request to /health-export without valid userId', 'apple_health');
      return res.status(400).send("Missing or invalid userId parameter");
    }

    const queryToken = getFirst(req.query.token);
    const bodyToken = req.body?.token;
    const headerToken = typeof req.headers['x-export-token'] === 'string'
      ? req.headers['x-export-token']
      : Array.isArray(req.headers['x-export-token']) ? req.headers['x-export-token'][0] : undefined;
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization.replace(/^Bearer\s+/i, '')
      : undefined;

    const providedToken = queryToken || bodyToken || headerToken || authHeader;
    const userRow = await db.prepare("SELECT export_token FROM users WHERE id = ?").get(userId) as any;
    const expected = userRow?.export_token;
    const clientIp = String(req.ip || req.connection?.remoteAddress || '');
    const isLocalNetworkAddress = (ip: string) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(ip);
    const tokensMatch = !!expected && !!providedToken &&
      expected.length === providedToken.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(providedToken));
    const allowLocalFallback = !providedToken && !!userRow && isLocalNetworkAddress(clientIp);

    if (!tokensMatch && !allowLocalFallback) {
      logEvent('error', 'Rejected /health-export with missing or invalid token', 'apple_health', userId);
      return res.status(401).send("Invalid or missing export token");
    }

    if (allowLocalFallback && !tokensMatch) {
      logEvent('warn', `Accepted tokenless local /health-export request from ${clientIp} for user ${userId}`, 'apple_health', userId);
    }

    const body = req.body;
    if (!body) return res.status(400).send("No body");

    const appleHealthModule = modules.find(m => m.id === 'apple_health');
    const appleWorkoutsModule = modules.find(m => m.id === 'apple_workouts');

    if (!appleHealthModule || !appleWorkoutsModule) {
      logEvent('error', 'Apple Health or Workouts module not found', 'apple_health', userId);
      return res.status(500).send("Modules not initialized");
    }

    try {
      // Sync metrics
      const healthResult = await appleHealthModule.sync(userId, db, (level: any, msg: any, src: any) => logEvent(level, msg, src, userId), {}, body);
      
      // Sync workouts
      const workoutsResult = await appleWorkoutsModule.sync(userId, db, (level: any, msg: any, src: any) => logEvent(level, msg, src, userId), {}, body);

      // Clear caches
      clearUserCache(userId);
      
      logEvent('info', `Background sync completed: ${healthResult.count || 0} metrics, ${workoutsResult.count || 0} workouts`, 'apple_health', userId);
      
      res.send("OK");
    } catch (error: any) {
      logEvent('error', `Background sync failed: ${error.message}`, 'apple_health', userId);
      res.status(500).send("Sync failed");
    }
  });

  await app.get('/api/debug/apple-health-last-sync', requireAuth, (req: any, res) => {
    const userId = req.user.id;
    try {
      const filePath = path.join(process.cwd(), `last_apple_health_sync_${userId}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        res.json(data);
      } else {
        res.json({ message: "No sync recorded yet" });
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to read sync info" });
    }
  });

  await app.get('/api/debug/metrics/:type', requireAuth, async (req: any, res) => {
    const { type } = req.params;
    const metrics = await db.prepare("SELECT * FROM metrics WHERE type = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 100").all(type, req.user.id);
    res.json(metrics);
  });

  await app.get('/api/debug/apple-health-full-body', requireAuth, (req, res) => {
    try {
      const filePath = path.join(process.cwd(), 'last_apple_health_full_body.json');
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.json({ message: "No full body recorded yet" });
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to read full body" });
    }
  });

  // Withings OAuth
  await app.get("/api/auth/withings/url", async (req: any, res: any) => {
    const userId = req.user.id;
    const user = await db.prepare("SELECT withings_client_id, modules_config FROM users WHERE id = ?").get(userId) as any;
    
    let clientID = user?.withings_client_id;
    if (!clientID && user?.modules_config) {
      try {
        const config = JSON.parse(user.modules_config);
        clientID = config.withings?.settings?.withings_client_id;
      } catch (e) {}
    }
    
    clientID = clientID || process.env.WITHINGS_CLIENT_ID;
    
    if (!clientID) {
      return res.status(400).json({ error: "Withings Client ID not configured in settings" });
    }
    
    const host = await req.get('x-forwarded-host') || await req.get('host');
    const protocol = await req.get('x-forwarded-proto') || req.protocol;
    const baseUrl = `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/auth/callback/withings`;
    const state = userId.toString();
    const url = `https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id=${clientID}&state=${state}&scope=user.metrics,user.activity,user.sleepevents&redirect_uri=${redirectUri}&mode=1&prompt=login&force_login=1`;
    res.json({ url });
  });

  await app.get("/auth/callback/withings", async (req, res) => {
    const { code, state } = req.query;
    
    // Support Withings callback reachability test (probes)
    // Cloudflare Access should be configured to Bypass this path
    if (!code && !state) {
      return res.status(200).send("Withings callback endpoint is active. Ensure Cloudflare Access bypasses this path.");
    }

    const userId = parseInt(state as string, 10);
    
    if (!userId || isNaN(userId)) {
      console.warn("[withings] Callback received without valid state/userId", { query: req.query });
      return res.status(400).send("Invalid state parameter. If you are testing reachability, this endpoint is active.");
    }
    
    try {
      const user = await db.prepare("SELECT withings_client_id, withings_client_secret, modules_config FROM users WHERE id = ?").get(userId) as any;
      
      let clientID = user?.withings_client_id;
      let clientSecret = user?.withings_client_secret;
      
      if ((!clientID || !clientSecret) && user?.modules_config) {
        try {
          const config = JSON.parse(user.modules_config);
          if (!clientID) clientID = config.withings?.settings?.withings_client_id;
          if (!clientSecret) clientSecret = config.withings?.settings?.withings_client_secret;
        } catch (e) {}
      }
      
      clientID = clientID || process.env.WITHINGS_CLIENT_ID;
      clientSecret = clientSecret || process.env.WITHINGS_CLIENT_SECRET;

      const host = await req.get('x-forwarded-host') || await req.get('host');
      const protocol = await req.get('x-forwarded-proto') || req.protocol;
      const baseUrl = `${protocol}://${host}`;
      const redirectUri = `${baseUrl}/auth/callback/withings`;

      const response = await axios.post("https://wbsapi.withings.net/v2/oauth2", null, {
        params: {
          action: "requesttoken",
          grant_type: "authorization_code",
          client_id: clientID,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        },
      });

      const { access_token, refresh_token } = response.data.body;
      
      // Store tokens for the specific user
      await db.prepare("UPDATE users SET withings_token = ?, withings_refresh_token = ? WHERE id = ?")
        .run(access_token, refresh_token, userId);

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'withings' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Withings connected! Closing...</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Withings OAuth Error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Withings Sync
  // Shared Sync Functions: (All consolidated into /modules now)

  async function callAI(user: any, prompt: string, maxTokens: number = 8192) {
    const userId = user.id;
    logEvent('debug', `callAI entered for provider: ${user.ai_provider}`, 'ai', userId);
    const providerId = user.ai_provider || 'gemini';
    const provider = AI_PROVIDERS[providerId];
    
    if (!provider) {
      logEvent('error', `AI Provider ${providerId} not found`, 'ai', userId);
      throw new Error(`AI Provider ${providerId} not found`);
    }

    let model = user.ai_model;
    let apiKey = user.ai_api_key;
    let baseUrl = user.ai_base_url || "";

    // Load actual provider config from ai_configs to ensure we do not use stale/null model from general user columns
    try {
      const dbConfig = await db.prepare("SELECT * FROM ai_configs WHERE user_id = ? AND provider = ?").get(userId, providerId) as any;
      if (dbConfig) {
        if (dbConfig.model) model = dbConfig.model;
        if (dbConfig.api_key) apiKey = dbConfig.api_key;
        if (dbConfig.base_url) baseUrl = dbConfig.base_url;
      }
    } catch (dbErr: any) {
      logEvent('warn', `Failed to load provider config from ai_configs in callAI: ${dbErr.message}`, 'ai', userId);
    }

    if (!apiKey) {
      apiKey = (providerId === 'gemini' ? process.env.GEMINI_API_KEY : "");
    }

    const performCall = async (targetModel: string) => {
      logEvent('debug', `Calling AI provider ${providerId} with model ${targetModel}`, 'ai', userId);
      try {
        const result = await provider.generate({
          model: targetModel,
          prompt,
          maxTokens,
          apiKey: apiKey || "",
          baseUrl,
          logEvent: (level: any, msg: any, src: any) => logEvent(level, msg, src, userId)
        });
        logEvent('debug', `AI provider ${providerId} responded successfully`, 'ai', userId);
        return result;
      } catch (err: any) {
        logEvent('error', `Error calling ${providerId}: ${err.message}`, 'ai', userId);
        throw err;
      }
    };

    try {
      if (!apiKey && providerId !== 'ollama') {
        throw new Error(`API Key missing for provider ${providerId}`);
      }

      // Get available models for the provider
      const providerModels = await provider.getModels(apiKey || "", baseUrl);
      const modelToUse = model || (providerModels && providerModels.length > 0 ? providerModels[0] : "gemini-3-pro-preview");

      logEvent('debug', `Attempting AI generation with ${providerId} (${modelToUse})`, 'ai');
      return await performCall(modelToUse);
    } catch (err: any) {
      console.error(`AI Provider ${providerId} (${model}) failed:`, err.message);
      
      // Fallback logic
      const availableModels = await provider.getModels(apiKey || "", baseUrl);
      
      for (const fallbackModel of availableModels) {
        if (fallbackModel !== model) {
          logEvent('warn', `Provider ${providerId} (${model}) failed, falling back to ${fallbackModel}`, 'ai');
          try {
            return await performCall(fallbackModel);
          } catch (fallbackErr: any) {
            logEvent('error', `AI fallback generation with ${fallbackModel} failed: ${fallbackErr.message}`, 'ai');
          }
        }
      }
      
      // Global fallback to Gemini if primary provider fails completely
      if (providerId !== 'gemini' && process.env.GEMINI_API_KEY) {
        logEvent('warn', `All fallbacks for ${providerId} failed, trying Gemini as last resort`, 'ai', userId);
        try {
          const geminiProvider = AI_PROVIDERS['gemini'];
          const geminiModels = await geminiProvider.getModels(process.env.GEMINI_API_KEY);
          const geminiModel = geminiModels[0] || "gemini-flash-latest";
          
          logEvent('debug', `Calling global fallback Gemini with model ${geminiModel}`, 'ai', userId);
          const result = await geminiProvider.generate({
            model: geminiModel,
            prompt,
            maxTokens,
            apiKey: process.env.GEMINI_API_KEY,
            logEvent: (level, msg, src) => logEvent(level, msg, src, userId)
          });
          logEvent('info', `Successfully recovered via Gemini fallback`, 'ai', userId);
          return result;
        } catch (geminiErr: any) {
          logEvent('error', `Global Gemini fallback failed: ${geminiErr.message}`, 'ai', userId);
        }
      }
      
      logEvent('error', `AI generation failed with ${providerId} (${model}): ${err.message}`, 'ai');
      throw err;
    }
  }

/**
 * Checks if any scheduled AI regenerations need to run based on user settings.
 * Limits to 3 times per day as specified in settings.
 */
async function checkScheduledRegeneration(userId: number) {
  try {
    const user = await db.prepare("SELECT ai_generation_times, timezone, daily_briefing_updated_at FROM users WHERE id = ?").get(userId) as any;
    if (!user) return;

    let times: string[] = [];
    try {
      times = JSON.parse(user.ai_generation_times || '["off", "off", "off"]');
    } catch (e) {
      times = ["off", "off", "off"];
    }

    const activeTimes = times.filter(t => t && t !== 'off');
    if (activeTimes.length === 0) return;

    const timezone = user.timezone || undefined;
    const now = new Date();
    const nowStr = now.toISOString();

    const formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone
    });
    const currentTimeStr = formatter.format(now);

    const [currH, currM] = currentTimeStr.split(':').map(Number);
    const userLocalMinutes = currH * 60 + currM;

    const todayStrFull = getTodayInTimezone(timezone, now);
    let triggered = false;

    for (const targetTime of activeTimes) {
      const [targetH, targetM] = targetTime.split(':').map(Number);
      const targetLocalMinutes = targetH * 60 + targetM;

      let diff = userLocalMinutes - targetLocalMinutes;
      // Handle midnight wrap-around: if userTime is early morning and target was late night, add 24 hours.
      if (diff < -1200) {
        diff += 1440;
      }

      if (diff >= 0 && diff <= 15) {
        const targetDateTime = getDateTimeInTimezone(timezone, todayStrFull, targetTime);
        if (now >= targetDateTime) {
          const result = await db.prepare(
            "UPDATE users SET daily_briefing_updated_at = ? WHERE id = ? AND (daily_briefing_updated_at IS NULL OR daily_briefing_updated_at < ?)"
          ).run(nowStr, userId, targetDateTime.toISOString());

          if (result.changes > 0) {
            console.log(`[ai-scheduler] Triggering scheduled regeneration for user ${userId} at ${targetTime}`);
            triggered = true;
            break;
          }
        }
      }
    }

    if (triggered) {
      performAIGenerations(userId).catch(err => {
        console.error(`[ai-scheduler] Scheduled generation failed for user ${userId}:`, err);
      });
    }
  } catch (err) {
    console.error("[ai-scheduler] Error in checkScheduledRegeneration:", err);
  }
}

  /**
   * Distils the salient, durable points from a user's recent AI conversations into a
   * compact memory that is fed back into future insight generations so they stay
   * personalised and consistent. Only re-summarises when there are new messages.
   * Returns the (possibly updated) memory string.
   */
  async function updateConversationMemory(user: any): Promise<string> {
    const userId = user.id;
    const existingMemory = user.ai_conversation_memory || '';
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 21);
      const cutoffStr = cutoff.toISOString();

      const messages = await db.prepare(
        "SELECT role, content, timestamp FROM chat_history WHERE user_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 40"
      ).all(userId, cutoffStr) as any[];

      if (!messages || messages.length === 0) return existingMemory;

      const latestMessageTs = messages[0].timestamp;
      const memoryUpdatedAt = user.ai_conversation_memory_updated_at;

      // Nothing new since we last distilled the memory — reuse it.
      if (memoryUpdatedAt && latestMessageTs && new Date(latestMessageTs) <= new Date(memoryUpdatedAt)) {
        return existingMemory;
      }

      const transcript = [...messages].reverse()
        .map(m => `${m.role === 'user' ? 'User' : 'Coach'}: ${String(m.content).slice(0, 600)}`)
        .join('\n');

      const memoryPrompt = `You maintain a concise, durable memory of what matters to this person so their AI health & fitness coach stays consistent and personalised across sessions.

EXISTING MEMORY (may be empty):
${existingMemory || '(none yet)'}

RECENT CONVERSATION (oldest first):
${transcript}

Update the memory. Capture only durable, salient points: the user's stated goals, preferences, constraints, injuries or health concerns, dietary choices, recurring questions, and things they reacted positively or negatively to. Merge new information with the existing memory, drop anything now stale or contradicted, and keep it general (avoid day-specific numbers).

Output ONLY a short markdown bullet list (max 10 bullets, one short line each). No preamble, no headings.`;

      const { text } = await callAI(user, memoryPrompt, 1024);
      const memory = (text || '').trim().slice(0, 4000);
      if (memory) {
        await db.prepare("UPDATE users SET ai_conversation_memory = ?, ai_conversation_memory_updated_at = ? WHERE id = ?")
          .run(memory, new Date().toISOString(), userId);
        logEvent('info', `Updated conversation memory for user ${userId}`, 'ai', userId);
        return memory;
      }
      return existingMemory;
    } catch (err: any) {
      logEvent('warn', `Failed to update conversation memory: ${err.message}`, 'ai', userId);
      return existingMemory;
    }
  }

  async function performAIGenerations(userId: number, typesToGenerate?: string[]) {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      logEvent('error', `AI Generation skipped: User not found`, 'ai');
      return;
    }

    logEvent('info', `Starting automatic AI generations for ${user.email} using ${user.ai_provider || 'gemini'}`, 'ai');

    try {
      // Fetch data for context
      // Limit to 30 days for metrics, 14 days for workouts
      const historyDays = 30;
      const workoutHistoryDays = 14;
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - historyDays);
      const cutoffStr = cutoffDate.toISOString();

      const workoutCutoffDate = new Date();
      workoutCutoffDate.setDate(workoutCutoffDate.getDate() - workoutHistoryDays);
      const workoutCutoffStr = workoutCutoffDate.toISOString();

      const rawMetrics = await db.prepare("SELECT type, value, unit, timestamp, source FROM metrics WHERE user_id = ? AND timestamp >= ?").all(userId, cutoffStr);
      const timezone = user.timezone || undefined;
      const filteredMetrics = filterMetricsByPriority(rawMetrics, user.metric_priorities, timezone);
      const metrics = filteredMetrics;
      
      const targets = await db.prepare("SELECT * FROM targets WHERE user_id = ?").all(userId);
      const routines = await db.prepare("SELECT * FROM routines WHERE user_id = ?").all(userId);
      
      // Use latest 2 weeks of workouts to inform AI generation
      const workouts = await db.prepare("SELECT * FROM workouts WHERE user_id = ? AND timestamp >= ? ORDER BY timestamp DESC").all(userId, workoutCutoffStr);

      // Get IDs for exercises and sets
      const workoutIds = workouts.map((w: any) => w.id);
      
      const exercises = workoutIds.length > 0 ? await db.prepare(`SELECT * FROM workout_exercises WHERE workout_id IN (${workoutIds.map(() => '?').join(',')})`).all(...workoutIds) : [];
      const exerciseIds = exercises.map((ex: any) => ex.id);
      const sets = exerciseIds.length > 0 ? await db.prepare(`SELECT * FROM workout_sets WHERE exercise_id IN (${exerciseIds.map(() => '?').join(',')})`).all(...exerciseIds) : [];
      
      const mealItems = await db.prepare("SELECT * FROM meal_items WHERE user_id = ? AND timestamp >= ? ORDER BY timestamp DESC").all(userId, cutoffStr);
      
      const routineIds = routines.map((r: any) => r.id);
      const routineExercises = routineIds.length > 0 ? await db.prepare(`SELECT * FROM routine_exercises WHERE routine_id IN (${routineIds.map(() => '?').join(',')})`).all(...routineIds) : [];

      // Helper to aggregate metrics (simplified version of geminiService.ts)
      const aggregateData = () => {
        const grouped: Record<string, any> = {};
        const nutritionMetrics = [
          'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 
          'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e', 
          'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water',
          'biotin', 'caffeine', 'cholesterol', 'copper', 'folate', 'niacin', 'iodine',
          'fat_monounsaturated', 'fat_polyunsaturated', 'fat_saturated', 'riboflavin',
          'phosphorus', 'manganese', 'thiamin', 'selenium', 'pantothenic_acid'
        ];
        const summedMetrics = [
          'steps', 'active_energy', 'basal_energy', 'flights', 'exercise_time', 'stand_time', 
          'sleep', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake',
          'time_in_daylight', 'walking_running_distance'
        ];

        // Create formatter once for massive performance boost
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: user.timezone || undefined,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });

        metrics.forEach((m: any) => {
          const dateObj = new Date(m.timestamp);
          if (m.type.startsWith('sleep')) {
            dateObj.setHours(dateObj.getHours() - 12);
          }
          
          let date;
          try {
            date = formatter.format(dateObj);
          } catch(e) {
            date = dateObj.toISOString().split('T')[0];
          }

          if (!grouped[date]) grouped[date] = {};
          if (!grouped[date][m.type]) grouped[date][m.type] = { sum: 0, count: 0 };
          grouped[date][m.type].sum += Number(m.value);
          grouped[date][m.type].count += 1;
        });

        return Object.entries(grouped).map(([date, types]) => {
          const agg: any = { date };
          Object.entries(types as any).forEach(([type, val]: [string, any]) => {
            const isSummed = summedMetrics.includes(type) || nutritionMetrics.includes(type);
            agg[type] = isSummed ? val.sum : (val.sum / val.count);
          });
          return agg;
        }).sort((a, b) => b.date.localeCompare(a.date));
      };

      const aggregated = aggregateData();
      const bodyWeightTrends = aggregated.slice(0, 90).map(a => {
        if (a.weight) {
           return { date: a.date, weight: typeof a.weight === 'number' ? Number(a.weight.toFixed(2)) : a.weight };
        }
        return null;
      }).filter(Boolean);

      const previousInsights = await db.prepare("SELECT content, date FROM ai_insights WHERE user_id = ? AND type = 'combined' ORDER BY date DESC, updated_at DESC LIMIT 2").all(userId) as any[];

      // Compact recent-session summary: top working set per exercise as a progression proxy.
      const workoutSummaries = workouts.slice(0, 12).map((w: any) => {
        const wExs = exercises.filter((ex: any) => ex.workout_id === w.id);
        return {
          name: w.name,
          date: w.timestamp,
          duration_minutes: Math.round((w.duration || 0) / 60),
          volume: w.volume || undefined,
          exercises: wExs.slice(0, 8).map((ex: any) => {
            const exSets = sets.filter((s: any) => s.exercise_id === ex.id);
            if (ex.exercise_type === 'cardio') {
              const totalDist = exSets.reduce((acc: number, s: any) => acc + (s.distance || 0), 0);
              const totalTime = exSets.reduce((acc: number, s: any) => acc + (s.time || 0), 0);
              const compactEx: any = { title: ex.exercise_title, sets: exSets.length };
              if (totalDist > 0) compactEx.distance_meters = totalDist;
              if (totalTime > 0) compactEx.duration_seconds = totalTime;
              return compactEx;
            }
            const best = exSets.reduce((acc: any, s: any) => {
              if (s.weight != null && (!acc || s.weight > acc.weight)) return s;
              return acc;
            }, null);
            const compactEx: any = { title: ex.exercise_title, sets: exSets.length };
            if (best) compactEx.top_set = { weight_kg: best.weight, reps: best.reps };
            return compactEx;
          })
        };
      });

      const combinedContext = JSON.stringify({
        body_weight_history_90_days: bodyWeightTrends,
        daily_metrics: aggregated.map(a => {
          const compact: any = { date: a.date };
          Object.entries(a).forEach(([k, v]) => {
            if (k !== 'date' && v !== 0) compact[k] = typeof v === 'number' ? Number(v.toFixed(2)) : v;
          });
          return compact;
        }).slice(0, 25),
        meal_items_history: mealItems.slice(0, 20).map((m: any) => ({ name: m.name, calories: m.calories, timestamp: m.timestamp })),
        recent_workouts: workoutSummaries,
        routines_available: routines.map((r: any) => ({
          routine_name: r.name,
          folder_name: r.folder_name,
          exercises: routineExercises.filter((re: any) => re.routine_id === r.id).map((re: any) => ({
            title: re.exercise_title,
            sets_count: re.sets_count
          }))
        })),
        targets: targets,
        medications: (() => {
          try {
            const parsed = user.medications ? JSON.parse(user.medications) : [];
            return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
          } catch (e) {
            return [];
          }
        })()
      });

      logEvent('debug', `Combined context constructed: ${Math.round(combinedContext.length / 1024)} KB`, 'ai', userId);

      const today = getTodayInTimezone(user.timezone || undefined);
      const batchId = Date.now().toString();
      const batchTime = new Date().toISOString();

      // Single unified review covering nutrition, training, body/vitals and progress vs targets.
      if (!typesToGenerate || typesToGenerate.includes('combined')) {
        try {
          // Refresh the durable memory of what the user cares about from recent conversations,
          // then let it steer this regeneration.
          const conversationMemory = await updateConversationMemory(user);

          const combinedPrompt = `You are a ${user.ai_persona || 'supportive expert health & fitness coach'} writing a single, unified health & fitness review for a ${user.age || ''}y ${user.gender || 'person'}. Focus area: ${user.ai_focus || 'General Health'}.
${conversationMemory ? `\nWHAT THIS PERSON CARES ABOUT (remembered from recent conversations — let this steer what you emphasise and the advice you give):\n${conversationMemory}\n` : ''}${previousInsights.length ? `\nYOUR PREVIOUS REVIEWS (summaries — build on these and focus on what is NEW or CHANGING; do not repeat old advice verbatim):\n${previousInsights.map(pi => `- ${pi.date}: ${String(pi.content).substring(0, 250)}...`).join('\n')}\n` : ''}
User hints: ${user.ai_hints || 'None'}
Targets: ${JSON.stringify(targets)}

DATA (the ONLY source of truth — never invent values; distinguish strictly between targets and actual recent values):
${combinedContext}

Write ONE cohesive review in Markdown covering ALL of the following, in this order:

## 📊 Progress vs Targets
A markdown table comparing each target to the user's latest/recent actuals from the data, with Trend and Progress columns. Use the most recent real value; never assume a target has been met.

## 🥗 Nutrition
Review recent calories & macros vs targets using daily_metrics and meal_items_history. Call out 2-3 specific foods or patterns.

## 🏋️ Training
Review workout consistency, volume and intensity from recent_workouts. Note progression on key lifts (compare top sets over time) and suggest concrete next-session progressions, referencing routines_available where relevant.

## ❤️ Body & Vitals
Review body composition (weight, body fat, muscle mass) trends and vitals (resting HR, sleep, HRV) from the data.

## 🎯 Focus Now
3-4 concise, specific, data-driven actions. Where it connects, tie these back to what this person cares about.

Be precise, analytical, and ${user.ai_persona ? `match a "${user.ai_persona}" tone` : 'supportive'}. Strictly Markdown.`;

          const { text, provider, model } = await callAI(user, combinedPrompt);
          if (text) {
            await db.prepare(`
              INSERT INTO ai_insights (user_id, type, content, date, provider, model, batch_id, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(userId, 'combined', text, today, provider, model, batchId, batchTime);

            logEvent('info', `Generated combined insight for user ${userId}`, 'ai', userId);
          }
        } catch (err: any) {
          logEvent('error', `Failed to generate combined insight: ${err.message}`, 'ai', userId);
        }
      }
    } catch (error: any) {
      logEvent('error', `AI Generation failed: ${error.message}`, 'ai', userId);
    }
  }

  // Modular Data Sync Endpoints
  await app.get("/api/modules", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    const user = await db.prepare("SELECT modules_config FROM users WHERE id = ?").get(userId) as { modules_config: string };
    const config = user.modules_config ? JSON.parse(user.modules_config) : {};
    
    const modulesWithConfig = modules.map(m => ({
      ...m,
      enabled: config[m.id]?.enabled !== false,
      userSettings: config[m.id]?.settings || {}
    }));
    
    res.json(modulesWithConfig);
  });

  app.post("/api/modules/:moduleId/toggle", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    const { moduleId } = req.params;
    const { enabled } = req.body;
    
    const user = await db.prepare("SELECT modules_config FROM users WHERE id = ?").get(userId) as { modules_config: string };
    const config = user.modules_config ? JSON.parse(user.modules_config) : {};
    
    if (!config[moduleId]) config[moduleId] = {};
    config[moduleId].enabled = enabled;
    
    await db.prepare("UPDATE users SET modules_config = ? WHERE id = ?").run(JSON.stringify(config), userId);
    res.json({ success: true });
  });

  app.post("/api/modules/:moduleId/settings", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    const { moduleId } = req.params;
    const { settings } = req.body;
    
    const user = await db.prepare("SELECT modules_config FROM users WHERE id = ?").get(userId) as { modules_config: string };
    const config = user.modules_config ? JSON.parse(user.modules_config) : {};
    
    if (!config[moduleId]) config[moduleId] = {};
    config[moduleId].settings = { ...(config[moduleId].settings || {}), ...settings };
    
    await db.prepare("UPDATE users SET modules_config = ? WHERE id = ?").run(JSON.stringify(config), userId);
    res.json({ success: true });
  });

  app.post("/api/sync/:moduleId", requireAuth, async (req: any, res) => {
    const userId = Number(req.user.id);
    const { moduleId } = req.params;
    const module = modules.find(m => m.id === moduleId);

    if (!module) {
      return res.status(404).json({ error: "Module not found" });
    }

    // Clear caches immediately to ensure next fetch gets fresh data from DB (even if sync is still ongoing)
    clearUserCache(userId);
    activeSyncs.add(userId);

    syncQueue.enqueue({
      execute: async () => {
        try {
          const user = await db.prepare("SELECT modules_config, timezone FROM users WHERE id = ?").get(userId) as { modules_config: string; timezone?: string };
          const config = user.modules_config ? JSON.parse(user.modules_config) : {};
          const userSettings = { ...config[moduleId]?.settings, timezone: user.timezone };
          
          const result = await module.sync(userId, db, (level: any, msg: any, src: any) => logEvent(level, msg, src, userId), userSettings, req.body);
          
          if (result.success) {
            logEvent('info', result.message || `Synced ${moduleId} successfully`, moduleId, userId);
          } else {
            logEvent('error', result.message || `Sync failed for ${moduleId}`, moduleId, userId);
          }

          // Clear caches again after sync finishes to ensure new data is reflected
          clearUserCache(userId);
        } catch (error) {
          console.error(`Sync error for module ${moduleId}:`, error);
        } finally {
          activeSyncs.delete(userId);
        }
      }
    });
    res.status(202).json({ message: "Sync started" });
  });

  await app.get("/api/sync/status", requireAuth, (req: any, res) => {
    const userId = Number(req.user.id);
    res.json({ isSyncing: activeSyncs.has(userId) });
  });

  app.post("/api/purge/:moduleId", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    const { moduleId } = req.params;
    const module = modules.find(m => m.id === moduleId);

    if (!module) {
      return res.status(404).json({ error: "Module not found" });
    }

    try {
      const user = await db.prepare("SELECT modules_config FROM users WHERE id = ?").get(userId) as { modules_config: string };
      const config = user.modules_config ? JSON.parse(user.modules_config) : {};
      const userSettings = config[moduleId]?.settings || {};

      const result = await module.purge(userId, db, userSettings);
      clearUserCache(userId);
      res.json(result);
    } catch (error) {
      console.error(`Purge error for module ${moduleId}:`, error);
      res.status(500).json({ error: "Purge failed", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/purge/apple-health-workouts", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    try {
      logEvent('warn', 'Purging Apple Health workout data...', 'apple_health', userId);
      
      await db.transaction(async () => {
        // Delete workout sets for Apple Health workouts
        await db.prepare(`
          DELETE FROM workout_sets 
          WHERE exercise_id IN (
            SELECT id FROM workout_exercises 
            WHERE workout_id IN (
              SELECT id FROM workouts WHERE user_id = ? AND source = 'apple_health'
            )
          )
        `).run(userId);

        // Delete workout exercises for Apple Health workouts
        await db.prepare(`
          DELETE FROM workout_exercises 
          WHERE workout_id IN (
            SELECT id FROM workouts WHERE user_id = ? AND source = 'apple_health'
          )
        `).run(userId);

        // Delete Apple Health workouts
        const result = await db.prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'apple_health'").run(userId);
        
        logEvent('info', `Purged ${result.changes} Apple Health workouts`, 'apple_health', userId);
      })();

      res.json({ success: true });
    } catch (error: any) {
      logEvent('error', `Failed to purge Apple Health data: ${error.message}`, 'apple_health', userId);
      res.status(500).json({ error: "Failed to purge Apple Health data" });
    }
  });

  await app.get("/api/debug/workouts", requireAuth, async (req: any, res) => {
    const workouts = await db.prepare("SELECT * FROM workouts WHERE user_id = ?").all(req.user.id);
    res.json(workouts);
  });

  // Fetch Data for Frontend
  const CACHE_TTL = 1000 * 30; // 30 seconds

  app.post("/api/data/refresh", requireAuth, (req: any, res) => {
    clearUserCache(req.user.id);
    res.json({ success: true });
  });

  await app.get("/api/metrics/aggregated", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    const { type, startDate, endDate, granularity, aggregation } = req.query;

    if (!type || !granularity) {
      return res.status(400).json({ error: 'Missing type or granularity' });
    }

    const typeStr = String(type);
    const requestedTypes = typeStr.split(',');

    const cacheKey = `${userId}-${typeStr}-${startDate}-${endDate}-${granularity}-${aggregation}`;
    const cachedData = await metricsCache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    let cutoffStr: string;
    try {
      if (startDate) {
        const d = new Date(startDate as string);
        d.setUTCHours(0, 0, 0, 0); // Include full start day
        cutoffStr = d.toISOString();
      } else {
        cutoffStr = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      }
    } catch (e) {
      cutoffStr = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    let endStr: string;
    try {
      endStr = endDate ? new Date(endDate as string).toISOString() : new Date().toISOString();
    } catch (e) {
      endStr = new Date().toISOString();
    }

    const mappings: Record<string, string> = {
      "step_count": "steps",
      "stepCount": "steps",
      "active_energy_burned": "active_energy",
      "activeEnergy": "active_energy",
      "basal_energy_burned": "basal_energy",
      "basalEnergy": "basal_energy",
      "dietary_energy": "calories_in",
      "flights_climbed": "flights",
      "flightsClimbed": "flights",
      "apple_exercise_time": "exercise_time",
      "appleExerciseTime": "exercise_time",
      "apple_stand_time": "stand_time",
      "appleStandTime": "stand_time",
      "average_heart_rate": "heart_rate",
      "heartRate": "heart_rate",
      "heart_rate_average": "heart_rate",
      "heart_rate_variability_sdnn": "hrv",
      "heartRateVariabilitySDNN": "hrv",
      "heart_rate_variability": "hrv",
      "blood_oxygen_saturation": "oxygen_saturation",
      "oxygenSaturation": "oxygen_saturation",
      "blood_oxygen": "oxygen_saturation",
      "respiratory_rate_avg": "respiratory_rate",
      "respiratoryRate": "respiratory_rate",
      "respiratory_rate_average": "respiratory_rate",
      "resting_heart_rate_avg": "resting_heart_rate",
      "restingHeartRate": "resting_heart_rate",
      "walking_heart_rate_average": "walking_heart_rate",
      "walkingHeartRateAverage": "walking_heart_rate",
      "walking_heart_rate_avg": "walking_heart_rate",
      "body_mass": "weight",
      "body_fat_percentage": "body_fat",
      "lean_body_mass": "lean_body_mass",
      "skeletal_muscle_mass": "muscle_mass",
      "skeletal_muscle": "muscle_mass",
      "pulse_wave_velocity": "pulse_wave_velocity",
      "visceral_fat": "visceral_fat",
      "metabolic_age": "metabolic_age",
      "nerve_health": "nerve_health",
      "body_mass_index": "bmi",
      "vo2_max": "vo2max",
      "vo2Max": "vo2max"
    };

    // Build query types including mappings
    const allQueryTypes: string[] = [];
    requestedTypes.forEach(rt => {
      if (!allQueryTypes.includes(rt)) allQueryTypes.push(rt);
      // Auto-include weight and body_fat for derived metrics
      if (rt === 'lean_body_mass' || rt === 'fat_mass') {
        if (!allQueryTypes.includes('weight')) allQueryTypes.push('weight');
        if (!allQueryTypes.includes('body_fat')) allQueryTypes.push('body_fat');
      }
      for (const [raw, clean] of Object.entries(mappings)) {
        if (clean === rt && !allQueryTypes.includes(raw)) allQueryTypes.push(raw);
      }
    });

    const typePlaceholders = allQueryTypes.map(() => '?').join(',');

    const metrics = await db.prepare(`
      SELECT value, timestamp, source, type
      FROM metrics 
      WHERE user_id = ? AND type IN (${typePlaceholders})
      AND ${ db.type === 'sqlite' ? `CASE 
        WHEN timestamp LIKE '____-__-__ __:__:__%' THEN replace(substr(timestamp, 1, 19), ' ', 'T') || substr(timestamp, 20)
        ELSE timestamp 
      END` : 'timestamp' } >= ? 
      AND ${ db.type === 'sqlite' ? `CASE 
        WHEN timestamp LIKE '____-__-__ __:__:__%' THEN replace(substr(timestamp, 1, 19), ' ', 'T') || substr(timestamp, 20)
        ELSE timestamp 
      END` : 'timestamp' } <= ?
      ORDER BY timestamp ASC
      LIMIT 1000000
    `).all(userId, ...allQueryTypes, cutoffStr, endStr) as any[];

    const userData = await db.prepare("SELECT timezone, metric_priorities FROM users WHERE id = ?").get(userId) as any;
    const userTimezone = userData?.timezone || undefined;
    const prioritiesJson = userData?.metric_priorities || null;
    const filteredMetrics = filterMetricsByPriority(metrics, prioritiesJson, userTimezone);

    const groupedByDate: Record<string, Record<string, { sum: number, count: number, max: number, min: number }>> = {};
    
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    for (const m of filteredMetrics) {
      let adjustedTimestamp = m.timestamp;
      // Canonicalize type
      let canonicalType = m.type;
      for (const [raw, clean] of Object.entries(mappings)) {
        if (raw === m.type) {
          canonicalType = clean;
          break;
        }
      }

      const isSleep = m.type.startsWith('sleep') || canonicalType.startsWith('sleep');
      
      // Smart ISO parsing for mixed formats
      let d: Date;
      if (adjustedTimestamp.includes(' ') && adjustedTimestamp.length >= 19) {
          // Format like "2026-01-27 19:39:00 +0000"
          const isoLike = adjustedTimestamp.replace(' ', 'T').replace(/ ([+-])/, '$1');
          d = new Date(isoLike);
      } else {
          d = new Date(adjustedTimestamp);
      }

      if (isNaN(d.getTime()) && adjustedTimestamp.length > 10) {
           d = new Date(adjustedTimestamp.replace(' ', 'T'));
      }

      if (isSleep && !isNaN(d.getTime())) {
         d.setHours(d.getHours() - 12);
         adjustedTimestamp = d.toISOString();
      }

      let localDayStr: string;
      if (isNaN(d.getTime())) {
          localDayStr = adjustedTimestamp.substring(0, 10);
      } else {
          try {
            localDayStr = formatter.format(d);
          } catch (e) {
            localDayStr = d.toISOString().split('T')[0];
          }
      }

      let key = "";
      if (granularity === 'day') {
        key = localDayStr;
      } else if (granularity === 'week') {
        const localDay = new Date(localDayStr + 'T00:00:00Z');
        localDay.setUTCDate(localDay.getUTCDate() - localDay.getUTCDay());
        key = localDay.toISOString().split('T')[0];
      } else { // month
        key = `${localDayStr.substring(0, 7)}-01`;
      }

      if (!groupedByDate[key]) groupedByDate[key] = {};
      if (!groupedByDate[key][canonicalType]) {
        groupedByDate[key][canonicalType] = { sum: 0, count: 0, max: -Infinity, min: Infinity };
      }
      
      groupedByDate[key][canonicalType].sum += m.value;
      groupedByDate[key][canonicalType].count += 1;
      if (m.value > groupedByDate[key][canonicalType].max) groupedByDate[key][canonicalType].max = m.value;
      if (m.value < groupedByDate[key][canonicalType].min) groupedByDate[key][canonicalType].min = m.value;
    }

    const result = Object.entries(groupedByDate).map(([date, typeGroups]) => {
      const entry: any = { date };
      Object.entries(typeGroups).forEach(([t, data]) => {
        let val: number;
        if (aggregation === 'sum') val = data.sum;
        else if (aggregation === 'max') val = data.max !== -Infinity ? data.max : 0;
        else if (aggregation === 'min') val = data.min !== Infinity ? data.min : 0;
        else val = data.sum / data.count;
        
        entry[t] = Number(val.toFixed(2));
      });

      // Calculate Fat Mass (kg) if weight and body_fat (%) are available
      if (entry.weight && entry.body_fat && !entry.fat_mass) {
        entry.fat_mass = Number((entry.weight * (entry.body_fat / 100)).toFixed(2));
      }

      // Calculate Lean Body Mass (kg) if weight and body_fat (%) are available
      if (entry.weight && entry.body_fat && !entry.lean_body_mass) {
        entry.lean_body_mass = Number((entry.weight * (1 - entry.body_fat / 100)).toFixed(2));
      }
      
      return entry;
    }).sort((a, b) => a.date.localeCompare(b.date));

    metricsCache.set(cacheKey, result);
    res.json(result);
  });

  await app.get("/api/data/summary", requireAuth, async (req: any, res) => {
    const userId = Number(req.user.id);

    // Check for scheduled AI regenerations FIRST (run asynchronously to avoid blocking the summary response)
    checkScheduledRegeneration(userId).catch(err => {
      console.error("[summary] Error starting scheduled regeneration:", err);
    });

    const cacheEntry = await summaryCache.get(userId);
    if (cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL)) {
      return res.json(cacheEntry.data);
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    
    // Fetch metrics - we want to ensure we get a good spread of data.
    // High frequency metrics (steps, heart_rate) can easily hit the 100k limit.
    // We'll fetch weight/fat/muscle fully (up to 5000 each) and others with a limit.
    
    const userData = await db.prepare("SELECT sync_history_days, timezone FROM users WHERE id = ?").get(userId) as any;
    const historyDays = userData?.sync_history_days || 90;
    
    // For the summary view, we want to see more historical data than just the sync window.
    // 365 days allows for year-over-year comparisons and long term trends.
    const summaryHistoryDays = 365;
    const defaultCutoffDate = new Date();
    defaultCutoffDate.setDate(defaultCutoffDate.getDate() - summaryHistoryDays);
    
    let cutoffStr: string;
    try {
      cutoffStr = startDate ? new Date(startDate).toISOString() : defaultCutoffDate.toISOString();
    } catch (e) {
      cutoffStr = defaultCutoffDate.toISOString();
    }
    const userTimezone = userData?.timezone || 'UTC';

    // Optimize: Create formatter once outside the loop
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const keyMetrics = await db.prepare(`
      SELECT * FROM metrics 
      WHERE user_id = ? AND type IN ('weight', 'body_fat', 'muscle_mass', 'lean_body_mass')
      AND ${ db.type === 'sqlite' ? "replace(timestamp, ' ', 'T')" : "timestamp" } >= ?
      ORDER BY timestamp DESC 
      LIMIT 10000
    `).all(userId, cutoffStr);

    const nutritionMetrics = [
      'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 
      'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e', 
      'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water',
      'biotin', 'caffeine', 'cholesterol', 'copper', 'folate', 'niacin', 'iodine',
      'fat_monounsaturated', 'fat_polyunsaturated', 'fat_saturated', 'riboflavin',
      'phosphorus', 'manganese', 'thiamin', 'selenium', 'pantothenic_acid'
    ];

    const summedMetrics = [
      'steps', 'active_energy', 'basal_energy', 'flights', 'exercise_time', 'stand_time', 
      'sleep', 'sleep_total', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake',
      'time_in_daylight', 'walking_running_distance'
    ];

    const rawMetrics = await db.prepare(`
      SELECT type, value, unit, timestamp, source 
      FROM metrics 
      WHERE user_id = ? AND type NOT IN ('weight', 'body_fat', 'muscle_mass', 'body_mass', 'body_fat_percentage')
      AND ${ db.type === 'sqlite' ? "replace(timestamp, ' ', 'T')" : "timestamp" } >= ?
      ORDER BY timestamp DESC
      LIMIT 1000000
    `).all(userId, cutoffStr) as any[];

    const prioritiesJson = userData?.metric_priorities || null;
    const filteredMetrics = filterMetricsByPriority(rawMetrics, prioritiesJson, userTimezone);
    const filteredKeyMetrics = filterMetricsByPriority(keyMetrics, prioritiesJson, userTimezone);

    const dailySourceMetrics: Record<string, Record<string, Record<string, { total: number, count: number, unit: string }>>> = {};

    // Cache for date strings to avoid repeated formatter calls
    const dateCache = new Map<string, string>();

    for (const m of filteredMetrics) {
      // Ensure we have a string for timestamp processing
      let tsString = "";
      if (m.timestamp instanceof Date) {
        tsString = m.timestamp.toISOString();
      } else {
        tsString = String(m.timestamp || '');
      }

      let adjustedTimestamp = tsString;
      if (m.type.startsWith('sleep')) {
         let d = new Date(tsString);
         if (tsString.indexOf('Z') === -1 && tsString.indexOf('+') === -1 && tsString.indexOf('-') === -1 && tsString.length > 10) {
            d = new Date(tsString + 'Z');
         }
         d.setHours(d.getHours() - 12);
         if (!isNaN(d.getTime())) {
           adjustedTimestamp = d.toISOString();
         }
      }

      let day = dateCache.get(adjustedTimestamp);
      
      if (!day) {
        let d = new Date(adjustedTimestamp);
        // Ensure adjustedTimestamp is a string before calling string methods
        const tsStr = String(adjustedTimestamp || '');
        if (tsStr.indexOf('Z') === -1 && tsStr.indexOf('+') === -1 && tsStr.indexOf('-') === -1 && tsStr.length > 10) {
          d = new Date(tsStr + 'Z');
        }
        
        try {
          day = formatter.format(d);
        } catch (e) {
          day = tsStr.substring(0, 10);
        }
        dateCache.set(adjustedTimestamp, day);
      }
      
      if (!day) continue;
      
      if (!dailySourceMetrics[m.type]) dailySourceMetrics[m.type] = {};
      if (!dailySourceMetrics[m.type][day]) dailySourceMetrics[m.type][day] = {};
      if (!dailySourceMetrics[m.type][day][m.source]) dailySourceMetrics[m.type][day][m.source] = { total: 0, count: 0, unit: m.unit };
      
      dailySourceMetrics[m.type][day][m.source].total += Number(m.value);
      dailySourceMetrics[m.type][day][m.source].count += 1;
    }

    // Reconcile sleep metrics: Ensure 'sleep' total is at least sum of core+rem+deep
    const sleepDays = new Set<string>();
    ['sleep', 'sleep_core', 'sleep_deep', 'sleep_rem'].forEach(type => {
      if (dailySourceMetrics[type]) {
        Object.keys(dailySourceMetrics[type]).forEach(d => sleepDays.add(d));
      }
    });

    for (const day of sleepDays) {
      const getSumAllSources = (type: string) => {
        const sources = dailySourceMetrics[type]?.[day];
        if (!sources) return 0;
        return Object.values(sources).reduce((acc, s) => acc + s.total, 0);
      };

      const sumStages = getSumAllSources('sleep_core') + getSumAllSources('sleep_rem') + getSumAllSources('sleep_deep');
      const existingSleep = getSumAllSources('sleep');

      if (sumStages > existingSleep) {
        if (!dailySourceMetrics['sleep']) dailySourceMetrics['sleep'] = {};
        if (!dailySourceMetrics['sleep'][day]) {
          dailySourceMetrics['sleep'][day] = { 'apple_health': { total: sumStages, count: 1, unit: 's' } };
        } else {
          // Adjust the existing source values proportionally or just add to the first one
          const sources = Object.keys(dailySourceMetrics['sleep'][day]);
          if (sources.length > 0) {
            const firstSource = sources[0];
            const currentTotalForDay = getSumAllSources('sleep');
            const diff = sumStages - currentTotalForDay;
            dailySourceMetrics['sleep'][day][firstSource].total += diff;
          }
        }
      }
    }

    const highFreqMetrics = [];

    for (const type of Object.keys(dailySourceMetrics)) {
      const isSummed = summedMetrics.includes(type) || nutritionMetrics.includes(type);
      const isNutrition = nutritionMetrics.includes(type);
      
      for (const day of Object.keys(dailySourceMetrics[type])) {
        const sources = dailySourceMetrics[type][day];
        
        if (true) { // Apply source prioritization to all metrics
          let bestSource = null;
          let bestRank = 999;
          for (const source of Object.keys(sources)) {
            let rank = 4;
            if (source === 'cronometer') rank = 1;
            else if (source === 'nutracheck') rank = 2;
            else if (source === 'hevy') rank = 2;
            else if (source === 'apple_health') rank = 3;
            
            if (rank < bestRank) {
              bestRank = rank;
              bestSource = source;
            }
          }
          
          if (bestSource) {
            const s = sources[bestSource];
            highFreqMetrics.push({
              type,
              timestamp: day,
              value: isSummed ? s.total : s.total / s.count,
              unit: s.unit
            });
          }
        } 
      }
    }

    highFreqMetrics.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const metrics = [...keyMetrics, ...highFreqMetrics];
    
    // Construct latestMetrics from aggregated data to ensure consistency
    const latestMetricsResults: any[] = [];
    
    // 1. Get latest individual key metrics (weight, etc.)
    const keyMetricTypes = new Set<string>();
    keyMetrics.forEach(m => {
      if (!keyMetricTypes.has(m.type)) {
        latestMetricsResults.push({ ...m });
        keyMetricTypes.add(m.type);
      }
    });

    // 2. Find latest night for sleep metrics
    // We simply pick the newest valid date present in the sleep metrics array.
    let latestSleepNight = "";
    
    // Sort highFreqMetrics (which are grouped by day) by date descending, filtering out corrupted timestamps
    const sleepMetrics = highFreqMetrics.filter(m => 
      m.type.startsWith('sleep') && 
      m.timestamp && 
      m.timestamp !== 'null' && 
      m.timestamp !== 'undefined' &&
      m.timestamp.length >= 10 &&
      !m.timestamp.includes('null')
    ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (sleepMetrics.length > 0) {
      // Pick the absolute latest date string that has any sleep data
      latestSleepNight = sleepMetrics[0].timestamp;
    }
    
    // Get current today string for debug info
    const todayStr = getTodayInTimezone(userTimezone, new Date());
    console.log(`[summary] Calculated latestSleepNight: ${latestSleepNight} (Current today in ${userTimezone}: ${todayStr})`);

    // Log the found values for debugging
    const debugLatestSleep = highFreqMetrics.filter(m => m.type.startsWith('sleep') && m.timestamp === latestSleepNight);
    console.log(`[summary] Metrics for latestSleepNight (${latestSleepNight}):`, debugLatestSleep.map(m => `${m.type}=${(m.value/3600).toFixed(2)}h`).join(', '));

    // 3. Get latest for other high frequency metrics
    const hfMetricTypes = new Set<string>();
    highFreqMetrics.forEach(m => {
      if (m.type.startsWith('sleep')) {
        if (m.timestamp === latestSleepNight) {
          // Check if this type is already in latestMetricsResults (shouldn't be, but to be safe)
          if (!latestMetricsResults.find(lm => lm.type === m.type)) {
            const copyObject = { ...m };
            // Ensure consistency: if this is a summed sleep metric, and the value is in seconds, keep it in seconds
            latestMetricsResults.push(copyObject);
          }
        }
      } else if (!hfMetricTypes.has(m.type)) {
        latestMetricsResults.push({ ...m });
        hfMetricTypes.add(m.type);
      }
    });

    // Ensure sleep stages are present and reconciled in latestMetricsResults
    const sleep_core = latestMetricsResults.find((m: any) => m.type === 'sleep_core');
    const sleep_rem = latestMetricsResults.find((m: any) => m.type === 'sleep_rem');
    const sleep_deep = latestMetricsResults.find((m: any) => m.type === 'sleep_deep');
    const sleep_awake = latestMetricsResults.find((m: any) => m.type === 'sleep_awake');
    let sleep_total = latestMetricsResults.find((m: any) => m.type === 'sleep');

    if (sleep_core || sleep_rem || sleep_deep) {
      const sum = (sleep_core?.value || 0) + (sleep_rem?.value || 0) + (sleep_deep?.value || 0);
      if (sleep_total) {
        // If individual stages sum up to more than the total, or the total is significantly different,
        // we prioritize the sum of stages as it's more granular and usually more accurate.
        // Also ensure awake is not in total if requested by common conventions
        if (Math.abs(sum - sleep_total.value) > 60) { // More than 1 minute difference
          console.log(`[summary] Reconciling sleep total from stages for ${latestSleepNight}: total=${sleep_total.value}, core+rem+deep=${sum}. Using sum.`);
          sleep_total.value = sum;
        }
      } else {
        sleep_total = {
          type: 'sleep',
          timestamp: latestSleepNight,
          value: sum,
          unit: sleep_core?.unit || sleep_rem?.unit || sleep_deep?.unit || 's'
        };
        latestMetricsResults.push(sleep_total);
      }
    }
    
    // Log the actual latestMetrics for sleep to verify values
    const debugSleep = latestMetricsResults.filter(m => m.type.startsWith('sleep'));
    console.log(`[summary] Final latest sleep metrics for ${latestSleepNight}:`, JSON.stringify(debugSleep));

    const counts: Record<string, number> = {};
    metrics.forEach(m => {
      counts[m.type] = (counts[m.type] || 0) + 1;
    });
    console.log(`[summary] Metric counts: ${JSON.stringify(counts)}`);

    const workouts = await db.prepare(`
      SELECT w.*, r.folder_name as routine_folder 
      FROM workouts w 
      LEFT JOIN routines r ON w.routine_external_id = r.external_id 
      WHERE w.user_id = ?
      ORDER BY w.timestamp DESC 
      LIMIT 1000
    `).all(userId);
    console.log(`[summary] Workouts fetched: ${workouts.length}`);
    const routines = await db.prepare("SELECT * FROM routines WHERE user_id = ? ORDER BY id DESC").all(userId);
    const routineExercises = await db.prepare("SELECT * FROM routine_exercises WHERE routine_id IN (SELECT id FROM routines WHERE user_id = ?)").all(userId);

    // Get exercises for the fetched workouts
    const workoutIds = workouts.map((w: any) => w.id);
    let exercises: any[] = [];
    let sets: any[] = [];
    if (workoutIds.length > 0) {
      exercises = await db.prepare(`SELECT * FROM workout_exercises WHERE workout_id IN (${workoutIds.join(',')})`).all();
      const exerciseIds = exercises.map(e => e.id);
      if (exerciseIds.length > 0) {
        sets = await db.prepare(`SELECT * FROM workout_sets WHERE exercise_id IN (${exerciseIds.join(',')})`).all();
      }
    }

    const latestMetrics = latestMetricsResults;

    const mealCutoffDate = new Date();
    mealCutoffDate.setDate(mealCutoffDate.getDate() - 90);
    const mealCutoffStr = mealCutoffDate.toISOString();

    const mealItems = await db.prepare(`
      SELECT * FROM meal_items 
      WHERE user_id = ? AND timestamp >= ?
      ORDER BY timestamp DESC
    `).all(userId, mealCutoffStr);

    const syncLogs = await db.prepare(`
      SELECT source as module, MAX(timestamp) as timestamp, 'success' as status 
      FROM logs 
      WHERE user_id = ? AND level = 'info' 
      GROUP BY source
    `).all(userId);

    const result = { metrics, latestMetrics, workouts, routines, routineExercises, exercises, sets, mealItems, syncLogs };
    summaryCache.set(userId, { data: result, timestamp: Date.now() });
    console.log(`[summary] Cache set for user ${userId}`);
    res.json(result);
  });

  await app.get("/api/targets", requireAuth, async (req: any, res) => {
    const targets = await db.prepare("SELECT * FROM targets WHERE user_id = ?").all(req.user.id);
    res.json(targets);
  });

  app.post("/api/debug/deduplicate", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    try {
      const workouts = await db.prepare("SELECT id, timestamp, source, name FROM workouts WHERE source = 'hevy' AND user_id = ?").all(userId) as any[];
      let removedCount = 0;

      const transaction = db.transaction(async () => {
        for (const w of workouts) {
          const startTime = new Date(w.timestamp).getTime();
          const windowMs = 30 * 60 * 1000; // 30 minutes
          const startTimeMin = new Date(startTime - windowMs).toISOString();
          const startTimeMax = new Date(startTime + windowMs).toISOString();

          // Delete dependent records first to avoid foreign key constraint errors
          const workoutDuplicates = await db.prepare(`
            SELECT id, name, timestamp, source FROM workouts
            WHERE source = 'apple_health' AND user_id = ?
            AND timestamp BETWEEN ? AND ?
          `).all(userId, startTimeMin, startTimeMax) as any[];

          if (workoutDuplicates.length > 0) {
            const table = workoutDuplicates.map(d => `ID: ${d.id} | Name: ${d.name} | TS: ${d.timestamp} | Source: ${d.source}`).join('\n');
            logEvent('debug', `Manual deduplication: Duplicate Apple Health workouts found and cleaning up:\n${table}`, 'debug', userId);

            await db.prepare(`
              DELETE FROM workout_sets
              WHERE exercise_id IN (
                SELECT id FROM workout_exercises
                WHERE workout_id IN (
                  SELECT id FROM workouts
                  WHERE source = 'apple_health' AND user_id = ?
                  AND timestamp BETWEEN ? AND ?
                )
              )
            `).run(userId, startTimeMin, startTimeMax);

            await db.prepare(`
              DELETE FROM workout_exercises
              WHERE workout_id IN (
                SELECT id FROM workouts
                WHERE source = 'apple_health' AND user_id = ?
                AND timestamp BETWEEN ? AND ?
              )
            `).run(userId, startTimeMin, startTimeMax);

            const deleted = await db.prepare(`
              DELETE FROM workouts
              WHERE source = 'apple_health' AND user_id = ?
              AND timestamp BETWEEN ? AND ?
            `).run(userId, startTimeMin, startTimeMax);

            removedCount += deleted.changes;
          }
        }
      });

      await transaction();
      res.json({ status: "ok", removed: removedCount });
    } catch (error: any) {
      console.error("Deduplicate failed:", error);
      res.status(500).json({ error: "Deduplication failed" });
    }
  });

  await app.get("/api/meals/frequent", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    try {
      const frequentMeals = await db.prepare(`
        SELECT name, COUNT(*) as log_count, 
               AVG(calories) as calories, 
               AVG(protein) as protein, 
               AVG(carbs) as carbs, 
               AVG(fat) as fat
        FROM meal_items
        WHERE user_id = ? AND name IS NOT NULL AND name != ''
        GROUP BY name
        ORDER BY log_count DESC
        LIMIT 100
      `).all(userId);
      res.json(frequentMeals);
    } catch (e: any) {
      console.error("Failed to fetch frequent meals:", e);
      res.status(500).json({ error: "Failed to fetch frequent meals" });
    }
  });

  app.post('/api/routines/apply-progression', requireAuth, async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { routineId, progressions } = req.body;
    if (!routineId || !progressions || !Array.isArray(progressions)) {
      return res.status(400).json({ error: 'Missing routineId or progressions array' });
    }

    try {
      await db.transaction(async () => {
        for (const p of progressions) {
          await db.prepare(`
            UPDATE routine_exercises 
            SET target_weight = ?, target_reps = ?, target_distance = ?, target_time = ?
            WHERE routine_id = ? AND LOWER(exercise_title) = LOWER(?)
          `).run(
            p.target_weight || null,
            p.target_reps || null,
            p.target_distance || null,
            p.target_time || null,
            routineId,
            p.exercise_title
          );
        }
      })();
      logEvent('info', `Applied progressions to routine ${routineId} for user ${userId}`, 'routines', userId);
      res.json({ success: true });
    } catch (err: any) {
      logEvent('error', `Failed to apply progressions: ${err.message}`, 'routines', userId);
      res.status(500).json({ error: err.message });
    }
  });

  await app.get("/api/ai/data", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    
    // 7 days of meal items from Cronometer
    const mealCutoff = new Date();
    mealCutoff.setDate(mealCutoff.getDate() - 7);
    const mealItems = await db.prepare(`
      SELECT * FROM meal_items 
      WHERE user_id = ? AND source = 'cronometer' AND timestamp >= ?
      ORDER BY timestamp DESC
    `).all(userId, mealCutoff.toISOString());

    // 90 days of Withings data
    const withingsCutoff = new Date();
    withingsCutoff.setDate(withingsCutoff.getDate() - 90);
    const withingsMetrics = await db.prepare(`
      SELECT * FROM metrics 
      WHERE user_id = ? AND source = 'withings' AND timestamp >= ?
      ORDER BY timestamp DESC
    `).all(userId, withingsCutoff.toISOString());

    // 14 days of Hevy workout data
    const workoutCutoff = new Date();
    workoutCutoff.setDate(workoutCutoff.getDate() - 14);
    const workouts = await db.prepare(`
      SELECT w.*, r.folder_name as routine_folder 
      FROM workouts w 
      LEFT JOIN routines r ON w.routine_external_id = r.external_id 
      WHERE w.user_id = ? AND w.source = 'hevy' AND w.timestamp >= ?
      ORDER BY w.timestamp DESC
    `).all(userId, workoutCutoff.toISOString());
    
    const workoutIds = workouts.map((w: any) => w.id);
    const exercises = workoutIds.length > 0 ? await db.prepare(`SELECT * FROM workout_exercises WHERE workout_id IN (${workoutIds.map(() => '?').join(',')})`).all(...workoutIds) : [];
    const exerciseIds = exercises.map((ex: any) => ex.id);
    const sets = exerciseIds.length > 0 ? await db.prepare(`SELECT * FROM workout_sets WHERE exercise_id IN (${exerciseIds.map(() => '?').join(',')})`).all(...exerciseIds) : [];

    // All non-archived Hevy routines
    const routines = await db.prepare("SELECT * FROM routines WHERE user_id = ? AND folder_name != 'Archive'").all(userId);
    const routineIds = routines.map((r: any) => r.id);
    const routineExercises = routineIds.length > 0 ? await db.prepare(`SELECT * FROM routine_exercises WHERE routine_id IN (${routineIds.map(() => '?').join(',')})`).all(...routineIds) : [];

    // 90 days of averaged Apple Health data
    const appleCutoff = new Date();
    appleCutoff.setDate(appleCutoff.getDate() - 90);
    const appleMetrics = await db.prepare(`
      SELECT type, value, unit, timestamp, source 
      FROM metrics 
      WHERE user_id = ? AND source = 'apple_health' AND ${ db.type === 'sqlite' ? "replace(timestamp, ' ', 'T')" : "timestamp" } >= ?
    `).all(userId, appleCutoff.toISOString()) as any[];

    // Aggregate Apple Health data by day and type
    const appleDaily: Record<string, Record<string, { total: number, count: number, unit: string }>> = {};
    const summedMetrics = [
      'steps', 'active_energy', 'basal_energy', 'flights', 'exercise_time', 'stand_time', 
      'sleep', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake',
      'time_in_daylight', 'walking_running_distance', 'calories_in', 'protein', 'carbs', 
      'fat', 'fiber', 'sugar', 'sodium', 'iron', 'calcium', 'vitamin_c', 'vitamin_a', 
      'vitamin_d', 'vitamin_e', 'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 
      'potassium', 'zinc', 'water'
    ];

    for (const m of appleMetrics) {
      const day = m.timestamp.substring(0, 10);
      if (!appleDaily[day]) appleDaily[day] = {};
      if (!appleDaily[day][m.type]) appleDaily[day][m.type] = { total: 0, count: 0, unit: m.unit };
      appleDaily[day][m.type].total += m.value;
      appleDaily[day][m.type].count += 1;
    }

    const aggregatedAppleMetrics: any[] = [];
    for (const day of Object.keys(appleDaily)) {
      for (const type of Object.keys(appleDaily[day])) {
        const s = appleDaily[day][type];
        aggregatedAppleMetrics.push({
          type,
          timestamp: day,
          value: summedMetrics.includes(type) ? s.total : s.total / s.count,
          unit: s.unit,
          source: 'apple_health'
        });
      }
    }

    logEvent('debug', `Fetched AI data: ${workouts.length} workouts, ${routines.length} routines, ${mealItems.length} meal items`, 'App');
    res.json({
      mealItems,
      metrics: [...withingsMetrics, ...aggregatedAppleMetrics],
      workouts,
      exercises,
      sets,
      routines,
      routineExercises
    });
  });

  async function updateHevyRoutine(userId: number, routine_external_id: string, routine_title: string, progressions: any[]) {
    const userSettings = await db.prepare("SELECT hevy_api_key FROM users WHERE id = ?").get(userId) as any;
    const apiKey = (userSettings?.hevy_api_key || "").trim();
    if (!apiKey) {
      throw new Error("Hevy API key not configured");
    }

    // 1. Fetch current routine from Hevy to get template IDs and full structure
    // We try direct ID fetch first for performance and to ensure full details (like supersets) are loaded
    logEvent('info', `Fetching current Hevy routine ${routine_external_id} (${routine_title || 'No Title'}) for update`, 'hevy', userId);
    
    let routine: any = null;

    try {
      const resp = await axios.get(`https://api.hevyapp.com/v1/routines/${routine_external_id}`, {
        headers: { 
          "api-key": apiKey,
          "accept": "application/json"
        }
      });
      routine = resp.data;
      logEvent('info', `Directly fetched Hevy routine ${routine_external_id} details`, 'hevy', userId);
    } catch (e) {
      logEvent('debug', `Direct fetch failed for routine ${routine_external_id}, falling back to list search`, 'hevy', userId);
    }

    if (!routine) {
      let page = 1;
      let keepFetching = true;
      while (keepFetching && page <= 10) {
        const routinesRes = await axios.get("https://api.hevyapp.com/v1/routines", {
          headers: { 
            "api-key": apiKey,
            "accept": "application/json"
          },
          params: { page }
        });

        const fetchedRoutines = routinesRes.data.routines || [];
        if (fetchedRoutines.length === 0) {
          keepFetching = false;
          break;
        }

        // Try to find by ID or by title
        const found = fetchedRoutines.find((r: any) => 
          String(r.id) === String(routine_external_id) ||
          r.title.toLowerCase().trim() === String(routine_title || routine_external_id).toLowerCase().trim()
        );

        if (found) {
          // If found in list, still fetch full details to ensure supersets and other deep structures are present
          try {
            const detailRes = await axios.get(`https://api.hevyapp.com/v1/routines/${found.id}`, {
              headers: { 
                "api-key": apiKey,
                "accept": "application/json"
              }
            });
            routine = detailRes.data;
            logEvent('info', `Fetched full details for routine found in list: ${routine.title}`, 'hevy', userId);
          } catch (e) {
            logEvent('warn', `Failed to fetch routine details for ${found.id}, using list summary data`, 'hevy', userId);
            routine = found;
          }
          keepFetching = false;
          break;
        }

        if (fetchedRoutines.length < 10) {
          keepFetching = false;
        } else {
          page++;
        }
      }
    }

    if (!routine) {
      throw new Error(`Routine ${routine_external_id} not found in Hevy routines list.`);
    }

    // 2. Update the routine with suggested progressions
    const updatedRoutine = { ...routine };
    updatedRoutine.exercises = updatedRoutine.exercises.map((ex: any) => {
      // Find matching progression by title
      const progression = progressions.find((p: any) => {
        const pTitle = (p.exercise_title || '').toLowerCase();
        const exTitle = (ex.title || ex.exercise_title || '').toLowerCase();
        return pTitle === exTitle && pTitle !== '';
      });

      if (progression) {
        return {
          ...ex,
          sets: progression.sets.map((s: any, idx: number) => {
              const originalSet = ex.sets[idx] || ex.sets[ex.sets.length - 1]; // Fallback to last set if more sets suggested
              const newSet = { ...originalSet };
              
              if (s.weight_kg !== undefined) newSet.weight_kg = s.weight_kg;
              if (s.reps !== undefined) newSet.reps = s.reps;
              if (s.distance_meters !== undefined) newSet.distance_meters = s.distance_meters;
              if (s.duration_seconds !== undefined) newSet.duration_seconds = s.duration_seconds;
              
              return newSet;
            })
        };
      }
      return ex;
    });

    // 3. Send update to Hevy
    await axios.put(`https://api.hevyapp.com/v1/routines/${routine.id}`, {
      routine: {
        title: updatedRoutine.title || routine.title,
        notes: updatedRoutine.notes || updatedRoutine.description || routine.notes || null,
        folder_id: updatedRoutine.folder_id || routine.folder_id || null,
        exercises: updatedRoutine.exercises.map((ex: any) => ({
          exercise_template_id: ex.exercise_template_id,
          superset_id: ex.superset_id !== undefined ? ex.superset_id : null,
          rest_seconds: ex.rest_seconds !== undefined ? ex.rest_seconds : (ex.rest_seconds || 0),
          notes: ex.notes || null,
          sets: ex.sets.map((s: any) => ({
            type: s.type || 'normal',
            weight_kg: s.weight_kg !== undefined ? s.weight_kg : 0,
            reps: s.reps !== undefined ? s.reps : 0,
            distance_meters: s.distance_meters || null,
            duration_seconds: s.duration_seconds || null,
            rpe: s.rpe || null
          }))
        }))
      }
    }, {
      headers: { 
        "api-key": apiKey,
        "accept": "application/json",
        "Content-Type": "application/json"
      }
    });

    logEvent('info', `Successfully updated Hevy routine: ${updatedRoutine.title}`, 'hevy');
    return { success: true, message: "Routine updated successfully" };
  }

  app.post("/api/hevy/update-routine", requireAuth, express.json(), async (req: any, res) => {
    const userId = req.user.id;
    const { routine_external_id, routine_title, progressions } = req.body;

    if (!routine_external_id || !progressions) {
      return res.status(400).json({ error: "Missing routine_external_id or progressions" });
    }

    try {
      const result = await updateHevyRoutine(userId, routine_external_id, routine_title, progressions);
      
      // Update local routine info too for immediate feedback
      await db.transaction(async () => {
        const routine = await db.prepare("SELECT id FROM routines WHERE external_id = ?").get(routine_external_id) as any;
        if (routine) {
          for (const p of progressions) {
            // Store the first set as the "target" for the main routine view if applicable
            // or we could add routine_sets table (feature for later)
            const firstSet = p.sets && p.sets[0];
            if (firstSet) {
              await db.prepare(`
                UPDATE routine_exercises 
                SET target_weight = ?, target_reps = ?, target_distance = ?, target_time = ?
                WHERE routine_id = ? AND LOWER(exercise_title) = LOWER(?)
              `).run(
                firstSet.weight_kg || null,
                firstSet.reps || null,
                firstSet.distance_meters || null,
                firstSet.duration_seconds || null,
                routine.id,
                p.exercise_title
              );
            }
          }
        }
      })();

      res.json(result);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      logEvent('error', `Failed to update Hevy routine: ${errorMsg}`, 'hevy', userId);
      res.status(500).json({ error: `Failed to update Hevy routine: ${errorMsg}` });
    }
  });

  await app.get("/api/logs", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    try {
      const logFile = getLogFilePath();
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n').reverse();
        
        const parsedLogs = [];
        for (const line of lines) {
          const match = line.match(/\[(.*?)\] \[(.*?)\] (?:\[User (\d+)\] )?(.*?): (.*)/);
          if (match) {
            const logUserId = match[3];
            // Only show logs for this user or system logs (no user ID)
            if (!logUserId || parseInt(logUserId) === userId) {
              parsedLogs.push({
                id: parsedLogs.length,
                timestamp: match[1],
                source: match[2],
                level: match[4].toLowerCase(),
                message: match[5]
              });
            }
          }
          if (parsedLogs.length >= 500) break;
        }
        res.json(parsedLogs);
      } else {
        const logs = await db.prepare("SELECT * FROM logs WHERE user_id = ? OR user_id IS NULL ORDER BY timestamp DESC LIMIT 200").all(userId);
        res.json(logs);
      }
    } catch (e) {
      console.error("Failed to fetch logs from file:", e);
      const logs = await db.prepare("SELECT * FROM logs WHERE user_id = ? OR user_id IS NULL ORDER BY timestamp DESC LIMIT 200").all(userId);
      res.json(logs);
    }
  });

  app.post("/api/logs", requireAuth, (req: any, res) => {
    const { level, message, source } = req.body;
    if (!level || !message || !source) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // Attribute the log to the authenticated user instead of writing a spoofable system (NULL) log.
    logEvent(level, message, source, req.user.id);
    res.json({ status: "ok" });
  });

  await app.get("/api/chat-history", requireAuth, async (req: any, res) => {
    const { date, batch_id } = req.query;
    try {
      let query = "SELECT role, content, batch_id FROM chat_history WHERE user_id = ? AND date = ?";
      const params = [req.user.id, date];
      
      if (batch_id) {
        query += " AND batch_id = ?";
        params.push(batch_id);
      }
      
      query += " ORDER BY timestamp ASC";
      const history = await db.prepare(query).all(...params);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat history" });
    }
  });

  app.post("/api/chat-history", requireAuth, express.json(), async (req: any, res) => {
    const { role, content, date, batch_id } = req.body;
    try {
      await db.prepare("INSERT INTO chat_history (user_id, role, content, date, batch_id) VALUES (?, ?, ?, ?, ?)").run(req.user.id, role, content, date, batch_id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save chat message" });
    }
  });

  await app.get("/api/ai/insights", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    const force = req.query.force === 'true';

    // Trigger check if not forcing
    if (!force) {
      checkScheduledRegeneration(userId).catch(e => console.error("Error in insights trigger check:", e));
    } else {
      const type = req.query.type as string;
      logEvent('info', `Manual AI insights regeneration requested${type ? ` for type ${type}` : ''}`, 'ai', userId);
      await performAIGenerations(userId, type ? [type] : ['combined']);
    }

    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 30;
      const user = await db.prepare("SELECT timezone FROM users WHERE id = ?").get(userId) as any;
      const timezone = user?.timezone || undefined;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffStr = getTodayInTimezone(timezone, cutoffDate);
      
      logEvent('debug', `Fetching AI insights for user ${req.user.id} since ${cutoffStr}`, 'api');
      const insights = await db.prepare("SELECT * FROM ai_insights WHERE user_id = ? AND (date >= ? OR date IS NULL) ORDER BY date DESC, updated_at DESC").all(req.user.id, cutoffStr);
      logEvent('debug', `Found ${insights.length} insights`, 'api');
      res.json(insights);
    } catch (e: any) {
      logEvent('error', `Failed to fetch AI insights: ${e.message}`, 'api');
      res.status(500).json({ error: e.message });
    }
  });

  const postAIInsights = async (req: any, res: any) => {
    try {
      const { type, content, date, provider, model, batch_id, updated_at } = req.body;
      const user = await db.prepare("SELECT timezone FROM users WHERE id = ?").get(req.user.id) as any;
      const timezone = user?.timezone || undefined;
      const insightDate = date || getTodayInTimezone(timezone);
      const batchTime = updated_at || new Date().toISOString();
      
      logEvent('debug', `Saving AI insight type=${type} for date=${insightDate} batch=${batch_id}`, 'api');
      
      await db.prepare(`
        INSERT INTO ai_insights (user_id, type, content, date, provider, model, batch_id, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.id, type, content, insightDate, provider, model, batch_id, batchTime);
      
      logEvent('debug', `Successfully saved AI insight type=${type}`, 'api');
      res.json({ success: true });
    } catch (e: any) {
      logEvent('error', `Failed to save AI insight: ${e.message}`, 'api');
      res.status(500).json({ error: e.message });
    }
  };

  app.post("/api/ai-insights", requireAuth, express.json(), postAIInsights);
  app.post("/api/ai/insights", requireAuth, express.json(), postAIInsights);

  // Durable "salient points" memory distilled from the user's recent conversations.
  // Surfaced in the UI so the user can see what is steering their insights.
  await app.get("/api/ai/memory", requireAuth, async (req: any, res) => {
    try {
      const row = await db.prepare("SELECT ai_conversation_memory, ai_conversation_memory_updated_at FROM users WHERE id = ?").get(req.user.id) as any;
      res.json({
        memory: row?.ai_conversation_memory || '',
        updated_at: row?.ai_conversation_memory_updated_at || null
      });
    } catch (e: any) {
      logEvent('error', `Failed to fetch conversation memory: ${e.message}`, 'api');
      res.status(500).json({ error: e.message });
    }
  });

  // AI Models Cache
  let availableGeminiModels: string[] = ["gemini-flash-latest", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"];

  // Expose to global scope for access in callAI
  (global as any).availableGeminiModels = availableGeminiModels;

  async function refreshGeminiModels() {
    try {
      // Try to get API key from env first
      let apiKey = process.env.GEMINI_API_KEY;
      
      // If not in env, try to get from the first user in the database
      if (!apiKey) {
        const user = await db.prepare("SELECT ai_api_key FROM users WHERE ai_api_key IS NOT NULL AND ai_api_key != '' LIMIT 1").get() as { ai_api_key: string } | undefined;
        if (user) apiKey = user.ai_api_key;
      }

      if (apiKey) {
        const geminiProvider = AI_PROVIDERS['gemini'];
        availableGeminiModels = await geminiProvider.getModels(apiKey);
        (global as any).availableGeminiModels = availableGeminiModels;
      }
    } catch (e) {
      console.error('Failed to refresh Gemini models:', e);
    }
  }

  // Refresh models on startup
  refreshGeminiModels();

  // Startup probe: check OpenAI-compatible providers (Ollama, OpenAI, OpenRouter, Mistral)
  (async () => {
    try {
      for (const [id, p] of Object.entries(AI_PROVIDERS)) {
        const baseUrl = (p as any).baseUrl;
        if (!baseUrl) continue;
        try {
          await probeProvider(baseUrl, id);
          console.log(`[ai-probe] Provider ${id} at ${baseUrl} is reachable`);
        } catch (e) {
          console.warn(`[ai-probe] Provider ${id} at ${baseUrl} probe failed: ${e?.message || e}`);
        }
      }
    } catch (e) {
      console.error('AI provider startup probe failed:', e);
    }
  })();

  // API to get models
  await app.get("/api/ai/models", requireAuth, (req: any, res) => {
    res.json({ gemini: availableGeminiModels });
  });

  await app.get("/api/ai/providers", requireAuth, async (req: any, res) => {
    const userId = req.user.id;
    try {
      const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      if (!user) return res.status(404).json({ error: "User not found" });

      const configs = await db.prepare("SELECT * FROM ai_configs WHERE user_id = ?").all(userId) as any[];

      const providers = await Promise.all(Object.values(AI_PROVIDERS).map(async (p) => {
        try {
          const config = configs.find(c => c.provider === p.id);
          const isCurrent = user.ai_provider === p.id;
          
          const apiKey = config?.api_key || (isCurrent ? user.ai_api_key : "") || (p.id === 'gemini' ? process.env.GEMINI_API_KEY : "");
          const baseUrl = config?.base_url || (isCurrent ? user.ai_base_url : undefined);
          
          let models: string[] = [];
          try {
            models = await p.getModels(apiKey || "", baseUrl);
          } catch (e: any) {
            logEvent('warn', `Failed to get models for provider ${p.id}: ${e.message}`, 'ai', userId);
            // Provide simple localized fallbacks if getModels fails completely
            if (p.id === 'mistral') models = ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "open-mixtral-8x22b", "open-mixtral-8x7b"];
            else if (p.id === 'openai') models = ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
            else if (p.id === 'openrouter') models = ["anthropic/claude-3-opus", "anthropic/claude-3-sonnet", "anthropic/claude-3-haiku", "google/gemini-pro", "mistralai/mistral-large"];
            else if (p.id === 'gemini') models = ["gemini-2.0-flash", "gemini-flash-latest", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash-8b"];
            else if (p.id === 'groq') models = ["deepseek-r1-distill-llama-70b", "llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
          }
          
          return {
            id: p.id,
            name: p.name,
            models,
            constraints: p.getConstraints(isCurrent ? user.ai_model : (config?.model || (models[0] || "")))
          };
        } catch (err: any) {
          logEvent('error', `Detailed mapping failed for provider ${p.id}: ${err.message}`, 'ai', userId);
          return {
            id: p.id,
            name: p.name,
            models: [],
            constraints: p.getConstraints()
          };
        }
      }));

      res.json({ providers });
    } catch (e: any) {

      logEvent('error', `Failed to fetch AI providers: ${e.message}`, 'ai');
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/fetch-models", requireAuth, express.json(), async (req: any, res) => {
    const { providerId, apiKey, baseUrl } = req.body;
    if (!providerId) return res.status(400).json({ error: "Missing providerId" });

    const provider = AI_PROVIDERS[providerId];
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    try {
      const models = await provider.getModels(apiKey || "", baseUrl);
      res.json({ models });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/generate", requireAuth, express.json(), async (req: any, res) => {
    logEvent('info', `Received request to /api/ai/generate`, 'ai');
    const { prompt, maxTokens, model: requestedModel, provider: requestedProvider } = req.body;
    const userId = req.user.id;

    try {
      const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Override user settings if specific model/provider requested
      const aiUser = {
        ...user,
        ai_provider: requestedProvider || user.ai_provider,
        ai_model: requestedModel || user.ai_model
      };

      const { text, provider, model } = await callAI(aiUser, prompt, maxTokens || 8192);
      res.json({ text, provider, model });
    } catch (error: any) {
      logEvent('error', `On-demand AI generation failed: ${error.message}`, 'ai');
      res.status(500).json({ error: error.message });
    }
  });

  await app.get("/api/ai/cache/:key", requireAuth, async (req: any, res) => {
    try {
      const cache = await db.prepare("SELECT * FROM user_cache WHERE user_id = ? AND cache_key = ?").get(req.user.id, req.params.key) as any;
      res.json(cache ? { content: JSON.parse(cache.content), updated_at: cache.updated_at } : null);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/cache/:key", requireAuth, express.json(), async (req: any, res) => {
    try {
      const { content } = req.body;
      await db.prepare(`
        INSERT INTO user_cache (user_id, cache_key, content, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, cache_key) DO UPDATE SET
          content = excluded.content,
          updated_at = CURRENT_TIMESTAMP
      `).run(req.user.id, req.params.key, JSON.stringify(content));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/configs", requireAuth, express.json(), async (req: any, res) => {
    const { configs } = req.body;
    if (!Array.isArray(configs)) {
      return res.status(400).json({ error: "Invalid configs format" });
    }

    try {
      const insertStmt = db.prepare(`
        INSERT INTO ai_configs (user_id, provider, api_key, model, base_url)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          api_key = excluded.api_key,
          model = excluded.model,
          base_url = excluded.base_url
      `);

      const transaction = db.transaction(async (data) => {
        for (const config of data) {
          await insertStmt.run(req.user.id, config.provider, config.api_key || null, config.model || null, config.base_url || null);
        }
      });

      await transaction(configs);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/targets", requireAuth, express.json(), async (req: any, res) => {
    const { targets } = req.body;
    const insertStmt = db.prepare(`
      ${db.type === 'sqlite' ? 'INSERT OR REPLACE' : 'INSERT'} INTO targets (user_id, type, value, unit) 
      VALUES (?, ?, ?, ?)
      ${db.type === 'postgres' ? 'ON CONFLICT (user_id, type) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit' : ''}
    `);
    const transaction = db.transaction(async (tData) => {
      for (const t of tData) {
        await insertStmt.run(req.user.id, t.type, t.value, t.unit);
      }
    });
    await transaction(targets);
    res.json({ success: true });
  });

  await app.get("/api/debug/metrics", requireAuth, async (req: any, res) => {
    const types = await db.prepare("SELECT DISTINCT type FROM metrics WHERE user_id = ?").all(req.user.id);
    res.json(types);
  });

  await app.get("/api/debug/last-metrics", requireAuth, async (req: any, res) => {
    const metrics = await db.prepare("SELECT * FROM metrics WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50").all(req.user.id);
    res.json(metrics);
  });

  // Settings Endpoints
  await app.get("/api/settings", requireAuth, async (req: any, res) => {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id) as any;
    if (user) {
      // Never serialize authentication secrets to the client.
      delete user.password_hash;
      delete user.export_token;
      const aiConfigs = await db.prepare("SELECT * FROM ai_configs WHERE user_id = ?").all(req.user.id);
      user.ai_configs = aiConfigs;
    }
    res.json(user || {});
  });

  app.post("/api/settings", requireAuth, async (req: any, res) => {
    const { 
      withings_client_id, withings_client_secret, hevy_api_key, email, name, sync_history_days, age, dob, gender, height, display_mode,
      ai_provider, ai_api_key, ai_base_url, ai_hints, ai_persona, ai_focus, meal_suggestion_breakfast, meal_suggestion_lunch, meal_suggestion_dinner,
      show_debug_logs, ai_model, medications, preferred_units, default_graph_range, default_graph_grouping, timezone,
      ai_generation_times, metric_priorities, font_size, dashboard_widgets
    } = req.body;
    
    // In a real app, we'd use environment variables or a more secure way to store these.
    // For this demo, we'll update the database.
    
    // Check if user exists
    const existingUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id) as any;
    
    if (existingUser) {
      console.log(`[settings] Updating settings for user ${req.user.id}, widgets count: ${dashboard_widgets?.length}`);
      const params = [
        email || 'user@example.com', 
        name || null,
        hevy_api_key || '', 
        sync_history_days || 30,
        age || null,
        dob || null,
        gender || null,
        height || null,
        display_mode || 'auto',
        ai_provider || 'gemini',
        ai_api_key || null,
        ai_base_url || null,
        ai_hints || null,
        ai_persona || 'Encouraging Coach',
        ai_focus || 'General Health',
        meal_suggestion_breakfast ? 1 : 0,
        meal_suggestion_lunch ? 1 : 0,
        meal_suggestion_dinner ? 1 : 0,
        show_debug_logs ? 1 : 0,
        ai_model || null,
        medications ? JSON.stringify(medications) : null,
        preferred_units || 'metric',
        default_graph_range || '30d',
        default_graph_grouping || 'day',
        timezone || undefined,
        ai_generation_times || '["off", "off", "off"]',
        metric_priorities || null,
        font_size || 'medium',
        dashboard_widgets ? JSON.stringify(dashboard_widgets) : null
      ];

      if (withings_client_id) params.push(withings_client_id);
      if (withings_client_secret) params.push(withings_client_secret);
      params.push(req.user.id);

      await db.prepare(`
        UPDATE users SET 
          email = ?, 
          name = ?,
          hevy_api_key = ?, 
          sync_history_days = ?,
          age = ?,
          dob = ?,
          gender = ?,
          height = ?,
          display_mode = ?,
          ai_provider = ?,
          ai_api_key = ?,
          ai_base_url = ?,
          ai_hints = ?,
          ai_persona = ?,
          ai_focus = ?,
          meal_suggestion_breakfast = ?,
          meal_suggestion_lunch = ?,
          meal_suggestion_dinner = ?,
          show_debug_logs = ?,
          ai_model = ?,
          medications = ?,
          preferred_units = ?,
          default_graph_range = ?,
          default_graph_grouping = ?,
          timezone = ?,
          ai_generation_times = ?,
          metric_priorities = ?,
          font_size = ?,
          dashboard_widgets = ?
          ${withings_client_id ? ', withings_client_id = ?' : ''}
          ${withings_client_secret ? ', withings_client_secret = ?' : ''}
        WHERE id = ?
      `).run(...params);

      // Save to ai_configs as well
      if (ai_provider) {
        await db.prepare(`
          INSERT INTO ai_configs (user_id, provider, api_key, model, base_url)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, provider) DO UPDATE SET
            api_key = excluded.api_key,
            model = excluded.model,
            base_url = excluded.base_url
        `).run(req.user.id, ai_provider, ai_api_key || null, ai_model || null, ai_base_url || null);
      }
    } else {
      const defaultWidgets = ['readiness_card', 'stats', 'charts', 'nutrition', 'micronutrient_radar', 'macronutrient_radar', 'smart_adjustments', 'sleep_stages', 'lean_body_mass_chart'];
      await db.prepare(`
        INSERT INTO users (id, email, hevy_api_key, sync_history_days, withings_client_id, withings_client_secret, age, gender, display_mode, preferred_units, default_graph_range, default_graph_grouping, dashboard_widgets) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id,
        email || 'user@example.com', 
        hevy_api_key || '', 
        sync_history_days || 30,
        withings_client_id || '',
        withings_client_secret || '',
        age || null,
        gender || null,
        display_mode || 'auto',
        preferred_units || 'metric',
        default_graph_range || '30d',
        default_graph_grouping || 'day',
        JSON.stringify(defaultWidgets)
      );
    }

    // NOTE: per-user secrets are persisted to the users table above and read
    // per-user at sync time. We deliberately do NOT copy them into process.env
    // — doing so leaked one user's secrets to every other user as a global fallback.

    // Clear user cache so new settings (like metric priorities) take effect immediately
    clearUserCache(req.user.id);

    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/health.db*'],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    await app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  // Terminal error handler: catches anything thrown by route handlers so internal
  // details (stack traces, SQL) aren't leaked to clients and the process stays up.
  app.use((err: any, req: any, res: any, next: any) => {
    console.error(`[error] ${req.method} ${req.path}:`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    logEvent('warn', 'Vitality Hub server started', 'system');
    
    // Database Migration: Normalize timestamps to ISO-8601 with 'T' and '.000Z'
    // This fixes comparison issues for data purged or imported with other formats.
    try {
      await db.transaction(async () => {
        if (db.type === 'sqlite') {
          // Fix spaces to T and ensure trailing .000Z for metrics, but repair double-T corruption from before
          await db.prepare("UPDATE metrics SET timestamp = replace(CAST(timestamp AS TEXT), 'T-', '-') WHERE CAST(timestamp AS TEXT) LIKE '%T-%'").run();
          await db.prepare("UPDATE metrics SET timestamp = replace(CAST(timestamp AS TEXT), 'T+', '+') WHERE CAST(timestamp AS TEXT) LIKE '%T+%'").run();

          // Safe replace for space-separated timezone offsets before converting the core space to T
          await db.prepare("UPDATE metrics SET timestamp = replace(CAST(timestamp AS TEXT), ' -', '-') WHERE CAST(timestamp AS TEXT) LIKE '% -%'").run();
          await db.prepare("UPDATE metrics SET timestamp = replace(CAST(timestamp AS TEXT), ' +', '+') WHERE CAST(timestamp AS TEXT) LIKE '% +%'").run();
          await db.prepare("UPDATE metrics SET timestamp = replace(CAST(timestamp AS TEXT), ' ', 'T') WHERE CAST(timestamp AS TEXT) LIKE '% %'").run();

          await db.prepare("UPDATE metrics SET timestamp = CAST(timestamp AS TEXT) || '.000Z' WHERE CAST(timestamp AS TEXT) LIKE '%T%' AND CAST(timestamp AS TEXT) NOT LIKE '%Z' AND CAST(timestamp AS TEXT) NOT LIKE '%+%' AND CAST(timestamp AS TEXT) NOT LIKE '%-%'").run();
        }
        
        // Increase default sync window for all existing users to 90 days
        await db.prepare("UPDATE users SET sync_history_days = 90 WHERE sync_history_days = 30 OR sync_history_days IS NULL").run();

        // If timezone is explicitly 'UTC', it likely came from the old default.
        // Nulling it allows it to fall back to the system TZ (env variable).
        await db.prepare("UPDATE users SET timezone = NULL WHERE timezone = 'UTC'").run();

        // Migrate historical metric keys to canonical names
        const updateMetricType = db.prepare(`
          ${db.type === 'sqlite' ? 'UPDATE OR IGNORE' : 'UPDATE'} metrics SET type = ? WHERE type = ?
        `);
        
        // Reverse migration for Apple Health lean_body_mass which was incorrectly collapsed into muscle_mass
        await db.prepare("UPDATE metrics SET type = 'lean_body_mass' WHERE type = 'muscle_mass' AND (source = 'apple_health' OR source = 'health_kit' OR source = 'manual')").run();

        const mappings = {
          "step_count": "steps",
          "stepCount": "steps",
          "active_energy_burned": "active_energy",
          "activeEnergy": "active_energy",
          "basal_energy_burned": "basal_energy",
          "basalEnergy": "basal_energy",
          "dietary_energy": "calories_in",
          "flights_climbed": "flights",
          "flightsClimbed": "flights",
          "apple_exercise_time": "exercise_time",
          "appleExerciseTime": "exercise_time",
          "apple_stand_time": "stand_time",
          "appleStandTime": "stand_time",
          "average_heart_rate": "heart_rate",
          "heartRate": "heart_rate",
          "heart_rate_average": "heart_rate",
          "heart_rate_variability_sdnn": "hrv",
          "heartRateVariabilitySDNN": "hrv",
          "heart_rate_variability": "hrv",
          "blood_oxygen_saturation": "oxygen_saturation",
          "oxygenSaturation": "oxygen_saturation",
          "blood_oxygen": "oxygen_saturation",
          "respiratory_rate_avg": "respiratory_rate",
          "respiratoryRate": "respiratory_rate",
          "respiratory_rate_average": "respiratory_rate",
          "resting_heart_rate_avg": "resting_heart_rate",
          "restingHeartRate": "resting_heart_rate",
          "walking_heart_rate_average": "walking_heart_rate",
          "walkingHeartRateAverage": "walking_heart_rate",
          "walking_heart_rate_avg": "walking_heart_rate",
          "body_mass": "weight",
          "body_fat_percentage": "body_fat",
          "lean_body_mass": "lean_body_mass",
          "skeletal_muscle_mass": "muscle_mass",
          "skeletal_muscle": "muscle_mass",
          "body_mass_index": "bmi"
        };
        for (const [raw, clean] of Object.entries(mappings)) {
          await updateMetricType.run(clean, raw);
        }

        // Migrate Postgres foreign keys to ON DELETE CASCADE
        if (db.type === 'postgres') {
          const migrateFK = async (table: string, column: string, refTable: string, refColumn: string) => {
            try {
              // Try to find the actual constraint name using a specific pattern or by querying
              // Usually they are like "${table}_${column}_fkey"
              const constraintName = `${table}_${column}_fkey`;
              await db.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraintName}`);
              await db.exec(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${column}) REFERENCES ${refTable}(${refColumn}) ON DELETE CASCADE`);
            } catch (fkErr) {
              console.warn(`[Migration] Failed to update foreign key for ${table}:`, fkErr.message);
            }
          };
          await migrateFK('workout_exercises', 'workout_id', 'workouts', 'id');
          await migrateFK('workout_sets', 'exercise_id', 'workout_exercises', 'id');
          await migrateFK('routine_exercises', 'routine_id', 'routines', 'id');
        }
      })();
    } catch (migErr: any) {
      console.error("Migration error:", migErr);
    }
    
    async function purgeOldGranularData() {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoff = thirtyDaysAgo.toISOString();

      const types = await db.prepare("SELECT DISTINCT user_id, type FROM metrics WHERE source = 'apple_health' AND timestamp < ?").all(cutoff) as { user_id: number, type: string }[];

      if (types.length === 0) return;

      logEvent('warn', `Purging granular Apple Health data older than 30 days (${types.length} user/type pairs)`, 'system');

      await db.transaction(async () => {
        for (const { user_id, type } of types) {
          const aggregates = await db.prepare(`
            SELECT 
              type,
              CASE 
                WHEN type LIKE 'sleep%' THEN ${
                  db.type === 'sqlite' 
                  ? "substr(datetime(timestamp, '-12 hours'), 1, 10)" 
                  : "TO_CHAR(timestamp - interval '12 hours', 'YYYY-MM-DD')" 
                }
                ELSE ${
                  db.type === 'sqlite' 
                  ? "substr(timestamp, 1, 10)" 
                  : "TO_CHAR(timestamp, 'YYYY-MM-DD')" 
                }
              END as date,
              CASE 
                WHEN type IN ('steps', 'active_energy', 'basal_energy', 'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e', 'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water', 'flights', 'exercise_time', 'stand_time', 'sleep', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'time_in_daylight', 'walking_running_distance') THEN SUM(value)
                ELSE AVG(value)
              END as value,
              MAX(unit) as unit
            FROM metrics 
            WHERE user_id = ? AND source = 'apple_health' AND type = ? AND timestamp < ?
            GROUP BY 
              type, date
          `).all(user_id, type, cutoff) as any[];

          await db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'apple_health' AND type = ? AND timestamp < ?").run(user_id, type, cutoff);

          const insertStmt = db.prepare(`
            ${db.type === 'sqlite' ? 'INSERT OR REPLACE' : 'INSERT'} INTO metrics (user_id, type, value, unit, timestamp, source) 
            VALUES (?, ?, ?, ?, ?, 'apple_health')
            ${db.type === 'postgres' ? 'ON CONFLICT (user_id, type, timestamp, source) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit' : ''}
          `);
          for (const agg of aggregates) {
            if (!agg.date || agg.date === 'null') continue;
            await insertStmt.run(user_id, agg.type, agg.value, agg.unit, agg.date + "T00:00:00.000Z");
          }
        }
      })();
      logEvent('warn', 'Granular data purge complete', 'system');
    }
    
    // Purge bloat on startup
    purgeOldGranularData();

    // Background Sync (runs hourly and at specific AI times)
    let lastSyncKey = "";
    setInterval(async () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const dateStr = now.toISOString().split('T')[0];
      
      const isSyncTime = (minute === 0) || (hour === 0 && minute === 30);
      const syncKey = `${dateStr}-${hour}-${minute}`;

      if (lastSyncKey === syncKey) return;
      lastSyncKey = syncKey;

      const systemTimes = await db.prepare("SELECT value FROM system_config WHERE key = 'ai_generation_times'").get() as any;
      const globalAITimes = systemTimes ? JSON.parse(systemTimes.value) : ['off', 'off', 'off'];

      const users = await db.prepare("SELECT id, email, modules_config, timezone, ai_generation_times FROM users").all() as any[];
      
      for (const user of users) {
        const userId = user.id;
        
        // Determine user's local time
        let localHour = hour;
        let localMinute = minute;
        try {
          const userTimeStr = new Intl.DateTimeFormat('en-GB', {
            timeZone: user.timezone || 'UTC',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).format(now);
          [localHour, localMinute] = userTimeStr.split(':').map(Number);
        } catch (e) {}

        const isSyncTime = (localMinute === 0) || (localHour === 0 && localMinute === 30);
        
        // construct time string 
        const localTimeStr = `${localHour < 10 ? '0' + localHour : localHour}:${localMinute < 10 ? '0' + localMinute : localMinute}`;
        
        let aiGenerationTimes = globalAITimes; // Use global defaults
        if (user.ai_generation_times) {
          try {
            aiGenerationTimes = JSON.parse(user.ai_generation_times);
          } catch (e) {}
        }
        
        const isAITime = aiGenerationTimes.includes(localTimeStr);
        const aiTypesToGenerate = isAITime ? ['combined'] : [];

        if (isSyncTime) {
          logEvent('warn', `Scheduled background sync for ${user.email} (${localHour}:${localMinute})`, 'system', userId);
          
          const config = user.modules_config ? JSON.parse(user.modules_config) : {};
          
          for (const module of modules) {
            if (config[module.id]?.enabled !== false) {
              syncQueue.enqueue({
                execute: async () => {
                  try {
                    const userSettings = { ...config[module.id]?.settings, timezone: user.timezone };
                    await module.sync(userId, db, (level: any, msg: any, src: any) => logEvent(level, msg, src, userId), userSettings);
                  } catch (e) {
                    console.error(`Background sync error for module ${module.id} user ${userId}`, e);
                  }
                }
              });
            }
          }
        }

        // AI Generations (Using centralized checkScheduledRegeneration to ensure it runs correctly)
        checkScheduledRegeneration(userId).catch(e => {
          console.error(`Background AI generation check error for user ${userId}`, e);
        });
      }
      
      lastSyncKey = syncKey;
    }, 30 * 1000); 
  });
}

startServer();
