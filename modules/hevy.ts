import axios from "axios";
import { DataSourceModule } from "./types";
import { utcDayRange } from "./timeRange";

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

      // 2026-10-18: `duration` was being written as 0 for every Hevy workout.
      // The cause was `num(w.duration_seconds)` below — the Hevy v1 workout object
      // has no `duration_seconds` field at all (its keys are created_at,
      // description, end_time, exercises, id, routine_id, start_time, title,
      // updated_at), so num(undefined) returned 0 and all 151 rows stored 0
      // minutes. Derive it from start/end instead, keeping duration_seconds as a
      // fallback in case Hevy ever adds it. Whole minutes, to match the column.
      const workoutDurationMin = (w: any) => {
        const start = Date.parse(w.start_time);
        const end = Date.parse(w.end_time);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          return Math.round((end - start) / 60000);
        }
        const secs = num(w.duration_seconds);
        return secs > 0 ? Math.round(secs / 60) : 0;
      };

      // Hevy exposes no workout-level distance, but distance_meters is present on
      // individual sets for cardio work. Sum them so workouts.distance is
      // populated for those sessions; null rather than 0 for pure strength
      // sessions, so "no distance" stays distinguishable from "zero distance".
      const workoutDistanceM = (w: any) => {
        let total = 0;
        for (const ex of w.exercises || []) {
          for (const st of ex.sets || []) total += num(st.distance_meters);
        }
        return total > 0 ? total : null;
      };
      
      // 2026-10-18: store UTC, matching every other sync module. This used to write
      // user-local wall-clock via Intl, which put Hevy rows 1h ahead of reality during
      // BST and broke every cross-source comparison (see memory/infra/kb-stack.md).
      // Keeps the `Z` (sweep item 13): a naive column drops it either way, but a
      // timestamptz column reads a string without one in the session zone
      // (Europe/London), which would put Hevy rows an hour early under BST.
      const toStorageTimestamp = (isoStr: string): string => {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        return d.toISOString();
      };

      const user = await db.prepare("SELECT sync_history_days FROM users WHERE id = ?").get(userId) as any;
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
      
      // Sync Exercise Templates (muscle group mapping, matched by exercise title)
      const exerciseTemplateMap = new Map<string, { primary: string; secondary: string[] }>();
      try {
        let templatePage = 1;
        let keepFetchingTemplates = true;

        while (keepFetchingTemplates && templatePage <= 20) {
          const templatesRes = await axios.get("https://api.hevyapp.com/v1/exercise_templates", {
            headers: {
              "api-key": apiKey,
              "accept": "application/json"
            },
            params: { page: templatePage, pageSize: 100 }
          });

          const fetchedTemplates = templatesRes.data.exercise_templates;
          if (!fetchedTemplates || fetchedTemplates.length === 0) {
            keepFetchingTemplates = false;
            break;
          }

          for (const t of fetchedTemplates) {
            if (t.title && t.primary_muscle_group) {
              exerciseTemplateMap.set(String(t.title).toLowerCase().trim(), {
                primary: t.primary_muscle_group,
                secondary: Array.isArray(t.secondary_muscle_groups) ? t.secondary_muscle_groups : []
              });
            }
          }

          if (fetchedTemplates.length < 100) {
            keepFetchingTemplates = false;
          }
          templatePage++;
        }
        logEvent('debug', `Hevy API returned muscle group data for ${exerciseTemplateMap.size} exercise templates`, 'hevy');
      } catch (templateErr: any) {
        logEvent('warn', `Hevy exercise templates endpoint failed: ${templateErr.message}. Muscle group data will be unavailable this sync.`, 'hevy');
      }

      const getMuscleGroups = (title: string): { primary: string | null; secondary: string | null } => {
        const t = exerciseTemplateMap.get((title || '').toLowerCase().trim());
        return { primary: t?.primary || null, secondary: t && t.secondary.length > 0 ? t.secondary.join(',') : null };
      };

      // Backfill muscle groups onto exercises synced before this feature existed
      // (only new/updated workouts get muscle-group data during the loop below).
      if (exerciseTemplateMap.size > 0) {
        try {
          const staleTitles = await db.prepare(
            `SELECT DISTINCT we.exercise_title AS title FROM workout_exercises we
             JOIN workouts w ON w.id = we.workout_id
             WHERE w.user_id = ? AND we.primary_muscle_group IS NULL`
          ).all(userId) as { title: string }[];

          let backfilled = 0;
          for (const row of staleTitles) {
            const mg = getMuscleGroups(row.title);
            if (!mg.primary) continue;
            const res = await db.prepare(
              `UPDATE workout_exercises SET primary_muscle_group = ?, secondary_muscle_groups = ?
               WHERE exercise_title = ? AND primary_muscle_group IS NULL
               AND workout_id IN (SELECT id FROM workouts WHERE user_id = ?)`
            ).run(mg.primary, mg.secondary, row.title, userId);
            backfilled += num((res as any)?.changes);
          }
          if (backfilled > 0) {
            logEvent('info', `Backfilled muscle group data on ${backfilled} previously-synced exercises`, 'hevy');
          }
        } catch (backfillErr: any) {
          logEvent('warn', `Muscle group backfill failed: ${backfillErr.message}`, 'hevy');
        }
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
        const deleteWorkoutsByDayStmt = db.prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'hevy' AND timestamp >= ? AND timestamp < ?");
        const deleteExercisesByDayStmt = db.prepare(`
          DELETE FROM workout_exercises 
          WHERE workout_id IN (
            SELECT id FROM workouts 
            WHERE user_id = ? AND source = 'hevy' AND timestamp >= ? AND timestamp < ?
          )
        `);
        const deleteSetsByDayStmt = db.prepare(`
          DELETE FROM workout_sets 
          WHERE exercise_id IN (
            SELECT id FROM workout_exercises 
            WHERE workout_id IN (
              SELECT id FROM workouts 
              WHERE user_id = ? AND source = 'hevy' AND timestamp >= ? AND timestamp < ?
            )
          )
        `);

        for (const day of uniqueDays) {
          const range = utcDayRange(day);
          if (!range) continue;
          await deleteSetsByDayStmt.run(userId, ...range);
          await deleteExercisesByDayStmt.run(userId, ...range);
          await deleteWorkoutsByDayStmt.run(userId, ...range);
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

          const sqlInsert = "INSERT INTO workouts (user_id, name, duration, volume, timestamp, source, external_id, routine_external_id, distance, distance_unit) VALUES (?, ?, ?, ?, ?, 'hevy', ?, ?, ?, ?)" + (db.type === 'postgres' ? " RETURNING id" : "");
          const distanceM = workoutDistanceM(w);
          const res = await db.prepare(sqlInsert).run(userId, w.title, workoutDurationMin(w), num(volume), toStorageTimestamp(w.start_time), w.id, w.routine_id ? String(w.routine_id) : null, distanceM, distanceM === null ? null : 'm');
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

            const muscleGroups = getMuscleGroups(ex.title);
            // `superset_id` groups exercises performed back-to-back. It is `??`-coalesced,
            // never `num()`-ed or `||`-defaulted: hevy uses ZERO as a real group id
            // (measured 2026-10-23 — "Lateral Raise"/"Rear Delt Fly" share group 0),
            // so a falsy check would silently merge group 0 into "not a superset".
            // The id is only unique WITHIN one workout; get_workouts says so.
            const sqlExInsert = "INSERT INTO workout_exercises (workout_id, exercise_title, sets_count, best_weight, best_reps, best_distance, best_time, best_steps, best_calories, best_avg_hr, best_max_hr, exercise_type, primary_muscle_group, secondary_muscle_groups, superset_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" + (db.type === 'postgres' ? " RETURNING id" : "");
            const exRes = await db.prepare(sqlExInsert).run(workoutId, ex.title, num(ex.sets.length), num(bestWeight), num(bestReps), num(bestDist), num(bestTime), num(bestSteps), num(bestCals), num(bestAvgHr), num(bestMaxHr), exerciseType, muscleGroups.primary, muscleGroups.secondary, ex.superset_id ?? null);
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
