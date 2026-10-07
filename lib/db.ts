import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'storyloom.sqlite'));
db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
export function query<T>(sql: string, ...args: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}
export function one<T>(sql: string, ...args: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...args) as T | undefined;
}
export function run(sql: string, ...args: (string | number | null)[]) {
  return db.prepare(sql).run(...args);
}
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)');
  for (const name of fs
    .readdirSync(path.join(process.cwd(), 'migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if (!one('SELECT name FROM migrations WHERE name=?', name)) {
      transaction(() => {
        // Another app/build process may have applied this migration while we waited for the lock.
        if (one('SELECT name FROM migrations WHERE name=?', name)) return;
        db.exec(fs.readFileSync(path.join(process.cwd(), 'migrations', name), 'utf8'));
        run('INSERT INTO migrations VALUES (?,?)', name, now());
      });
    }
  }
}
migrate();
export function setting(key: string, fallback: string) {
  return one<{ value: string }>('SELECT value FROM settings WHERE key=?', key)?.value ?? fallback;
}
export function setSetting(key: string, value: string) {
  run(
    'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key,
    value,
  );
}
