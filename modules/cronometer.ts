import { execFile } from "child_process";
import path from "path";
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

    const user = await db.prepare("SELECT sync_history_days, timezone FROM users WHERE id = ?").get(userId) as any;
    const binaryPath = path.join(process.cwd(), 'go-wrapper', 'gocronometer-wrapper');

    logEvent('debug', `DB query result for userId ${userId}: ${JSON.stringify(user)}`, 'cronometer');

    const historyDays = user?.sync_history_days || 90;
    const userTimezone = user?.timezone || 'UTC';

    logEvent('debug', `sync_history_days from DB: ${user?.sync_history_days} (type: ${typeof user?.sync_history_days}), using: ${historyDays}`, 'cronometer');
    logEvent('debug', `timezone from DB: ${user?.timezone}, using: ${userTimezone}`, 'cronometer');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - historyDays);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 1);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const args = ['-u', username, '-p', password, '-s', formatDate(startDate), '-e', formatDate(endDate)];
    logEvent('debug', `Date range calculation: historyDays=${historyDays}, start=${formatDate(startDate)}, end=${formatDate(endDate)}`, 'cronometer');
    logEvent('info', `Executing Cronometer wrapper for user ${username.replace(/.(?=.{2})/g, '*')} (${formatDate(startDate)} to ${formatDate(endDate)})`, 'cronometer');

    return new Promise(async (resolve) => {
      const runOnce = (timeoutMs: number) => new Promise<{ error: any; stdout: string; stderr: string; timedOut: boolean }>(r => {
        const child = execFile(binaryPath, args, (error, stdout, stderr) => {
          r({ error, stdout: stdout?.toString() || '', stderr: stderr?.toString() || '', timedOut: false });
        });

        const timeout = setTimeout(() => {
          child.kill();
          r({ error: new Error('Timeout'), stdout: '', stderr: '', timedOut: true });
        }, timeoutMs);

        child.on('exit', () => clearTimeout(timeout));
      });

      const maxAttempts = 3;
      const backoffMs = [0, 30_000, 600_000];
      const timeouts = [90_000, 120_000, 180_000];

      let attemptResult: { error: any; stdout: string; stderr: string; timedOut: boolean } | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (backoffMs[attempt] > 0) await new Promise(r => setTimeout(r, backoffMs[attempt]));

        logEvent('info', `Cronometer sync attempt ${attempt + 1}/${maxAttempts} with ${timeouts[attempt]}ms timeout`, 'cronometer');
        attemptResult = await runOnce(timeouts[attempt]);

        if (!attemptResult.error) break;

        const msg = (attemptResult.error && attemptResult.error.message) || attemptResult.stderr || '';
        if (!/Too Many Attempts|Too many attempts|Timeout/i.test(msg)) break;
      }

      if (!attemptResult) {
        return resolve({ success: false, message: 'Cronometer wrapper failed with unknown error' });
      }

      const { error, stdout, stderr } = attemptResult;

      // The go wrapper's stderr is verbose per-request DEBUG chatter (includes the
      // Cronometer login JWT) emitted on every run, success or failure — redact the
      // token and truncate before persisting so a routine sync doesn't write a
      // 100KB+ row containing a live session credential into the logs table every hour.
      const sanitizedStderr = stderr
        ? stderr.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
        : stderr;
      const stderrForLog = sanitizedStderr && sanitizedStderr.length > 2000
        ? `${sanitizedStderr.slice(0, 2000)}... [truncated, ${sanitizedStderr.length} chars total]`
        : sanitizedStderr;

      if (stderr) {
        logEvent(error ? 'warn' : 'debug', `Cronometer wrapper stderr: ${stderrForLog}`, 'cronometer');
      }

      if (error) {
        logEvent('error', `Cronometer sync failed: ${error.message}${stderr ? `, Stderr: ${stderrForLog}` : ''}`, 'cronometer');
        return resolve({ success: false, message: error.message });
      }

      try {
        const num = (v: any) => {
          const n = Number(v);
          return isNaN(n) ? 0 : n;
        };

        // Debug: Log first few lines of CSV
        const lines = stdout.split('\n');
        logEvent('debug', `CSV has ${lines.length} lines total`, 'cronometer');
        logEvent('debug', `CSV header: ${lines[0]?.substring(0, 200)}`, 'cronometer');
        if (lines.length > 1) {
          logEvent('debug', `CSV line 2: ${lines[1]?.substring(0, 300)}`, 'cronometer');
          logEvent('debug', `CSV line 2 comma count: ${(lines[1]?.match(/,/g) || []).length}`, 'cronometer');
        }

        const records = parse(stdout, { columns: true, skip_empty_lines: true });
        logEvent('info', `Cronometer sync returned ${records.length} records`, 'cronometer');
        if (!records || records.length === 0) {
          return resolve({ success: true, message: "No new data from Cronometer", count: 0 });
        }

        const insertStmt = db.prepare("INSERT OR REPLACE INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (?, ?, ?, ?, ?, 'cronometer')");
        const mealInsertStmt = db.prepare(`
          INSERT OR REPLACE INTO meal_items (
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
          for (const day of uniqueDays) {
            await deleteMetricsStmt.run(userId, `${day}%`);
            await deleteMealsStmt.run(userId, `${day}%`);
          }

          if (records.length > 0) {
            logEvent('info', `Cronometer record keys: ${Object.keys(records[0]).join(', ')}`, 'cronometer');
          }

          let recordIndex = 0;
          for (const r of records as any[]) {
            const getVal = (key: string) => num(r[key]);

            const day = r.Day || '';
            const time = r.Time || '12:00:00';

            if (recordIndex < 5) {
              logEvent('debug', `Parsing Cronometer record ${recordIndex}: Day="${day}", Time="${time}", Food="${r['Food Name']}"`, 'cronometer');
            }

            const recordId = `${day}-${time}-${r['Food Name']}`;
            let hash = 0;
            for (let i = 0; i < recordId.length; i++) {
              const char = recordId.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            const offset = Math.abs(hash % 1000) + recordIndex;

            let uniqueTs: string;
            try {
              const combined = `${day} ${time}`.trim().replace(/\s+/g, ' ');
              let tempDate = new Date(combined + ' UTC');

              if (isNaN(tempDate.getTime())) {
                const isoLike = `${day.includes('/') ? day : day.replace(/\s+/g, 'T')}T${time}Z`;
                tempDate = new Date(isoLike);
              }

              if (isNaN(tempDate.getTime())) {
                tempDate = new Date(day + ' UTC');
              }

              if (isNaN(tempDate.getTime())) {
                throw new Error(`Invalid date format: Day="${day}", Time="${time}"`);
              }

              const tzStr = new Intl.DateTimeFormat('en-US', {
                timeZone: userTimezone,
                timeZoneName: 'longOffset',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
              }).format(tempDate);

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

            const mappings: [string, string, string][] = [
              ['Energy (kcal)', 'calories_in', 'kcal'],
              ['Protein (g)', 'protein', 'g'],
              ['Carbs (g)', 'carbs', 'g'],
              ['Fat (g)', 'fat', 'g'],
              ['Fiber (g)', 'fiber', 'g'],
              ['Sugars (g)', 'sugar', 'g'],
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
            ];

            for (const [cronKey, localType, unit] of mappings) {
              if (r[cronKey]) await insertMetric(localType, getVal(cronKey), unit);
            }

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
              logEvent('error', `Failed to insert meal item: ${e.message}`, 'cronometer');
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
