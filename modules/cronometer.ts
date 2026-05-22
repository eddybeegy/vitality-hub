import { exec, execSync } from "child_process";
import path from "path";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { DataSourceModule } from "./types";

export const CronometerModule: DataSourceModule = {
  id: "cronometer",
  name: "Cronometer",
  description: "Sync nutrition and metrics from Cronometer",
  metricsProvided: ["calories_in", "protein", "carbs", "fat", "fiber", "sugar", "sodium", "iron", "calcium", "vitamin_c", "vitamin_a", "vitamin_d", "vitamin_e", "vitamin_k", "vitamin_b12", "vitamin_b6", "magnesium", "potassium", "zinc", "water"],
  settings: [
    {
      key: "cronometer_username",
      label: "Cronometer Username",
      type: "text",
      description: "Your Cronometer email address"
    },
    {
      key: "cronometer_password",
      label: "Cronometer Password",
      type: "password",
      description: "Your Cronometer password"
    }
  ],
  sync: async (userId, db, logEvent, userSettings) => {
    const username = userSettings?.cronometer_username || process.env.CRONOMETER_USERNAME;
    const password = userSettings?.cronometer_password || process.env.CRONOMETER_PASSWORD;

    if (!username || !password) {
      logEvent('warn', "Cronometer sync skipped: credentials not configured", 'cronometer');
      return { success: false, message: "Cronometer credentials not configured" };
    }

    const user = db.prepare("SELECT sync_history_days, timezone FROM users WHERE id = ?").get(userId) as any;
    const binaryPath = path.join(process.cwd(), 'go-wrapper', 'gocronometer-wrapper');

    if (!fs.existsSync(binaryPath)) {
      logEvent('info', `Cronometer binary not found, attempting to build...`, 'cronometer');
      try {
        const buildCmd = `cd go-wrapper && go mod tidy && go build -o gocronometer-wrapper main.go`;
        const buildResult = execSync(buildCmd, { encoding: 'utf8' });
        logEvent('info', `Cronometer build successful: ${buildResult}`, 'cronometer');
      } catch (e: any) {
        logEvent('error', `Cronometer build failed: ${e.message}. Stderr: ${e.stderr}`, 'cronometer');
        return { success: false, message: "Cronometer binary missing and build failed" };
      }
    }
    const historyDays = user?.sync_history_days || 90;
    const userTimezone = user?.timezone || 'UTC';
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - historyDays);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 1);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const cmd = `"${binaryPath}" -u "${username}" -p "${password}" -s "${formatDate(startDate)}" -e "${formatDate(endDate)}"`;
    logEvent('info', `Executing Cronometer command: ${cmd}`, 'cronometer');

    return new Promise((resolve) => {
      exec(cmd, async (error, stdout, stderr) => {
        if (error) {
          logEvent('error', `Cronometer sync failed: ${error.message}, Stderr: ${stderr}`, 'cronometer');
          return resolve({ success: false, message: error.message });
        }

        try {
          const num = (v: any) => {
            const n = Number(v);
            return isNaN(n) ? 0 : n;
          };
          
          const records = parse(stdout, { columns: true, skip_empty_lines: true });
          logEvent('info', `Cronometer sync returned ${records.length} records`, 'cronometer');
          if (!records || records.length === 0) {
            return resolve({ success: true, message: "No new data from Cronometer", count: 0 });
          }

          const insertStmt = db.prepare("INSERT OR REPLACE INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (?, ?, ?, ?, ?, 'cronometer')");
          const mealInsertStmt = db.prepare(`
            INSERT INTO meal_items (
              user_id, name, calories, protein, carbs, fat, fiber, sodium, iron, 
              calcium, vitamin_c, vitamin_a, vitamin_d, vitamin_e, vitamin_k, 
              vitamin_b12, vitamin_b6, magnesium, potassium, zinc, water,
              timestamp, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cronometer')
          `);
          const deleteMetricsStmt = db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'cronometer' AND CAST(timestamp AS TEXT) LIKE ?");
          const deleteMealsStmt = db.prepare("DELETE FROM meal_items WHERE user_id = ? AND source = 'cronometer' AND CAST(timestamp AS TEXT) LIKE ?");

          const uniqueDays = Array.from(new Set(records.map((r: any) => {
            try {
              const day = r.Day || '';
              // Normalize day to YYYY-MM-DD for the DELETE statement
              const d = new Date(day + ' UTC');
              if (!isNaN(d.getTime())) {
                return d.toISOString().split('T')[0];
              }
              return day || null;
            } catch (e) {
              return null;
            }
          }))).filter(Boolean) as string[];

          let count = 0;
          await db.transaction(async () => {
            // Clear existing data for the days we are about to import
            // This ensures Cronometer remains the source of truth
            for (const day of uniqueDays) {
              await deleteMetricsStmt.run(userId, `${day}%`);
              await deleteMealsStmt.run(userId, `${day}%`);
            }

            if (records.length > 0) {
              logEvent('info', `Cronometer record keys: ${Object.keys(records[0]).join(', ')}`, 'cronometer');
            }

            let recordIndex = 0;
            for (const r of records as any[]) {
              // Map Cronometer fields to metrics
              const getVal = (key: string) => num(r[key]);
              
              const day = r.Day || '';
              const time = r.Time || '12:00:00';

              if (recordIndex < 5) {
                logEvent('debug', `Parsing Cronometer record ${recordIndex}: Day="${day}", Time="${time}", Food="${r['Food Name']}"`, 'cronometer');
              }

              // Use a stable unique timestamp for each record to avoid duplicates on re-sync
              const recordId = `${day}-${time}-${r['Food Name']}`;
              let hash = 0;
              for (let i = 0; i < recordId.length; i++) {
                const char = recordId.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
              }
              const offset = Math.abs(hash % 1000) + recordIndex;
              
              // Robust date parsing
              let uniqueTs: string;
              try {
                // Construct a date string that represents the local time in the user's timezone
                // We try a few formats to be robust
                let tempDate: Date;
                
                // Try parsing as "YYYY-MM-DD HH:mm:ss UTC" or "MM/DD/YYYY HH:mm:ss UTC"
                // Adding " UTC" tells the constructor to treat it as UTC so we can calculate the offset later
                const combined = `${day} ${time}`.trim().replace(/\s+/g, ' ');
                tempDate = new Date(combined + ' UTC');
                
                if (isNaN(tempDate.getTime())) {
                  // Try ISO-like format
                  const isoLike = `${day.includes('/') ? day : day.replace(/\s+/g, 'T')}T${time}Z`;
                  tempDate = new Date(isoLike);
                }

                if (isNaN(tempDate.getTime())) {
                  // Fallback to just the day if time is the problem
                  tempDate = new Date(day + ' UTC');
                }
                
                if (isNaN(tempDate.getTime())) {
                  throw new Error(`Invalid date format: Day="${day}", Time="${time}"`);
                }
                
                // To convert local time in a specific timezone to UTC:
                // We format the UTC date in the target timezone and find the offset.
                const tzStr = new Intl.DateTimeFormat('en-US', {
                  timeZone: userTimezone,
                  timeZoneName: 'longOffset',
                  year: 'numeric', month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                  hour12: false
                }).format(tempDate);
                
                // Improved regex to handle single-digit hours (e.g., GMT+1, GMT-5)
                const match = tzStr.match(/GMT([+-]\d{1,2}):?(\d{2})?/);
                let offsetMs = 0;
                if (match) {
                  const sign = match[1][0] === '+' ? 1 : -1;
                  const hours = parseInt(match[1].substring(1), 10);
                  const mins = match[2] ? parseInt(match[2], 10) : 0;
                  offsetMs = sign * ((hours * 60) + mins) * 60 * 1000;
                  if (recordIndex === 0) {
                    logEvent('debug', `Timezone offset calculated: ${userTimezone} -> ${sign > 0 ? '+' : '-'}${hours}:${mins.toString().padStart(2, '0')} (${offsetMs}ms)`, 'cronometer');
                  }
                } else {
                  logEvent('warn', `Could not parse timezone offset from string: "${tzStr}" for timezone: "${userTimezone}"`, 'cronometer');
                }
                
                let dateObj = new Date(tempDate.getTime() - offsetMs);
                uniqueTs = new Date(dateObj.getTime() + offset).toISOString();
              } catch (e: any) {
                logEvent('error', `Date processing failed for record: ${e.message}`, 'cronometer');
                recordIndex++;
                continue;
              }

              const insertMetric = async (type: string, value: number, unit: string) => {
                if (value === 0) return;
                await insertStmt.run(userId, type, value, unit, uniqueTs);
              };

              // Comprehensive mapping
              const mappings: [string, string, string][] = [
                ['Energy (kcal)', 'calories_in', 'kcal'],
                ['Protein (g)', 'protein', 'g'],
                ['Carbs (g)', 'carbs', 'g'],
                ['Fat (g)', 'fat', 'g'],
                ['Monounsaturated (g)', 'fat_monounsaturated', 'g'],
                ['Polyunsaturated (g)', 'fat_polyunsaturated', 'g'],
                ['Saturated (g)', 'fat_saturated', 'g'],
                ['Fiber (g)', 'fiber', 'g'],
                ['Sugars (g)', 'sugar', 'g'],
                ['Sugar (g)', 'sugar', 'g'],
                ['Sodium (mg)', 'sodium', 'mg'],
                ['Iron (mg)', 'iron', 'mg'],
                ['Calcium (mg)', 'calcium', 'mg'],
                ['Vitamin C (mg)', 'vitamin_c', 'mg'],
                ['Vitamin A (µg)', 'vitamin_a', 'µg'],
                ['Vitamin D (µg)', 'vitamin_d', 'µg'],
                ['Vitamin E (mg)', 'vitamin_e', 'mg'],
                ['Vitamin K (µg)', 'vitamin_k', 'µg'],
                ['Vitamin B12 (µg)', 'vitamin_b12', 'µg'],
                ['Vitamin B6 (mg)', 'vitamin_b6', 'mg'],
                ['Magnesium (mg)', 'magnesium', 'mg'],
                ['Potassium (mg)', 'potassium', 'mg'],
                ['Zinc (mg)', 'zinc', 'mg'],
                ['Water (g)', 'water', 'ml'],
                ['Water (ml)', 'water', 'ml'],
                ['Caffeine (mg)', 'caffeine', 'mg'],
                ['Cholesterol (mg)', 'cholesterol', 'mg'],
              ];

              for (const [cronKey, localType, unit] of mappings) {
                if (r[cronKey]) await insertMetric(localType, getVal(cronKey), unit);
              }

              // Insert meal item
              try {
                await mealInsertStmt.run(
                  userId,
                  r['Food Name'],
                  getVal('Energy (kcal)'),
                  getVal('Protein (g)'),
                  getVal('Carbs (g)'),
                  getVal('Fat (g)'),
                  getVal('Fiber (g)'),
                  getVal('Sodium (mg)'),
                  getVal('Iron (mg)'),
                  getVal('Calcium (mg)'),
                  getVal('Vitamin C (mg)'),
                  getVal('Vitamin A (µg)'),
                  getVal('Vitamin D (µg)'),
                  getVal('Vitamin E (mg)'),
                  getVal('Vitamin K (µg)'),
                  getVal('Vitamin B12 (µg)'),
                  getVal('Vitamin B6 (mg)'),
                  getVal('Magnesium (mg)'),
                  getVal('Potassium (mg)'),
                  getVal('Zinc (mg)'),
                  getVal('Water (g)') || getVal('Water (ml)'),
                  uniqueTs
                );
              } catch (e: any) {
                logEvent('error', `Failed to insert meal item: ${e.message} (Record: ${recordId}, TS: ${uniqueTs})`, 'cronometer');
              }
              
              count++;
              recordIndex++;
            }
          })();

          await db.prepare("UPDATE users SET last_cronometer_sync = CURRENT_TIMESTAMP WHERE id = ?").run(userId);
          resolve({ success: true, message: `Synced ${count} records from Cronometer`, count });
        } catch (e: any) {
          logEvent('error', `Cronometer parse failed: ${e.message}`, 'cronometer');
          resolve({ success: false, message: e.message });
        }
      });
    });
  },
  purge: async (userId, db, userSettings) => {
    try {
      await db.prepare("DELETE FROM metrics WHERE user_id = ? AND source LIKE 'cronometer%'").run(userId);
      await db.prepare("DELETE FROM meal_items WHERE user_id = ? AND source LIKE 'cronometer%'").run(userId);
      return { success: true, message: "Cronometer data purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
