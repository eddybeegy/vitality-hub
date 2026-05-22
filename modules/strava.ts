import { DataSourceModule } from "./types";

export const StravaModule: DataSourceModule = {
  id: "strava",
  name: "Strava",
  description: "Sync runs, rides, and swims from Strava",
  metricsProvided: ["distance", "duration", "calories", "avg_hr", "max_hr"],
  settings: [
    {
      key: "strava_client_id",
      label: "Strava Client ID",
      type: "text",
      description: "Your Strava Application Client ID"
    },
    {
      key: "strava_client_secret",
      label: "Strava Client Secret",
      type: "password",
      description: "Your Strava Application Client Secret"
    }
  ],
  sync: async (userId, db, logEvent, userSettings, data) => {
    // This is a placeholder for the actual OAuth sync logic
    // In a real implementation, this would use the access token to fetch activities
    logEvent('info', "Strava sync initiated", 'strava');
    
    if (!userSettings?.strava_client_id) {
      logEvent('warn', "Strava sync skipped: Client ID not configured", 'strava');
      return { success: false, message: "Strava Client ID not configured" };
    }

    // Mock implementation for now
    return { success: true, message: "Strava sync completed (Mock)" };
  },
  purge: async (userId, db, userSettings) => {
    try {
      db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'strava'").run(userId);
      db.prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'strava'").run(userId);
      return { success: true, message: "Strava data purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
