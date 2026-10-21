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
      INSERT INTO workouts (user_id, name, duration, volume, timestamp, source, external_id,
                            distance, distance_unit, energy_burned, energy_burned_unit,
                            heart_rate_avg, heart_rate_max, elevation, elevation_unit)
      VALUES (?, ?, ?, 0, ?, 'apple_health', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        name = excluded.name,
        duration = excluded.duration,
        timestamp = excluded.timestamp,
        distance = COALESCE(excluded.distance, workouts.distance),
        distance_unit = COALESCE(excluded.distance_unit, workouts.distance_unit),
        energy_burned = COALESCE(excluded.energy_burned, workouts.energy_burned),
        energy_burned_unit = COALESCE(excluded.energy_burned_unit, workouts.energy_burned_unit),
        heart_rate_avg = COALESCE(excluded.heart_rate_avg, workouts.heart_rate_avg),
        heart_rate_max = COALESCE(excluded.heart_rate_max, workouts.heart_rate_max),
        elevation = COALESCE(excluded.elevation, workouts.elevation),
        elevation_unit = COALESCE(excluded.elevation_unit, workouts.elevation_unit)
    `);

    // 2026-10-18: Health Auto Export reports these either as a bare number or as
    // a {qty, units} object, and the old nano_health store kept the unit
    // alongside the value. Return both so nothing has to assume metres/kcal.
    // COALESCE on conflict above means a later payload that omits a field does
    // not wipe a value an earlier one supplied.
    const measure = (v: any, fallbackUnit: string | null): [number | null, string | null] => {
      if (v == null) return [null, null];
      if (typeof v === 'object') {
        const qty = Number(v.qty ?? v.value);
        return isNaN(qty) ? [null, null] : [qty, v.units ?? v.unit ?? fallbackUnit];
      }
      const n = Number(v);
      return isNaN(n) ? [null, null] : [n, fallbackUnit];
    };
    const scalar = (v: any): number | null => {
      const [n] = measure(v, null);
      return n;
    };
    
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
    await db.transaction(async () => {
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
        
        const duplicate = await db.prepare(`
          SELECT id FROM workouts
          WHERE user_id = ? AND source != 'apple_health'
          AND timestamp BETWEEN ? AND ?
        `).get(userId, startTimeMin, startTimeMax) as any;

        if (duplicate) continue;

        const [distance, distanceUnit] = measure(w.distance ?? w.totalDistance, 'm');
        const [energy, energyUnit] = measure(w.activeEnergyBurned ?? w.activeEnergy ?? w.totalEnergyBurned, 'kcal');
        const [elevation, elevationUnit] = measure(w.elevationUp ?? w.elevationAscended, 'm');
        const hrAvg = scalar(w.avgHeartRate ?? w.averageHeartRate);
        const hrMax = scalar(w.maxHeartRate);

        const externalId = `apple_health_${ts}_${name.replace(/\s+/g, '_')}`;
        await workoutInsertStmt.run(userId, name, duration, ts, externalId,
          distance, distanceUnit, energy, energyUnit, hrAvg, hrMax, elevation, elevationUnit);
        count++;
      }
    })();

    return { success: true, message: `Synced ${count} workouts from Apple Workouts`, count };
  },
  purge: async (userId, db, userSettings) => {
    try {
      await db.transaction(async () => {
        await db.prepare(`
          DELETE FROM workout_sets
          WHERE exercise_id IN (
            SELECT id FROM workout_exercises
            WHERE workout_id IN (
              SELECT id FROM workouts WHERE user_id = ? AND source = 'apple_health'
            )
          )
        `).run(userId);

        await db.prepare(`
          DELETE FROM workout_exercises
          WHERE workout_id IN (
            SELECT id FROM workouts WHERE user_id = ? AND source = 'apple_health'
          )
        `).run(userId);

        await db.prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'apple_health'").run(userId);
      })();
      return { success: true, message: "Apple Workouts purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
