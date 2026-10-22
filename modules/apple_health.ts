import fs from 'fs';
import path from 'path';
import { DataSourceModule } from "./types";
import { METRIC_MAP, NUTRITION_METRICS, BODY_METRICS } from '../src/constants';
import { offsetSeconds } from '../src/lib/sleepTiming';

// Sweep item 47: the Logs tab's "Raw Metrics Received" table reads
// `last_apple_health_sync_<userId>.json`, and nothing in the repo had ever written
// it, so the table was permanently empty. Written here at the end of every sync.
// `/app/data` is the only persistent mount, so the file lives there (the reader
// still falls back to the old cwd path). A diagnostic must never fail a sync, so
// every failure is swallowed with a warn.
export type AppleSyncNameStat = {
  raw: string;
  mappedTo: string | null;
  points: number;
  noValue: boolean;
};
export type AppleSyncSummary = {
  lastSync: string;
  count: number;
  rawNames: string[];
  names: AppleSyncNameStat[];
};
export const appleSyncSummaryPath = (userId: number | string) =>
  path.join(process.cwd(), 'data', `last_apple_health_sync_${userId}.json`);

export const AppleHealthModule: DataSourceModule = {
  id: "apple_health",
  name: "Apple Health",
  description: "Sync metrics from Apple Health via Health Auto Export",
  metricsProvided: ["active_energy", "basal_energy", "steps", "flights", "exercise_time", "stand_time", "heart_rate", "hrv", "vo2max", "oxygen_saturation", "respiratory_rate", "resting_heart_rate", "walking_heart_rate", "sleep", "blood_pressure", "weight", "body_fat", "lean_body_mass", "muscle_mass"],
  settings: [],
  sync: async (userId, db, logEvent, userSettings, data?: any) => {
    if (!data) return { success: false, message: "No data provided" };
    
    let metrics = [];
    if (Array.isArray(data)) metrics = data;
    else metrics = data?.data?.metrics || data?.metrics || [];

    if (metrics.length === 0) return { success: true, message: "No metrics to sync", count: 0 };

    const insertStmt = db.prepare(`
      INSERT INTO metrics (user_id, type, value, unit, timestamp, source) 
      VALUES (?, ?, ?, ?, ?, 'apple_health')
      ON CONFLICT(user_id, type, timestamp, source) DO UPDATE SET
        value = excluded.value,
        unit = excluded.unit
    `);
    
    const normalizeTimestamp = (ts: any): string => {
      if (!ts) return new Date().toISOString();
      if (typeof ts === 'string') {
        let val = ts.trim();
        // Handle DD/MM/YYYY or D/M/YYYY formats
        const dmYMatch = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)/);
        if (dmYMatch) {
          const [_, d, m, y, rest] = dmYMatch;
          const timePart = rest.trim() ? 'T' + rest.trim().replace(' ', 'T') : '';
          val = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}${timePart}`;
        }
        // Handle YYYY-MM-DD HH:mm:SS +0000 by converting to ISO string
        if (val.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/)) {
          val = val.replace(' ', 'T').replace(/ ([+-])/, '$1');
        }
        ts = val;
      }
      try {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) return d.toISOString();
        return typeof ts === 'string' ? ts : new Date().toISOString();
      } catch (e) {
        return typeof ts === 'string' ? ts : new Date().toISOString();
      }
    };

    const getMetricName = (metric: any): string => {
      const candidates = [metric.name, metric.type, metric.metricType, metric.identifier, metric.id];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'string') {
          return candidate;
        }
      }
      return '';
    };

    const extractDate = (ts: any): string | null => {
      const normalized = normalizeTimestamp(ts);
      const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : null;
    };

    const uniqueDays = new Set<string>();

    // Diagnostics: this module silently drops anything METRIC_MAP doesn't know and
    // anything whose data points carry no recognised value key. Both were invisible
    // (the heart_rate gap from 2026-09-05 was found only by querying the DB), so
    // record them and surface one warn per sync.
    const skippedNames = new Set<string>();
    const noValueNames = new Set<string>();
    // Item 90: the keys of the first main-sleep data point, logged once per sync, so
    // the payload's start/end field names can be checked against the live feed.
    let sleepKeys: string | null = null;
    // Item 47: per-raw-name resolution for the Logs tab. The view used to re-derive
    // "Mapped To"/"Status" from METRIC_MAP itself, which only tried two of the five
    // name candidates this module tries -- a second copy of the mapping logic that
    // was already wrong. The truth is recorded here instead.
    const nameStats = new Map<string, AppleSyncNameStat>();
    const statFor = (raw: string): AppleSyncNameStat => {
      let st = nameStats.get(raw);
      if (!st) {
        st = { raw, mappedTo: null, points: 0, noValue: false };
        nameStats.set(raw, st);
      }
      return st;
    };
    
    for (const metric of metrics) {
      let dataPoints = metric.data || metric.metrics || metric.values || metric.samples || (metric.qty !== undefined || metric.value !== undefined ? [metric] : []);
      if (!Array.isArray(dataPoints)) dataPoints = [dataPoints];
      const metricName = getMetricName(metric);
      for (const dp of dataPoints) {
        const rawTs = dp.date ?? dp.start ?? dp.startDate ?? dp.end ?? dp.endDate ?? dp.timestamp ?? dp.start_time ?? dp.end_time ?? new Date().toISOString();
        const day = extractDate(rawTs);
        if (day) uniqueDays.add(day);
      }
    }

    let count = 0;
    await db.transaction(async () => {
      for (const metric of metrics) {
        let rawName = getMetricName(metric);
        if (!rawName && metric.name === undefined && metric.type === undefined) {
          continue;
        }
        const normalizedName = rawName.toLowerCase().replace(/\s+/g, '_');
        const cleanName = METRIC_MAP[normalizedName] || METRIC_MAP[rawName] || METRIC_MAP[metric.type] || METRIC_MAP[metric.identifier] || METRIC_MAP[metric.id];
        const stat = rawName ? statFor(rawName) : null;
        if (stat) stat.mappedTo = cleanName || null;

        if (!cleanName) {
          if (rawName) skippedNames.add(rawName);
          continue;
        }

        let unit = metric.units || metric.unit || "";
        let dataPoints = metric.data || metric.metrics || metric.values || metric.samples || (metric.qty !== undefined || metric.value !== undefined ? [metric] : []);
        if (!Array.isArray(dataPoints)) dataPoints = [dataPoints];

        for (const dp of dataPoints) {
          const rawTs = dp.date ?? dp.start ?? dp.startDate ?? dp.end ?? dp.endDate ?? dp.timestamp ?? dp.start_time ?? dp.end_time ?? new Date().toISOString();
          const ts = normalizeTimestamp(rawTs);

          if (cleanName === 'blood_pressure') {
            if (dp.systolic !== undefined && dp.diastolic !== undefined) {
              await insertStmt.run(userId, 'blood_pressure_systolic', Number(dp.systolic), unit, ts);
              await insertStmt.run(userId, 'blood_pressure_diastolic', Number(dp.diastolic), unit, ts);
              count += 2;
              if (stat) stat.points += 2;
            }
            continue;
          }

          const val = dp.qty ?? dp.avg ?? dp.value ?? dp.amount ?? dp.qty_value ?? dp.average ?? dp.avg_value ?? dp.totalSleep ?? dp.asleep
            // Health Auto Export sends aggregate metrics (heart_rate, and any other
            // metric Apple stores as a range) as {date, Min, Avg, Max} with capital
            // initials. Take Avg as the representative value, matching the existing
            // "average_heart_rate" -> heart_rate mapping. Min/Max fall back in case a
            // future payload omits Avg.
            ?? dp.Avg ?? dp.Average ?? dp.Qty ?? dp.Value ?? dp.Min ?? dp.Max;
          if (val === undefined || val === null) {
            const keys = dp && typeof dp === 'object' ? Object.keys(dp).sort().join('|') : typeof dp;
            noValueNames.add(`${cleanName} (keys: ${keys})`);
            if (stat) stat.noValue = true;
          }
          if (val !== undefined && val !== null) {
            let numericVal = typeof val === 'number' ? val : parseFloat(String(val));
            if (isNaN(numericVal)) {
              console.warn(`[Apple Health Sync] Invalid numeric value for ${cleanName}:`, val);
              continue;
            }
            const isSleep = cleanName.startsWith('sleep');
            
            // Handle sleep unit conversion (hours to seconds)
            if (isSleep && (unit.toLowerCase().includes('hr') || unit.toLowerCase().includes('hour') || numericVal < 24)) {
              numericVal = numericVal * 3600;
              await insertStmt.run(userId, cleanName, numericVal, 's', ts);
            } else {
              // Unit conversion for energy (kJ to kcal). The `unit` column must follow the
              // value: this converted the number and then stored the incoming 'kJ' string
              // with it, so 262k apple_health energy rows hold kcal values labelled kJ
              // (measured 2026-10-22: basal 1,740/day, which is a plausible BMR in kcal
              // and an impossible 416 kcal in kJ). Two UI surfaces trusted that label and
              // divided by 4.184 a second time.
              if ((cleanName === 'active_energy' || cleanName === 'basal_energy' || cleanName === 'calories_in') && 
                  (unit.toLowerCase().includes('kj') || unit.toLowerCase().includes('kilojoule'))) {
                numericVal = numericVal / 4.184;
                unit = 'kcal';
              }

            try {
              await insertStmt.run(userId, cleanName, numericVal, unit, ts);
            } catch (e) {
              console.error(`[Apple Health Sync] Insert failed for ${cleanName}:`, e.message);
            }
            }
            
            count++;
            if (stat) stat.points++;
            
            // If this is a main sleep metric, try to extract stages if they are embedded
            if (cleanName === 'sleep' || cleanName === 'sleep_total' || cleanName === 'sleep_analysis') {
              const multiplier = (unit.toLowerCase().includes('hr') || unit.toLowerCase().includes('hour') || (numericVal/3600) < 24) ? 3600 : 1;
              const sleepUnit = multiplier === 3600 ? 's' : unit;
              
              const coreVal = dp.core ?? dp.coreSleep ?? dp.sleep_core ?? dp.sleep_analysis_core;
              const deepVal = dp.deep ?? dp.deepSleep ?? dp.sleep_deep ?? dp.sleep_analysis_deep;
              const remVal = dp.rem ?? dp.remSleep ?? dp.sleep_rem ?? dp.sleep_analysis_rem;
              const awakeVal = dp.awake ?? dp.awakeSleep ?? dp.sleep_awake ?? dp.sleep_analysis_awake;
              const inBedVal = dp.in_bed ?? dp.inBed ?? dp.sleep_in_bed ?? dp.sleep_analysis_in_bed;

              if (coreVal !== undefined && coreVal !== null) await insertStmt.run(userId, 'sleep_core', Number(coreVal) * multiplier, sleepUnit, ts);
              if (deepVal !== undefined && deepVal !== null) await insertStmt.run(userId, 'sleep_deep', Number(deepVal) * multiplier, sleepUnit, ts);
              if (remVal !== undefined && remVal !== null) await insertStmt.run(userId, 'sleep_rem', Number(remVal) * multiplier, sleepUnit, ts);
              if (awakeVal !== undefined && awakeVal !== null) await insertStmt.run(userId, 'sleep_awake', Number(awakeVal) * multiplier, sleepUnit, ts);
              if (inBedVal !== undefined && inBedVal !== null) await insertStmt.run(userId, 'sleep_in_bed', Number(inBedVal) * multiplier, sleepUnit, ts);

              // Item 90: when the night started and ended. Stored as seconds from this
              // row's own timestamp (see src/lib/sleepTiming.ts for why not an epoch).
              // Asleep start/end is preferred; in-bed start/end is the fallback pair.
              const startRaw = dp.sleepStart ?? dp.sleep_start;
              const endRaw = dp.sleepEnd ?? dp.sleep_end;
              const pair = startRaw && endRaw ? [startRaw, endRaw]
                : (dp.inBedStart ?? dp.in_bed_start) && (dp.inBedEnd ?? dp.in_bed_end) ? [dp.inBedStart ?? dp.in_bed_start, dp.inBedEnd ?? dp.in_bed_end]
                : null;
              if (pair) {
                const bedOff = offsetSeconds(ts, normalizeTimestamp(pair[0]));
                const wakeOff = offsetSeconds(ts, normalizeTimestamp(pair[1]));
                if (bedOff !== null && wakeOff !== null && wakeOff > bedOff) {
                  await insertStmt.run(userId, 'bedtime', bedOff, 's_from_ts', ts);
                  await insertStmt.run(userId, 'wake_time', wakeOff, 's_from_ts', ts);
                }
              }
              if (sleepKeys === null && dp && typeof dp === 'object') {
                sleepKeys = `${Object.keys(dp).sort().join(', ')}${pair ? '' : ' (no start/end pair found)'}`;
              }
            }

            if (cleanName === 'height') {
              await db.prepare("UPDATE users SET height = ? WHERE id = ?").run(numericVal, userId);
            }
          }
        }
      }
    })();

    if (skippedNames.size > 0) {
      logEvent('warn', `Unmapped metric names dropped (not in METRIC_MAP): ${[...skippedNames].sort().join(', ')}`, 'apple_health');
    }
    if (sleepKeys !== null) {
      logEvent('info', `Sleep data point keys: ${sleepKeys}`, 'apple_health');
    }
    if (noValueNames.size > 0) {
      logEvent('warn', `Mapped metrics with no recognised value key: ${[...noValueNames].sort().join(', ')}`, 'apple_health');
    }

    // Item 47: record what this payload contained so the Logs tab can show it.
    try {
      const names = [...nameStats.values()].sort((a, b) => a.raw.localeCompare(b.raw));
      const summary: AppleSyncSummary = {
        lastSync: new Date().toISOString(),
        count,
        rawNames: names.map(n => n.raw),
        names,
      };
      const file = appleSyncSummaryPath(userId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(summary, null, 2));
    } catch (e: any) {
      logEvent('warn', `Could not record the Apple Health sync summary: ${e?.message || e}`, 'apple_health');
    }

    return { success: true, message: `Synced ${count} metrics from Apple Health`, count };
  },
  purge: async (userId, db, userSettings) => {
    try {
      await db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'apple_health'").run(userId);
      return { success: true, message: "Apple Health metrics purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
