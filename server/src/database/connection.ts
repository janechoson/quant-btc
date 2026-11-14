import initSqlJs, { type Database } from 'sql.js';
import path from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { schema } from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(process.env.QUANT_BTC_ROOT||process.cwd());
const dataDir = path.resolve(process.env.QUANT_BTC_DATA_DIR||path.join(projectRoot, 'data'));
const dbPath = path.join(dataDir, 'quant-btc.db');
let database: Database | undefined;
let persistChain = Promise.resolve();

export async function openDatabase(): Promise<Database> {
  if (database) return database;
  await mkdir(dataDir, { recursive: true });
  const SQL = await initSqlJs({ locateFile: file => path.join(projectRoot, 'node_modules/sql.js/dist', file) });
  try { database = new SQL.Database(new Uint8Array(await readFile(dbPath))); }
  catch (error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;database = new SQL.Database(); }
  database.run('PRAGMA foreign_keys = ON');
  database.run(schema);
  database.run('PRAGMA foreign_keys = ON');
  database.run('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?)', [new Date().toISOString()]);
  await persistDatabase();
  return database;
}

export function getDatabase(): Database {
  if (!database) throw new Error('SQLite has not been initialized');
  return database;
}

export function all<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDatabase().prepare(sql);
  try { stmt.bind(params as never[]); const rows: T[] = []; while (stmt.step()) rows.push(stmt.getAsObject() as T); return rows; }
  finally { stmt.free(); }
}
export function get<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined { return all<T>(sql, params)[0]; }
export function run(sql: string, params: unknown[] = []): number { const d=getDatabase(); d.run(sql, params as never[]); return d.getRowsModified(); }

export async function persistDatabase(): Promise<void> {
  if (!database) return;
  const bytes = database.export();
  // sql.js reopens its in-memory database during export; restore connection pragmas.
  database.run('PRAGMA foreign_keys = ON');
  persistChain = persistChain.then(async () => {
    await mkdir(dataDir, { recursive: true });
    const temp = `${dbPath}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, dbPath);
  });
  await persistChain;
}

export async function transaction<T>(fn: () => T): Promise<T> {
  const d = getDatabase(); d.run('BEGIN IMMEDIATE');
  try { const result = fn(); d.run('COMMIT'); await persistDatabase(); return result; }
  catch (error) { d.run('ROLLBACK'); throw error; }
}
