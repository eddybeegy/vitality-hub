import axios from "axios";
import { DataSourceModule } from "./types";

export const HevyModule: DataSourceModule = {
  id: "hevy",
  name: "Hevy",
  description: "Sync workouts and routines from Hevy",
  metricsProvided: ["workouts", "routines"],
  settings: [
    {
      key: "hevy_api_key",
      label: "Hevy API Key",
      type: "password",
      description: "Your Hevy API key from the app settings"
    }
  ],
  sync: async (userId, db, logEvent, userSettings) => {
    const apiKey = (userSettings?.hevy_api_key || "").trim();
    if (!apiKey) {
      return { success: false, message: "Hevy API key not configured" };
    }

    try {
      const num = (v: any) => {
        const n = Number(v);
        return isNaN(n) ? 0 : n;
      };
      
      const userTimezone = userSettings?.timezone || 'UTC';
      
      // Helper to convert ISO timestamp to local wall-clock time for storage
      const toLocalTimestamp = (isoStr: string): string => {
        try {
          const date = new Date(isoStr);
          const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: userTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const parts = formatter.format(date);
          const [datePart, timePart] = parts.split(', ');
          return `${datePart}T${timePart}`;
        } catch (e) {
          return new Date(isoStr).toISOString();
        }
      };

      const user = db.prepare("SELECT sync_history_days FROM users WHERE id = ?").get(userId) as any;
      const historyDays = user?.sync_history_days || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - historyDays);

      // Sync Folders mapping
      const folderMap = new Map<string, string>();
      try {
        const foldersRes = await axios.get("https://api.hevyapp.com/v1/routine_folders", {
          headers: { 
            "api-key": apiKey,
            "accept": "application/json"
          },
          params: { page: 1 }
        });
        if (foldersRes.data && foldersRes.data.routine_folders) {
          logEvent('debug', `Hevy API returned ${foldersRes.data.routine_folders.length} routine folders`, 'hevy');
          for (const f of foldersRes.data.routine_folders) {
            logEvent('debug', `Folder: ${f.title}, id: ${f.id}`, 'hevy');
            folderMap.set(String(f.id), f.title);
          }
        }
      } catch (folderErr: any) {
        logEvent('warn', `Hevy routine folders endpoint failed: ${folderErr.message}. Using fallbacks.`, 'hevy');
        folderMap.set("2331239", "Current");
        folderMap.set("2315551", "Archive");
      }
      
      // Sync Workouts
      let allWorkouts: any[] = [];
      let page = 1;
      let keepFetching = true;

      while (keepFetching && page <= 50) { 
        try {
          const workoutsRes = await axios.get("https://api.hevyapp.com/v1/workouts", {
            headers: { 
              "api-key": apiKey,
              "accept": "application/json"
            },
            params: { page }
          });
          
          const fetchedWorkouts = workoutsRes.data.workouts;
          if (!fetchedWorkouts || fetchedWorkouts.length === 0) {
            keepFetching = false;
            break;
          }

          for (const w of fetchedWorkouts) {
            const workoutDate = new Date(w.start_time);
            if (workoutDate >= cutoffDate) {
              allWorkouts.push(w);
            } else {
              keepFetching = false; 
            }
          }
          
          if (fetchedWorkouts.length < 10) {
            keepFetching = false; 
          }
          page++;
        } catch (err: any) {
          if (err.response && err.response.status === 404) {
            logEvent('info', `Hevy workouts API returned 404 on page ${page}, assuming no more workouts.`, 'hevy');
            keepFetching = false;
            break;
          }
          throw err;
        }
      }
      
      const workoutInsertStmt = db.prepare("INSERT INTO workouts (user_id, name, duration, volume, timestamp, source, external_id, routine_external_id) VALUES (?, ?, ?, ?, ?, 'hevy', ?, ?)");
      const workoutUpdateStmt = db.prepare("UPDATE workouts SET name = ?, duration = ?, volume = ?, timestamp = ?, routine_external_id = ? WHERE id = ?");
      const exerciseStmt = db.prepare("INSERT INTO workout_exercises (workout_id, exercise_title, sets_count, best_weight, best_reps, best_distance, best_time, best_steps, best_calories, best_avg_hr, best_max_hr, exercise_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const setStmt = db.prepare("INSERT INTO workout_sets (exercise_id, set_index, weight, reps, distance, time, steps, calories, avg_hr, max_hr, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const deleteExercisesStmt = db.prepare("DELETE FROM workout_exercises WHERE workout_id = ?");
      const deleteSetsStmt = db.prepare("DELETE FROM workout_sets WHERE exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)");
      
      let workoutsCount = 0;
      await db.transaction(async () => {
        const uniqueDays = new Set<string>();
        for (const w of allWorkouts) {
          const day = new Date(w.start_time).toISOString().split('T')[0];
          uniqueDays.add(day);
        }

        // Delete existing Hevy data for the days being imported to ensure Hevy is the source of truth
        const deleteWorkoutsByDayStmt = db.prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'hevy' AND CAST(timestamp AS TEXT) LIKE ?");
        const deleteExercisesByDayStmt = db.prepare(`
          DELETE FROM workout_exercises 
          WHERE workout_id IN (
            SELECT id FROM workouts 
            WHERE user_id = ? AND source = 'hevy' AND CAST(timestamp AS TEXT) LIKE ?
          )
        `);
        const deleteSetsByDayStmt = db.prepare(`
          DELETE FROM workout_sets 
          WHERE exercise_id IN (
            SELECT id FROM workout_exercises 
            WHERE workout_id IN (
              SELECT id FROM workouts 
              WHERE user_id = ? AND source = 'hevy' AND CAST(timestamp AS TEXT) LIKE ?
            )
          )
        `);

        for (const day of uniqueDays) {
          const pattern = `${day}%`;
          await deleteSetsByDayStmt.run(userId, pattern);
          await deleteExercisesByDayStmt.run(userId, pattern);
          await deleteWorkoutsByDayStmt.run(userId, pattern);
        }

        for (const w of allWorkouts) {
          let volume = num(w.total_volume_kg);
          if (volume === 0) {
            for (const ex of w.exercises) {
              for (const set of ex.sets) {
                const weight = num(set.weight_kg || set.weight);
                const reps = num(set.reps);
                volume += weight * reps;
              }
            }
          }

          // Deduplication: Delete any Apple Health workouts that match this Hevy workout
          const startTime = new Date(w.start_time).getTime();
          const windowMs = 30 * 60 * 1000; // 30 minutes
          const startTimeMin = new Date(startTime - windowMs).toISOString();
          const startTimeMax = new Date(startTime + windowMs).toISOString();
          
          await db.prepare(`
            DELETE FROM workout_sets 
            WHERE exercise_id IN (
              SELECT id FROM workout_exercises 
              WHERE workout_id IN (
                SELECT id FROM workouts 
                WHERE user_id = ? AND source = 'apple_health' 
                AND timestamp BETWEEN ? AND ?
              )
            )
          `).run(userId, startTimeMin, startTimeMax);

          await db.prepare(`
            DELETE FROM workout_exercises 
            WHERE workout_id IN (
              SELECT id FROM workouts 
              WHERE user_id = ? AND source = 'apple_health' 
              AND timestamp BETWEEN ? AND ?
            )
          `).run(userId, startTimeMin, startTimeMax);

          await db.prepare(`
            DELETE FROM workouts 
            WHERE user_id = ? AND source = 'apple_health' 
            AND timestamp BETWEEN ? AND ?
          `).run(userId, startTimeMin, startTimeMax);

          const sqlInsert = "INSERT INTO workouts (user_id, name, duration, volume, timestamp, source, external_id, routine_external_id) VALUES (?, ?, ?, ?, ?, 'hevy', ?, ?)" + (db.type === 'postgres' ? " RETURNING id" : "");
          const res = await db.prepare(sqlInsert).run(userId, w.title, Math.round(num(w.duration_seconds) / 60), num(volume), toLocalTimestamp(w.start_time), w.id, w.routine_id ? String(w.routine_id) : null);
          const workoutId = res.lastInsertRowid as number;
          workoutsCount++;

          for (const ex of w.exercises) {
            let bestWeight = 0, bestReps = 0, bestDist = 0, bestTime = 0, bestSteps = 0, bestCals = 0, bestAvgHr = 0, bestMaxHr = 0;
            for (const s of ex.sets) {
              const weight = num(s.weight_kg || s.weight);
              const reps = num(s.reps);
              const dist = num(s.distance_meters);
              const time = num(s.duration_seconds);
              
              if (weight > bestWeight) { 
                bestWeight = weight; 
                bestReps = reps; 
              }
              if (dist > bestDist) bestDist = dist;
              if (time > bestTime) bestTime = time;
            }

            // Map Hevy exercise types to our internal types
            let exerciseType = 'strength';
            if (ex.type === 'distance_duration' || ex.type === 'duration') {
              exerciseType = 'cardio';
            } else if (ex.type === 'bodyweight') {
              exerciseType = 'bodyweight';
            } else if (ex.title.toLowerCase().includes('rowing') || ex.title.toLowerCase().includes('run') || ex.title.toLowerCase().includes('cycle')) {
              exerciseType = 'cardio';
            }

            const sqlExInsert = "INSERT INTO workout_exercises (workout_id, exercise_title, sets_count, best_weight, best_reps, best_distance, best_time, best_steps, best_calories, best_avg_hr, best_max_hr, exercise_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" + (db.type === 'postgres' ? " RETURNING id" : "");
            const exRes = await db.prepare(sqlExInsert).run(workoutId, ex.title, num(ex.sets.length), num(bestWeight), num(bestReps), num(bestDist), num(bestTime), num(bestSteps), num(bestCals), num(bestAvgHr), num(bestMaxHr), exerciseType);
            const exerciseId = exRes.lastInsertRowid as number;

            for (let idx = 0; idx < ex.sets.length; idx++) {
              const s = ex.sets[idx];
              await setStmt.run(exerciseId, num(idx), num(s.weight_kg || s.weight), num(s.reps), num(s.distance_meters), num(s.duration_seconds), 0, 0, 0, 0, s.type);
            }
          }
        }
      })();

      // Sync Routines
      let routinesCount = 0;
      try {
        let allRoutines: any[] = [];
        let routinePage = 1;
        let keepFetchingRoutines = true;

        while (keepFetchingRoutines && routinePage <= 10) {
          const routinesRes = await axios.get("https://api.hevyapp.com/v1/routines", {
            headers: { 
              "api-key": apiKey,
              "accept": "application/json"
            },
            params: { page: routinePage }
          });

          const fetchedRoutines = routinesRes.data.routines;
          if (!fetchedRoutines || fetchedRoutines.length === 0) {
            keepFetchingRoutines = false;
            break;
          }

          allRoutines.push(...fetchedRoutines);
          
          if (fetchedRoutines.length < 10) {
            keepFetchingRoutines = false;
          }
          routinePage++;
        }

        if (allRoutines.length > 0) {
          logEvent('debug', `Hevy API returned ${allRoutines.length} routines total`, 'hevy');
          const sqlRoutineInsert = "INSERT INTO routines (user_id, name, description, folder_name, folder_id, external_id) VALUES (?, ?, ?, ?, ?, ?)" + (db.type === 'postgres' ? " RETURNING id" : "");
          const routineInsertStmt = db.prepare(sqlRoutineInsert);
          const routineUpdateStmt = db.prepare("UPDATE routines SET name = ?, description = ?, folder_name = ?, folder_id = ? WHERE id = ?");
          const routineExInsertStmt = db.prepare("INSERT INTO routine_exercises (routine_id, exercise_title, sets_count, rest_seconds) VALUES (?, ?, ?, ?)");
          const deleteRoutineExStmt = db.prepare("DELETE FROM routine_exercises WHERE routine_id = ?");

          await db.transaction(async () => {
            for (const r of allRoutines) {
              const folderName = folderMap.get(String(r.folder_id)) || "Default";
              logEvent('debug', `Processing routine: ${r.title}, folder_id: ${r.folder_id}, mapped folder: ${folderName}`, 'hevy');
              const existingRoutine = await db.prepare("SELECT id FROM routines WHERE user_id = ? AND external_id = ?").get(userId, r.id) as any;

              let routineId: number;
              if (existingRoutine) {
                routineId = existingRoutine.id;
                await routineUpdateStmt.run(r.title, r.notes || r.description || "", folderName, r.folder_id ? String(r.folder_id) : null, routineId);
                await deleteRoutineExStmt.run(routineId);
              } else {
                const res = await routineInsertStmt.run(userId, r.title, r.notes || r.description || "", folderName, r.folder_id ? String(r.folder_id) : null, r.id);
                routineId = res.lastInsertRowid as number;
                routinesCount++;
              }

              for (const ex of r.exercises) {
                await routineExInsertStmt.run(routineId, ex.title, num(ex.sets.length), num(ex.rest_seconds));
              }
            }
          })();
        }
      } catch (err: any) {
        if (err.response && err.response.status === 404) {
          logEvent('info', `Hevy routines API returned 404, assuming no routines.`, 'hevy');
        } else {
          throw err;
        }
      }

      return { success: true, message: `Synced ${workoutsCount} workouts and ${routinesCount} routines`, workoutsCount, routinesCount };
    } catch (error: any) {
      logEvent('error', `Hevy sync failed: ${error.message}`, 'hevy');
      return { success: false, message: error.message };
    }
  },
  purge: async (userId, db, userSettings) => {
    try {
      await db.prepare("DELETE FROM workout_sets WHERE exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE user_id = ? AND source = 'hevy'))").run(userId);
      await db.prepare("DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE user_id = ? AND source = 'hevy')").run(userId);
      await db.prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'hevy'").run(userId);
      await db.prepare("DELETE FROM routine_exercises WHERE routine_id IN (SELECT id FROM routines WHERE user_id = ?)").run(userId);
      await db.prepare("DELETE FROM routines WHERE user_id = ?").run(userId);
      return { success: true, message: "Hevy data purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
