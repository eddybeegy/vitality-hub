import dotenv from "dotenv";
import { setupDb } from "./db";

dotenv.config();

const tables = ["users", "ai_configs", "metrics", "workouts", "workout_exercises", "workout_sets", "targets", "routines", "routine_exercises", "logs", "meal_items", "ai_insights", "chat_history", "user_cache", "system_config"];

async function migrate() {
    process.env.DATABASE_TYPE = process.env.SOURCE_DATABASE_TYPE || 'sqlite';
    const sourceDb = setupDb();

    process.env.DATABASE_TYPE = process.env.DEST_DATABASE_TYPE || 'postgres';
    const destDb = setupDb();

    for (const table of tables) {
        try {
            const rows = await sourceDb.prepare(`SELECT * FROM ${table}`).all() as any[];
            if (rows.length === 0) {
                continue;
            }

            // Get target columns and types to filter and sanitize
            let targetColsRes = await destDb.prepare(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = ?
                AND table_schema = 'public'
            `).all(table) as any[];
            
            // If empty, try without schema filter as fallback
            if (targetColsRes.length === 0) {
                 targetColsRes = await destDb.prepare(`
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = ?
                `).all(table) as any[];
            }

            if (targetColsRes.length === 0) {
                 console.warn(`Could not find schema for table ${table} in destination. Skipping table.`);
                 continue;
            }

            const targetSchema = targetColsRes.reduce((acc, col) => {
                acc[col.column_name] = col.data_type;
                return acc;
            }, {} as Record<string, string>);

            const targetSchemaLower = Object.keys(targetSchema).reduce((acc, key) => {
                acc[key.toLowerCase()] = targetSchema[key];
                return acc;
            }, {} as Record<string, string>);

            // FILTER: ONLY columns that exist in BOTH source and destination
            const columns = Object.keys(rows[0]).filter(col => {
                const exists = col.toLowerCase() in targetSchemaLower;
                if (!exists && table !== 'user_cache') { // user_cache is often different
                    // console.warn(`Column ${col} from source table ${table} does not exist in destination. Skipping column.`);
                }
                return exists;
            });

            if (columns.length === 0) {
                 console.warn(`No matching columns found for table ${table}. Skipping.`);
                 continue;
            }
            
            // Delete all records in destination first to avoid conflicts
            try {
                await destDb.exec(`DELETE FROM ${table}`);
            } catch(e) {}

            const colsStr = columns.map(c => `"${c.toLowerCase()}"`).join(", "); // Use quotes for PG safety
            const placeholders = columns.map(() => "?").join(", ");
            const insertStmt = destDb.prepare(`INSERT INTO ${table} (${colsStr}) VALUES (${placeholders})`);

            let successCount = 0;
            for (const row of rows) {
                const values = columns.map(col => {
                    let val = row[col];
                    const pgType = (targetSchemaLower[col.toLowerCase()] || '').toLowerCase();

                    // 1. Handle Nulls and Garbage strings
                    if (val === null || val === undefined) return null;
                    if (typeof val === 'string') {
                        const lowVal = val.toLowerCase();
                        if (lowVal === 'null' || lowVal === 'undefined' || val.trim() === '') return null;
                    }

                    // 2. Sanitize Integers (PG is strict about float -> int)
                    if (pgType.includes('int') || pgType.includes('serial') || pgType.includes('long')) {
                        const num = typeof val === 'number' ? val : parseFloat(val);
                        if (isNaN(num)) return null;
                        return Math.round(num);
                    }

                    // 3. Sanitize Timestamps
                    if (pgType.includes('timestamp') || pgType.includes('date')) {
                        if (typeof val === 'string') {
                            if (val.includes('null') || val.includes('undefined')) return null;
                            // If it doesn't start with a date pattern, it's likely garbage
                            if (!/^\d{4}-\d{2}-\d{2}/.test(val)) return null;
                            // SQLite holds UTC (toISOString, CURRENT_TIMESTAMP). A zoneless
                            // string sent to a timestamptz column would be read in the
                            // session zone instead, so say UTC explicitly (sweep item 13).
                            if (pgType === 'timestamp with time zone') {
                                const v = val.trim();
                                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00Z`;
                                if (!/\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}(:?\d{2})?)$/i.test(v)) return `${v}Z`;
                            }
                        }
                    }

                    // 4. Handle Boolean casts (SQLite might use 0/1)
                    if (pgType.includes('bool')) {
                        if (typeof val === 'number') return val !== 0;
                        if (typeof val === 'string') return val === '1' || val.toLowerCase() === 'true';
                    }

                    return val;
                });
                
                try {
                    await insertStmt.run(...values);
                    successCount++;
                } catch (rowError: any) {
                    if (successCount < 5) { // Only log first few errors to avoid log bloat
                        console.error(`Row migration error in ${table}:`, rowError.message, "Values:", JSON.stringify(values));
                    }
                }
            }
            
            // Reset serial sequences in Postgres if required
            if (destDb.type === 'postgres' && columns.includes('id')) {
                 try {
                     const maxIdRes = await destDb.prepare(`SELECT MAX(id) as max FROM ${table}`).get();
                     if (maxIdRes && (maxIdRes as any).max) {
                         await destDb.exec(`SELECT setval('${table}_id_seq', ${(maxIdRes as any).max})`);
                     }
                 } catch(e) {
                     console.warn(`Could not update seq for ${table}`, e);
                 }
            }

        } catch (e: any) {
            console.error(`Error migrating table ${table}:`, e.message);
        }
    }
    process.exit(0);
}

migrate();
