import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SampleRow {
  id: number;
  name: string;
  kind: 'digits' | 'modules';
  payload: string;
  note: string | null;
  created_at: string;
}

export interface RecordRow {
  id: number;
  op: string;
  kind: string;
  input: string;
  ok: number;
  error_code: string | null;
  error_message: string | null;
  result_json: string | null;
  batch_id: number | null;
  created_at: string;
}

export interface ReportRow {
  id: number;
  name: string | null;
  kind: string;
  result_json: string;
  created_at: string;
}

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('digits','modules')),
      payload TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op TEXT NOT NULL,
      kind TEXT NOT NULL,
      input TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error_code TEXT,
      error_message TEXT,
      result_json TEXT,
      batch_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      kind TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
  return db;
}

export function saveSample(
  db: DatabaseSync,
  name: string,
  kind: 'digits' | 'modules',
  payload: string,
  note: string | null,
): SampleRow {
  db.prepare(
    `INSERT INTO samples (name, kind, payload, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, payload=excluded.payload, note=excluded.note`,
  ).run(name, kind, payload, note);
  return getSampleByName(db, name)!;
}

export function getSampleByName(db: DatabaseSync, name: string): SampleRow | null {
  const row = db.prepare('SELECT * FROM samples WHERE name = ?').get(name) as unknown as SampleRow | undefined;
  return row ?? null;
}

export function listSamples(db: DatabaseSync): SampleRow[] {
  return db.prepare('SELECT * FROM samples ORDER BY id').all() as unknown as [];
}

export function insertRecord(
  db: DatabaseSync,
  r: {
    op: string;
    kind: string;
    input: string;
    ok: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
    result?: unknown;
    batchId?: number | null;
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO records (op, kind, input, ok, error_code, error_message, result_json, batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.op,
      r.kind,
      r.input,
      r.ok ? 1 : 0,
      r.errorCode ?? null,
      r.errorMessage ?? null,
      r.result === undefined ? null : JSON.stringify(r.result),
      r.batchId ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function listRecords(db: DatabaseSync, limit = 100): RecordRow[] {
  return db
    .prepare('SELECT * FROM records ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as [];
}

export function saveReport(
  db: DatabaseSync,
  kind: string,
  result: unknown,
  name?: string,
): ReportRow {
  if (name) {
    db.prepare(
      `INSERT INTO reports (name, kind, result_json) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, result_json=excluded.result_json`,
    ).run(name, kind, JSON.stringify(result));
    return getReportByName(db, name)!;
  }
  const info = db
    .prepare('INSERT INTO reports (kind, result_json) VALUES (?, ?)')
    .run(kind, JSON.stringify(result));
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as ReportRow;
}

export function getReportByName(db: DatabaseSync, name: string): ReportRow | null {
  const row = db.prepare('SELECT * FROM reports WHERE name = ?').get(name) as unknown as ReportRow | undefined;
  return row ?? null;
}

export function getReportById(db: DatabaseSync, id: number): ReportRow | null {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow | undefined;
  return row ?? null;
}

export function listReports(db: DatabaseSync): ReportRow[] {
  return db.prepare('SELECT id, name, kind, created_at FROM reports ORDER BY id').all() as unknown as [];
}

