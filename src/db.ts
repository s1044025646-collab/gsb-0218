import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "ean13.db");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('digits','modules')),
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      input TEXT NOT NULL,
      ok INTEGER NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export function saveSample(name: string, kind: "digits" | "modules", value: string) {
  const d = getDb();
  d.prepare(
    `INSERT INTO samples (name, kind, value) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, value = excluded.value`
  ).run(name, kind, value);
  return d.prepare(`SELECT * FROM samples WHERE name = ?`).get(name);
}

export function getSample(name: string) {
  return getDb().prepare(`SELECT * FROM samples WHERE name = ?`).get(name);
}

export function listSamples() {
  return getDb().prepare(`SELECT * FROM samples ORDER BY id`).all();
}

export function saveRecord(action: string, input: string, ok: boolean, result: unknown) {
  const d = getDb();
  const info = d
    .prepare(`INSERT INTO records (action, input, ok, result) VALUES (?, ?, ?, ?)`)
    .run(action, input, ok ? 1 : 0, JSON.stringify(result));
  return d.prepare(`SELECT * FROM records WHERE id = ?`).get(info.lastInsertRowid as number);
}

export function getRecord(id: number) {
  return getDb().prepare(`SELECT * FROM records WHERE id = ?`).get(id);
}

export function listRecords(limit = 50) {
  return getDb().prepare(`SELECT * FROM records ORDER BY id DESC LIMIT ?`).all(limit);
}
