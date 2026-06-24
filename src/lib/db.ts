import SQLiteDatabase from "better-sqlite3";
import { Pool as PgPool, PoolClient } from "pg";
import { createPool as createMysqlPool, Pool as MysqlPool, PoolConnection } from "mysql2/promise";
import fs from "fs";
import { AsyncLocalStorage } from "node:async_hooks";

export type DBType = 'sqlite' | 'postgres' | 'mariadb';

export class DatabaseWrapper {
  type: DBType;
  sqlite?: SQLiteDatabase.Database;
  pg?: PgPool;
  mysql?: MysqlPool;
  private asyncCol = new AsyncLocalStorage<PoolClient | PoolConnection>();

  constructor() {
    this.type = (process.env.DATABASE_TYPE || 'sqlite') as DBType;

    if (this.type === 'sqlite') {
      this.sqlite = new SQLiteDatabase(process.env.SQLITE_PATH || 'health.db');
      this.sqlite.pragma("journal_mode = WAL");
    } else if (this.type === 'postgres') {
      this.pg = new PgPool({ connectionString: process.env.POSTGRES_URL });
    } else if (this.type === 'mariadb' || this.type === 'mysql') {
      this.mysql = createMysqlPool({ uri: process.env.MARIADB_URL || process.env.MYSQL_URL });
    } else {
      throw new Error(`Unsupported database type: ${this.type}`);
    }
  }

  // Translates sqlite sql to native
  private translateSql(sql: string): { text: string, params: (originalParams: any[]) => any[] } {
    if (this.type === 'sqlite') return { text: sql, params: p => p };

    let text = sql;

    // 1. AUTOINCREMENT -> SERIAL / AUTO_INCREMENT
    if (this.type === 'postgres') {
      text = text.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
    } else {
      text = text.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'INT AUTO_INCREMENT PRIMARY KEY');
    }

    // 2. DATETIME DEFAULT CURRENT_TIMESTAMP
    if (this.type === 'postgres') {
      text = text.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      text = text.replace(/DATETIME/g, 'TIMESTAMP');
      text = text.replace(/timestamp\s+LIKE/gi, 'CAST(timestamp AS TEXT) LIKE');
      text = text.replace(/timestamp\s+NOT\s+LIKE/gi, 'CAST(timestamp AS TEXT) NOT LIKE');
      text = text.replace(/replace\(timestamp/gi, "replace(CAST(timestamp AS TEXT)");
      text = text.replace(/substr\(timestamp/gi, "substr(CAST(timestamp AS TEXT)");
    } else {
      text = text.replace(/DATETIME/g, 'DATETIME');
    }

    // 3. SQLite-style INSERT/UPDATE shortcuts
    if (this.type === 'postgres') {
      if (/\bINSERT OR IGNORE INTO\b/i.test(text) && !/\bON CONFLICT\b/i.test(text)) {
        text = text.replace(/\bINSERT OR IGNORE INTO\b/gi, 'INSERT INTO') + ' ON CONFLICT DO NOTHING';
      }
      if (/\bUPDATE OR IGNORE\b/i.test(text)) {
        text = text.replace(/\bUPDATE OR IGNORE\b/gi, 'UPDATE');
      }
      if (/\bINSERT OR REPLACE INTO\b/i.test(text) && !/\bON CONFLICT\b/i.test(text)) {
        if (text.includes('INSERT OR REPLACE INTO ai_configs')) {
          text = text.replace(/\bINSERT OR REPLACE INTO\b/gi, 'INSERT INTO') + ' ON CONFLICT (user_id, provider) DO NOTHING';
        } else if (text.includes('INSERT OR REPLACE INTO metrics')) {
          text = text.replace(/\bINSERT OR REPLACE INTO\b/gi, 'INSERT INTO') + ' ON CONFLICT (user_id, type, timestamp, source) DO UPDATE SET value=EXCLUDED.value, unit=EXCLUDED.unit';
        } else if (text.includes('INSERT OR REPLACE INTO targets')) {
          text = text.replace(/\bINSERT OR REPLACE INTO\b/gi, 'INSERT INTO') + ' ON CONFLICT (user_id, type) DO UPDATE SET value=EXCLUDED.value, unit=EXCLUDED.unit';
        } else if (text.includes('INSERT OR REPLACE INTO routines')) {
          text = text.replace(/\bINSERT OR REPLACE INTO\b/gi, 'INSERT INTO') + ' ON CONFLICT (external_id) DO UPDATE SET user_id=EXCLUDED.user_id, name=EXCLUDED.name, description=EXCLUDED.description, folder_name=EXCLUDED.folder_name, folder_id=EXCLUDED.folder_id';
        } else {
          text = text.replace(/\bINSERT OR REPLACE INTO\b/gi, 'INSERT INTO') + ' ON CONFLICT DO NOTHING';
        }
      }
    } else { // MySQL uses INSERT IGNORE and REPLACE INTO
      text = text.replace(/INSERT OR IGNORE INTO/gi, 'INSERT IGNORE INTO');
      text = text.replace(/INSERT OR REPLACE INTO/gi, 'REPLACE INTO');
      text = text.replace(/UPDATE OR IGNORE/gi, 'UPDATE IGNORE');
    }

    const paramMapper = (p: any[]) => p;
    if (this.type === 'postgres') {
      text = this.replaceQuestionMarks(text);
    }

    return { text, params: paramMapper };
  }

  prepare(sql: string) {
    const { text, params: mapParams } = this.translateSql(sql);

    return {
      run: async (...args: any[]) => {
        let actualArgs = args;
        if (args.length === 1 && Array.isArray(args[0])) actualArgs = args[0];
        
        const mappedArgs = mapParams(actualArgs);
        
        if (this.type === 'sqlite') {
          return this.sqlite!.prepare(text).run(...mappedArgs);
        } else if (this.type === 'postgres') {
          const client = this.asyncCol.getStore() as PoolClient;
          let res;
          if (client) {
            res = await client.query(text, mappedArgs);
          } else {
            res = await this.pg!.query(text, mappedArgs);
          }
          const result: any = { changes: res.rowCount || 0 };
          if (res.rows && res.rows.length > 0 && res.rows[0].id !== undefined) {
             result.lastInsertRowid = res.rows[0].id;
          }
          return result;
        } else {
          const conn = this.asyncCol.getStore() as PoolConnection;
          const [result] = conn ? await conn.execute(text, mappedArgs) : await this.mysql!.execute(text, mappedArgs);
          return { changes: (result as any).affectedRows };
        }
      },
      get: async (...args: any[]) => {
        let actualArgs = args;
        if (args.length === 1 && Array.isArray(args[0])) actualArgs = args[0];
        
        const mappedArgs = mapParams(actualArgs);

        if (this.type === 'sqlite') {
          return this.sqlite!.prepare(text).get(...mappedArgs);
        } else if (this.type === 'postgres') {
          const client = this.asyncCol.getStore() as PoolClient;
          const res = client ? await client.query(text, mappedArgs) : await this.pg!.query(text, mappedArgs);
          return this.serializeRows(res.rows[0]);
        } else {
          const conn = this.asyncCol.getStore() as PoolConnection;
          const [rows] = conn ? await conn.execute(text, mappedArgs) : await this.mysql!.execute(text, mappedArgs);
          return this.serializeRows((rows as any)[0]);
        }
      },
      all: async (...args: any[]) => {
        let actualArgs = args;
        if (args.length === 1 && Array.isArray(args[0])) actualArgs = args[0];
        
        const mappedArgs = mapParams(actualArgs);

        if (this.type === 'sqlite') {
          return this.sqlite!.prepare(text).all(...mappedArgs);
        } else if (this.type === 'postgres') {
          const client = this.asyncCol.getStore() as PoolClient;
          const res = client ? await client.query(text, mappedArgs) : await this.pg!.query(text, mappedArgs);
          return this.serializeRows(res.rows);
        } else {
          const conn = this.asyncCol.getStore() as PoolConnection;
          const [rows] = conn ? await conn.execute(text, mappedArgs) : await this.mysql!.execute(text, mappedArgs);
          return this.serializeRows(rows);
        }
      }
    };
  }

  private serializeRows(rows: any): any {
    if (!rows) return rows;
    if (Array.isArray(rows)) {
      return rows.map(r => this.serializeRows(r));
    }
    if (typeof rows === 'object') {
      // Check if it is a Date specifically
      if (rows instanceof Date) {
        return rows.toISOString();
      }
      // Use JSON round-trip to serialize all properties, then manually fix Dates
      try {
        const jsonStr = JSON.stringify(rows, (key, val) => {
          if (val instanceof Date) return val.toISOString();
          return val;
        });
        return JSON.parse(jsonStr);
      } catch (e) {
        // Fallback to manual iteration
        const obj: any = {};
        for (const key of Object.getOwnPropertyNames(rows)) {
          try {
            const val = rows[key];
            if (val instanceof Date) {
              obj[key] = val.toISOString();
            } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
              obj[key] = this.serializeRows(val);
            } else {
              obj[key] = val;
            }
          } catch (err: any) {
            // Silently skip properties that can't be accessed
          }
        }
        return obj;
      }
    }
    return rows;
  }

  async exec(sql: string) {
    if (sql.includes('PRAGMA')) return; // Ignore pragmas on network DBs
    const { text } = this.translateSql(sql);

    if (this.type === 'sqlite') {
      this.sqlite!.exec(text);
    } else if (this.type === 'postgres') {
      await this.pg!.query(text);
    } else {
      await this.mysql!.query(text);
    }
  }

  private replaceQuestionMarks(sql: string) {
    let count = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;
    let out = '';

    for (let i = 0; i < sql.length; i += 1) {
      const char = sql[i];
      const nextChar = i + 1 < sql.length ? sql[i + 1] : '';

      if (inLineComment) {
        out += char;
        if (char === '\n') inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        out += char;
        if (char === '*' && nextChar === '/') {
          out += nextChar;
          inBlockComment = false;
          i += 1;
        }
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
        if (char === '-' && nextChar === '-') {
          inLineComment = true;
          out += char;
          continue;
        }
        if (char === '/' && nextChar === '*') {
          inBlockComment = true;
          out += char;
          continue;
        }
      }

      if (char === "'" && !inDoubleQuote && !inBacktick) {
        inSingleQuote = !inSingleQuote;
        out += char;
        continue;
      }

      if (char === '"' && !inSingleQuote && !inBacktick) {
        inDoubleQuote = !inDoubleQuote;
        out += char;
        continue;
      }

      if (char === '`' && !inSingleQuote && !inDoubleQuote) {
        inBacktick = !inBacktick;
        out += char;
        continue;
      }

      if (char === '?' && !inSingleQuote && !inDoubleQuote && !inBacktick && !inLineComment && !inBlockComment) {
        out += `$${++count}`;
        continue;
      }

      out += char;
    }

    return out;
  }

  private sqliteTxLock: Promise<void> = Promise.resolve();

  transaction(fn: (...args: any[]) => Promise<any> | void) {
    if (this.type === 'sqlite') {
       return async (...args: any[]) => {
         let release: () => void;
         const lock = new Promise<void>(resolve => release = resolve);
         const previous = this.sqliteTxLock;
         this.sqliteTxLock = lock;
         await previous;

         try {
           this.sqlite!.exec('BEGIN');
           const res = await fn(...args);
           this.sqlite!.exec('COMMIT');
           return res;
         } catch (e) {
           try { this.sqlite!.exec('ROLLBACK'); } catch(re) {}
           throw e;
         } finally {
           release!();
         }
       };
    } else if (this.type === 'postgres') {
       return async (...args: any[]) => {
         const client = await this.pg!.connect();
         try {
           return await this.asyncCol.run(client, async () => {
             await client.query('BEGIN');
             const res = await fn(...args);
             await client.query('COMMIT');
             return res;
           });
         } catch (e) {
           await client.query('ROLLBACK');
           throw e;
         } finally {
           client.release();
         }
       };
    } else {
       return async (...args: any[]) => {
         const conn = await this.mysql!.getConnection();
         try {
           return await this.asyncCol.run(conn, async () => {
             await conn.beginTransaction();
             const res = await fn(...args);
             await conn.commit();
             return res;
           });
         } catch (e) {
           await conn.rollback();
           throw e;
         } finally {
           conn.release();
         }
       };
    }
  }
}

export const setupDb = () => new DatabaseWrapper();
