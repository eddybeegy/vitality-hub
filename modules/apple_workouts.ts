import { DataSourceModule } from "./types";

export const AppleWorkoutsModule: DataSourceModule = {
  id: "apple_workouts",
  name: "Apple Workouts",
  description: "Sync workouts from Apple Health via Health Auto Export",
  metricsProvided: ["workouts"],
  settings: [],
  sync: async (userId, db, logEvent, userSettings, data?: any) => {
    if (!data) return { success: false, message: "No data provided" };
    
    let workouts = [];
    if (Array.isArray(data)) workouts = data;
    else workouts = data?.data?.workouts || data?.workouts || [];

    if (workouts.length === 0) return { success: true, message: "No workouts to sync", count: 0 };

    const workoutInsertStmt = db.prepare(`
      INSERT INTO workouts (user_id, name, duration, volume, timestamp, source, external_id) 
      VALUES (?, ?, ?, 0, ?, 'apple_health', ?)
      ON CONFLICT(external_id) DO UPDATE SET
        name = excluded.name,
        duration = excluded.duration,
        timestamp = excluded.timestamp
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

    const extractDate = (ts: any): string | null => {
      const normalized = normalizeTimestamp(ts);
      const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : null;
    };

    const uniqueDays = new Set<string>();
    for (const w of workouts) {
      const start = w.start || w.startDate;
      const day = extractDate(start);
      if (day) uniqueDays.add(day);
    }

    let count = 0;
    db.transaction(() => {
      for (const w of workouts) {
        const name = w.name || w.workoutType || w.type || "Workout";
        const start = w.start || w.startDate;
        const end = w.end || w.endDate;
        if (!start) continue;

        const ts = normalizeTimestamp(start);
        let duration = Number(w.duration);
        if (isNaN(duration) || duration === 0) {
          if (end) duration = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
        } else if (duration > 1000) {
          duration = Math.round(duration / 60); // Convert seconds to minutes
        }

        // Check for duplicate from other sources (like Hevy)
        const startTime = new Date(start).getTime();
        const windowMs = 30 * 60 * 1000; // 30 minutes
        const startTimeMin = new Date(startTime - windowMs).toISOString();
        const startTimeMax = new Date(startTime + windowMs).toISOString();
        
        const duplicate = db.prepare(`
          SELECT id FROM workouts 
          WHERE user_id = ? AND source != 'apple_health' 
          AND timestamp BETWEEN ? AND ?
        `).get(userId, startTimeMin, startTimeMax) as any;
        
        if (duplicate) continue;

        const externalId = `apple_health_${ts}_${name.replace(/\s+/g, '_')}`;
        workoutInsertStmt.run(userId, name, duration, ts, externalId);
        count++;
      }
    })();

    return { success: true, message: `Synced ${count} workouts from Apple Workouts`, count };
  },
  purge: async (userId, db, userSettings) => {
    try {
      db.transaction(() => {
        db.prepare(`
          DELETE FROM workout_sets 
          WHERE exercise_id IN (
            SELECT id FROM workout_exercises 
            WHERE workout_id IN (
              SELECT id FROM workouts WHERE user_id = ? AND source = 'apple_health'
            )
          )
        `).run(userId);

        db.prepare(`
          DELETE FROM workout_exercises 
          WHERE workout_id IN (
            SELECT id FROM workouts WHERE user_id = ? AND source = 'apple_health'
          )
        `).run(userId);

        db.prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'apple_health'").run(userId);
      })();
      return { success: true, message: "Apple Workouts purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
