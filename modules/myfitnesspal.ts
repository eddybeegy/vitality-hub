import { DataSourceModule } from "./types";

export const MyFitnessPalModule: DataSourceModule = {
  id: "myfitnesspal",
  name: "MyFitnessPal",
  description: "Sync nutrition data from MyFitnessPal (CSV Export)",
  metricsProvided: ["calories_in", "protein", "carbs", "fat", "fiber", "sugar", "sodium"],
  settings: [
    {
      key: "mfp_csv_file",
      label: "Upload MFP CSV",
      type: "file",
      description: "Upload your MyFitnessPal data export CSV"
    }
  ],
  sync: async (userId, db, logEvent, userSettings, data) => {
    logEvent('info', "MyFitnessPal CSV sync initiated", 'myfitnesspal');
    
    if (!data || !data.fileContent) {
      logEvent('warn', "MyFitnessPal sync skipped: No file content provided", 'myfitnesspal');
      return { success: false, message: "No CSV file provided" };
    }

    // Logic to parse CSV and insert into metrics/meal_items would go here
    return { success: true, message: "MyFitnessPal CSV processed (Mock)" };
  },
  purge: async (userId, db, userSettings) => {
    try {
      await db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'myfitnesspal'").run(userId);
      await db.prepare("DELETE FROM meal_items WHERE user_id = ? AND source = 'myfitnesspal'").run(userId);
      return { success: true, message: "MyFitnessPal data purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
