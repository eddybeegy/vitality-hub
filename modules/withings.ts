import axios from "axios";
import qs from "qs";
import { DataSourceModule } from "./types";

export const WithingsModule: DataSourceModule = {
  id: "withings",
  name: "Withings",
  description: "Sync weight, body fat, and other body metrics from Withings",
  metricsProvided: ["weight", "body_fat", "muscle_mass", "lean_body_mass", "fat_mass", "bone_mass", "hydration", "height", "blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate", "vo2_max", "pulse_wave_velocity", "visceral_fat", "metabolic_age", "steps", "active_energy", "distance", "sleep", "sleep_core", "sleep_deep", "sleep_rem"],
  settings: [
    {
      key: "withings_client_id",
      label: "Withings Client ID",
      type: "text",
      description: "Your Withings API Client ID. Note: Ensure your Withings Developer Application Redirect URI matches your server URL (e.g. https://your-server/api/auth/withings/callback)."
    },
    {
      key: "withings_client_secret",
      label: "Withings Client Secret",
      type: "password",
      description: "Your Withings API Client Secret"
    }
  ],
  sync: async (userId, db, logEvent, userSettings) => {
    const user = await db.prepare("SELECT withings_token, withings_refresh_token, withings_client_id, withings_client_secret, sync_history_days FROM users WHERE id = ?").get(userId) as any;
    if (!user?.withings_token) {
      logEvent('warn', 'Withings sync skipped: No token found for user', 'withings');
      return { success: false, message: "Withings not connected" };
    }

    const clientId = userSettings.withings_client_id || user.withings_client_id || process.env.WITHINGS_CLIENT_ID;
    const clientSecret = userSettings.withings_client_secret || user.withings_client_secret || process.env.WITHINGS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      logEvent('error', 'Withings sync failed: Missing Client ID or Client Secret', 'withings');
      return { success: false, message: "Withings credentials missing" };
    }

    const refreshWithingsToken = async () => {
      try {
        logEvent('info', 'Attempting Withings token refresh...', 'withings');
        if (!clientId || !clientSecret || !user.withings_refresh_token) {
           logEvent('error', `Token refresh failed: Missing credentials or refresh token. CID: ${!!clientId}, CS: ${!!clientSecret}, RT: ${!!user.withings_refresh_token}`, 'withings');
           return null;
        }
        const response = await axios.post("https://wbsapi.withings.net/v2/oauth2", qs.stringify({
          action: "requesttoken",
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: user.withings_refresh_token
        }));

        if (response.data.status === 0) {
          const { access_token, refresh_token } = response.data.body;
          await db.prepare("UPDATE users SET withings_token = ?, withings_refresh_token = ? WHERE id = ?").run(access_token, refresh_token, userId);
          logEvent('info', 'Withings token refreshed successfully', 'withings');
          return access_token;
        } else {
          logEvent('error', `Withings token refresh API Error: ${JSON.stringify(response.data)}`, 'withings');
          return null;
        }
      } catch (e: any) {
        logEvent('error', `Withings token refresh exception: ${e.message}`, 'withings');
        return null;
      }
    };

    try {
      const num = (v: any) => {
        const n = Number(v);
        return isNaN(n) ? 0 : n;
      };
      const historyDays = user.sync_history_days || 90;
      const startTime = Math.floor((Date.now() - historyDays * 24 * 60 * 60 * 1000) / 1000);
      const todayYMD = new Date().toISOString().split('T')[0];
      const startYMD = new Date(startTime * 1000).toISOString().split('T')[0];
      
      logEvent('debug', `Starting Withings sync for last ${historyDays} days (Start: ${startYMD})`, 'withings');

      const fetchMeasures = async (accessToken: string, offset: number = 0) => {
        const params = qs.stringify({
          action: "getmeas",
          startdate: startTime,
          offset: offset,
          category: 1
        });
        return await axios.post("https://wbsapi.withings.net/measure", params, {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${accessToken}`
          }
        });
      };

      const fetchWorkouts = async (accessToken: string, offset: number = 0) => {
        const params = qs.stringify({
          action: "getworkouts",
          startdateymd: startYMD,
          enddateymd: todayYMD,
          offset: offset
        });
        return await axios.post("https://wbsapi.withings.net/v2/measure", params, {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${accessToken}`
          }
        });
      };

      const fetchActivity = async (accessToken: string, offset: number = 0) => {
        const params = qs.stringify({
          action: "getactivity",
          startdateymd: startYMD,
          enddateymd: todayYMD,
          offset: offset
        });
        return await axios.post("https://wbsapi.withings.net/v2/measure", params, {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${accessToken}`
          }
        });
      };

      const fetchSleep = async (accessToken: string) => {
        const params = qs.stringify({
          action: "get",
          startdate: startTime,
          enddate: Math.floor(Date.now() / 1000),
          data_fields: "asleep_duration,light_sleep_duration,deep_sleep_duration,rem_sleep_duration,hr_average"
        });
        return await axios.post("https://wbsapi.withings.net/v2/sleep", params, {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${accessToken}`
          }
        });
      };

      let token = user.withings_token;
      let count = 0;
      let allGroups: any[] = [];
      let allWorkouts: any[] = [];
      let allActivities: any[] = [];
      let allSleep: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let response = await fetchMeasures(token, offset);

        if (response.data.status === 401) {
          logEvent('info', 'Withings token expired, refreshing...', 'withings');
          token = await refreshWithingsToken();
          if (token) {
            response = await fetchMeasures(token, offset);
          } else {
            return { success: false, message: "Withings token refresh failed" };
          }
        }

        if (response.data.status !== 0) {
          logEvent('error', `Withings API error (measures): ${response.data.status}`, 'withings');
          break; // Stop fetching measures but continue with workouts
        }

        const groups = response.data.body.measuregrps || [];
        allGroups = allGroups.concat(groups);
        logEvent('debug', `Fetched ${groups.length} measure groups from Withings`, 'withings');
        
        if (response.data.body.more) {
          offset = response.data.body.offset || (offset + groups.length);
        } else {
          hasMore = false;
        }

        if (allGroups.length > 2000) break;
      }

      // Fetch Workouts
      offset = 0;
      hasMore = true;
      while (hasMore) {
        let response = await fetchWorkouts(token, offset);
        if (response.data.status === 401) {
          token = await refreshWithingsToken();
          if (token) response = await fetchWorkouts(token, offset);
          else break;
        }
        if (response.data.status !== 0) {
          logEvent('error', `Withings API error (workouts): ${response.data.status}`, 'withings');
          break;
        }
        const workouts = response.data.body.series || [];
        allWorkouts = allWorkouts.concat(workouts);
        logEvent('debug', `Fetched ${workouts.length} workouts from Withings`, 'withings');
        if (response.data.body.more) {
          offset = response.data.body.offset || (offset + workouts.length);
        } else {
          hasMore = false;
        }
        if (allWorkouts.length > 1000) break;
      }

      // Fetch Activity
      offset = 0;
      hasMore = true;
      while (hasMore) {
        let response = await fetchActivity(token, offset);
        if (response.data.status === 401) {
          token = await refreshWithingsToken();
          if (token) response = await fetchActivity(token, offset);
          else break;
        }
        if (response.data.status !== 0) {
          logEvent('error', `Withings API error (activity): ${response.data.status}`, 'withings');
          break;
        }
        const activities = response.data.body.activities || [];
        allActivities = allActivities.concat(activities);
        logEvent('debug', `Fetched ${activities.length} activity records from Withings`, 'withings');
        if (response.data.body.more) {
          offset = response.data.body.offset || (offset + activities.length);
        } else {
          hasMore = false;
        }
        if (allActivities.length > 1000) break;
      }

      // Fetch Sleep
      try {
        let response = await fetchSleep(token);
        if (response.data.status === 401) {
          token = await refreshWithingsToken();
          if (token) response = await fetchSleep(token);
        }
        if (response.data.status === 0) {
          allSleep = response.data.body.series || [];
        }
      } catch (e) {
        logEvent('error', `Withings sleep sync failed: ${e}`, 'withings');
      }

      const insertStmt = db.prepare("INSERT OR REPLACE INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (?, ?, ?, ?, ?, 'withings')");
      
      const uniqueDays = new Set<string>();
      for (const grp of allGroups) {
        const day = new Date(grp.date * 1000).toISOString().split('T')[0];
        uniqueDays.add(day);
      }
      for (const w of allWorkouts) {
        const day = w.date; // date is yyyy-mm-dd
        uniqueDays.add(day);
      }
      for (const a of allActivities) {
        const day = a.date; // date is yyyy-mm-dd
        uniqueDays.add(day);
      }
      for (const s of allSleep) {
        const day = new Date(s.startdate * 1000).toISOString().split('T')[0];
        uniqueDays.add(day);
      }

      await db.transaction(async () => {
        // Delete existing data for the days being imported to ensure Withings is the source of truth
        const deleteStmt = db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'withings' AND CAST(timestamp AS TEXT) LIKE ?");
        for (const day of uniqueDays) {
          await deleteStmt.run(userId, `${day}%`);
        }

        for (const grp of allGroups) {
          const ts = new Date(grp.date * 1000).toISOString();
          for (const m of grp.measures) {
            let type = "";
            let unit = "";
            let value = m.value * Math.pow(10, m.unit);

            switch (m.type) {
              case 1: type = "weight"; unit = "kg"; break;
              case 6: type = "body_fat"; unit = "%"; break;
              case 5: type = "lean_body_mass"; unit = "kg"; break;
              case 8: type = "fat_mass"; unit = "kg"; break;
              case 76: type = "muscle_mass"; unit = "kg"; break;
              case 88: type = "bone_mass"; unit = "kg"; break;
              case 77: type = "hydration"; unit = "kg"; break;
              case 4: type = "height"; unit = "m"; break;
              case 9: type = "blood_pressure_diastolic"; unit = "mmHg"; break;
              case 10: type = "blood_pressure_systolic"; unit = "mmHg"; break;
              case 11: type = "heart_rate"; unit = "bpm"; break;
              case 168: type = "vo2_max"; unit = "ml/min/kg"; break; 
              case 123: type = "vo2_max"; unit = "ml/min/kg"; break;
              case 170: type = "pulse_wave_velocity"; unit = "m/s"; break;
              case 226: type = "visceral_fat"; unit = "index"; break;
              case 227: type = "metabolic_age"; unit = "years"; break;
              case 167: type = "nerve_health"; unit = "score"; break;
              case 155: type = "nerve_health"; unit = "score"; break;
              case 91: type = "recovery_heart_rate"; unit = "bpm"; break;
            }

            if (type) {
              // Special handling for visceral fat scaling if it seems obviously too high (index vs cm2/mm2/scaled)
              // API often returns Area in cm2. Index is roughly Area / 4. 
              // If user sees 4.4 in app and we get 17.1 from API (1714 unit -2), dividing by 4 gives 4.28.
              if (type === 'visceral_fat') {
                const oldVal = value;
                if (value > 200) value = value / 100; // Handle raw values missing unit logic if any
                value = value / 4.0;
                logEvent('debug', `Withings: Scaled visceral_fat from ${oldVal} to ${value} (Raw: ${m.value}, Unit: ${m.unit})`, 'withings');
              }
              // Pulse wave velocity can sometimes come as x10
              if (type === 'pulse_wave_velocity' && value > 30) {
                value = value / 10;
              }
              
              await insertStmt.run(userId, type, value, unit, ts);
              count++;
              
              if (['visceral_fat', 'metabolic_age', 'pulse_wave_velocity', 'lean_body_mass', 'fat_mass'].includes(type)) {
                logEvent('debug', `Withings: Synced ${type}: ${value} ${unit} (Raw: ${m.value}, Unit: ${m.unit})`, 'withings');
              }
            } else {
              logEvent('debug', `Withings: Skipping unknown measurement type ${m.type} (value: ${m.value})`, 'withings');
            }
          }
        }

        // Process Workouts
        for (const w of allWorkouts) {
          const ts = w.startdate ? new Date(w.startdate * 1000).toISOString() : new Date(w.date).toISOString();
          const d = w.data || {};
          const calories = d.calories || w.calories;
          const steps = d.steps || w.steps;
          const distance = d.distance || w.distance;

          if (calories) {
            await insertStmt.run(userId, 'active_energy', calories, 'kcal', ts);
            count++;
          }
          if (steps) {
            await insertStmt.run(userId, 'steps', steps, 'steps', ts);
            count++;
          }
          if (distance) {
            await insertStmt.run(userId, 'distance', distance, 'm', ts);
            count++;
          }
        }

        // Process Activity
        for (const a of allActivities) {
          const ts = new Date(a.date).toISOString();
          if (a.steps) {
            await insertStmt.run(userId, 'steps', a.steps, 'steps', ts);
            count++;
          }
          if (a.distance) {
            await insertStmt.run(userId, 'distance', a.distance, 'm', ts);
            count++;
          }
          if (a.calories) {
            await insertStmt.run(userId, 'active_energy', a.calories, 'kcal', ts);
            count++;
          }
          if (a.active_calories) {
            // Already handled by calories if it was overall active calories
          }
        }

        // Process Sleep
        for (const s of allSleep) {
          const ts = new Date(s.startdate * 1000).toISOString();
          const d = s.data;
          if (d.asleep_duration) {
            await insertStmt.run(userId, 'sleep', d.asleep_duration, 's', ts);
            count++;
          }
          if (d.light_sleep_duration) {
            await insertStmt.run(userId, 'sleep_core', d.light_sleep_duration, 's', ts);
            count++;
          }
          if (d.deep_sleep_duration) {
            await insertStmt.run(userId, 'sleep_deep', d.deep_sleep_duration, 's', ts);
            count++;
          }
          if (d.rem_sleep_duration) {
            await insertStmt.run(userId, 'sleep_rem', d.rem_sleep_duration, 's', ts);
            count++;
          }
          if (d.hr_average) {
            await insertStmt.run(userId, 'heart_rate', d.hr_average, 'bpm', ts);
            count++;
          }
        }
      })();

      return { success: true, message: `Synced ${count} measurements from Withings`, count };
    } catch (error: any) {
      logEvent('error', `Withings sync failed: ${error.message}`, 'withings');
      return { success: false, message: error.message };
    }
  },
  purge: async (userId, db, userSettings) => {
    try {
      await db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'withings'").run(userId);
      return { success: true, message: "Withings data purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
