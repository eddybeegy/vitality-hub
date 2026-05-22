import { DataSourceModule } from "./types";
import { parse } from "csv-parse/sync";

export const NutrachekModule: DataSourceModule = {
  id: "nutrachek",
  name: "Nutrachek",
  description: "Sync nutrition data from Nutrachek CSV export",
  metricsProvided: ["calories_in", "protein", "carbs", "fat", "fiber", "sugar", "sodium"],
  settings: [
    {
      key: "nutrachek_csv",
      label: "Upload CSV",
      type: "file",
      description: "Upload your Nutrachek CSV export via the dashboard"
    }
  ],
  sync: async (userId, db, logEvent, userSettings, data?: any) => {
    const csvContent = userSettings?.nutrachek_csv || data?.csvContent;
    if (!csvContent) {
      return { success: false, message: "No CSV data provided. Please upload a Nutrachek CSV file in settings." };
    }

    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true
      });

      if (!records || records.length === 0) {
        return { success: true, message: "No data found in CSV", count: 0 };
      }

      const insertStmt = db.prepare("INSERT OR REPLACE INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (?, ?, ?, ?, ?, 'nutrachek')");
      const mealInsertStmt = db.prepare("INSERT INTO meal_items (user_id, name, calories, protein, carbs, fat, fiber, sodium, iron, timestamp, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nutrachek')");
      
      const uniqueDays = new Set<string>();
      const processedRecords: any[] = [];

      for (const r of records as any[]) {
        const dateStr = r['Date'] || r['date'];
        if (!dateStr) continue;

        let ts: string;
        try {
          if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
              ts = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
            } else {
              continue;
            }
          } else {
            ts = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00Z`).toISOString();
          }
          const day = ts.split('T')[0];
          uniqueDays.add(day);
          processedRecords.push({ ...r, ts });
        } catch (e) {
          continue;
        }
      }

      let count = 0;
      
      await db.transaction(async () => {
        // Delete existing data for the days being imported to ensure Nutrachek is the source of truth
        const deleteMetricsStmt = db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'nutrachek' AND CAST(timestamp AS TEXT) LIKE ?");
        const deleteMealsStmt = db.prepare("DELETE FROM meal_items WHERE user_id = ? AND source = 'nutrachek' AND CAST(timestamp AS TEXT) LIKE ?");
        
        for (const day of uniqueDays) {
          await deleteMetricsStmt.run(userId, `${day}%`);
          await deleteMealsStmt.run(userId, `${day}%`);
        }

        let recordIndex = 0;
        for (const r of processedRecords) {
          const ts = r.ts;
          const dateStr = r['Date'] || r['date'];

          // Ensure unique but stable timestamp for multiple items on same day
          const recordId = `${dateStr}-${r['Description'] || r['Food'] || r['Item']}-${r['Meal'] || ''}`;
          let hash = 0;
          for (let i = 0; i < recordId.length; i++) {
            const char = recordId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const offset = Math.abs(hash % 1000) + recordIndex;
          const uniqueTs = new Date(new Date(ts).getTime() + offset).toISOString();

          const getVal = (key: string) => {
            const val = r[key];
            if (!val) return 0;
            const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
            return isNaN(parsed) ? 0 : parsed;
          };

          const insertMetric = async (type: string, value: number, unit: string) => {
            if (value > 0) {
              await insertStmt.run(userId, type, value, unit, uniqueTs);
            }
          };

          const calories = getVal('Calories') || getVal('Cals') || getVal('Energy');
          const protein = getVal('Protein') || getVal('Protein (g)');
          const carbs = getVal('Carbs') || getVal('Carbohydrate (g)');
          const fat = getVal('Fat') || getVal('Fat (g)');
          const fiber = getVal('Fiber') || getVal('Fibre') || getVal('Fibre (g)');
          const sugar = getVal('Sugar') || getVal('Sugars (g)');
          const salt = getVal('Salt') || getVal('Salt (g)');
          const sodium = salt * 393.4; // Convert salt (g) to sodium (mg)

          await insertMetric('calories_in', calories, 'kcal');
          await insertMetric('protein', protein, 'g');
          await insertMetric('carbs', carbs, 'g');
          await insertMetric('fat', fat, 'g');
          await insertMetric('fiber', fiber, 'g');
          await insertMetric('sugar', sugar, 'g');
          await insertMetric('sodium', sodium, 'mg');

          const foodName = r['Description'] || r['Food'] || r['Item'] || 'Nutrachek Item';

          try {
            await mealInsertStmt.run(
              userId,
              foodName,
              calories,
              protein,
              carbs,
              fat,
              fiber,
              sodium,
              0, // iron
              uniqueTs
            );
          } catch (e: any) {
            logEvent('error', `Failed to insert Nutrachek meal item: ${e.message} (Record: ${recordId}, TS: ${uniqueTs})`, 'nutrachek');
          }
          
          count++;
          recordIndex++;
        }
      })();

      return { success: true, message: `Imported ${count} records from Nutrachek CSV`, count };
    } catch (e: any) {
      logEvent('error', `Nutrachek CSV parse failed: ${e.message}`, 'nutrachek');
      return { success: false, message: e.message };
    }
  },
  purge: async (userId, db, userSettings) => {
    try {
      await db.prepare("DELETE FROM metrics WHERE user_id = ? AND source = 'nutrachek'").run(userId);
      await db.prepare("DELETE FROM meal_items WHERE user_id = ? AND source = 'nutrachek'").run(userId);
      return { success: true, message: "Nutrachek data purged" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};
