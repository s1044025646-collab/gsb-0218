import type { DatabaseSync } from 'node:sqlite';
import {
  checkDigits,
  decode,
  encode,
  toErrorBody,
  type EanErrorCode,
} from './ean13.js';
import {
  getReportById,
  getReportByName,
  insertRecord,
  listRecords,
  listReports,
  listSamples,
  saveReport,
  saveSample,
  type RecordRow,
  type ReportRow,
  type SampleRow,
} from './db.js';

export interface BatchItem {
  kind?: 'digits' | 'modules';
  input?: unknown;
  op?: 'check' | 'encode' | 'decode';
}

function fail(rawInput: string, err: unknown) {
  return toErrorBody(err, rawInput);
}

/** 单条数字串处理（校验位计算/验证 + 可选编码），并写处理记录。 */
export function handleDigits(
  db: DatabaseSync,
  input: unknown,
  op: 'check' | 'encode',
): Record<string, unknown> {
  const raw = String(input ?? '');
  try {
    if (op === 'check') {
      const result = checkDigits(raw);
      insertRecord(db, { op, kind: 'digits', input: raw, ok: true, result });
      return { ok: true, operation: 'check', input: raw, result };
    }
    const result = encode(raw);
    insertRecord(db, { op, kind: 'digits', input: raw, ok: true, result });
    return { ok: true, operation: 'encode', input: raw, result };
  } catch (err) {
    const body = fail(raw, err);
    insertRecord(db, {
      op,
      kind: 'digits',
      input: raw,
      ok: false,
      errorCode: body.error.code as EanErrorCode,
      errorMessage: body.error.message,
    });
    return body;
  }
}

/** 单条模块串解码，并写处理记录。 */
export function handleModules(db: DatabaseSync, input: unknown): Record<string, unknown> {
  const raw = String(input ?? '');
  try {
    const result = decode(raw);
    insertRecord(db, { op: 'decode', kind: 'modules', input: raw, ok: true, result });
    return { ok: true, operation: 'decode', input: raw, result };
  } catch (err) {
    const body = fail(raw, err);
    insertRecord(db, {
      op: 'decode',
      kind: 'modules',
      input: raw,
      ok: false,
      errorCode: body.error.code as EanErrorCode,
      errorMessage: body.error.message,
    });
    return body;
  }
}

/**
 * 批量处理：按原顺序逐条返回，一条坏数据不影响其他条目。
 * 每个条目可用 kind 指明类型；缺省时按内容推断（仅含 0/1 且长度 95 视为模块串）。
 */
export function handleBatch(db: DatabaseSync, items: unknown): Record<string, unknown> {
  if (!Array.isArray(items)) {
    return {
      ok: false,
      error: { code: 'INVALID_BATCH', message: 'batch 必须是条目数组', input: String(items) },
    };
  }
  const batchId = Date.now();
  const results = items.map((item, index) => {
    let kind: 'digits' | 'modules';
    let raw: string;
    let op: 'check' | 'encode' | 'decode';
    if (typeof item === 'string' || typeof item === 'number') {
      raw = String(item);
      kind = raw.length === 95 && /^[01]+$/.test(raw) ? 'modules' : 'digits';
      op = kind === 'modules' ? 'decode' : 'check';
    } else if (item && typeof item === 'object') {
      const it = item as BatchItem;
      raw = String(it.input ?? '');
      kind = it.kind ?? (raw.length === 95 && /^[01]+$/.test(raw) ? 'modules' : 'digits');
      if (kind !== 'digits' && kind !== 'modules') kind = 'digits';
      op = it.op ?? (kind === 'modules' ? 'decode' : 'check');
    } else {
      return {
        index,
        ok: false,
        error: { code: 'INVALID_BATCH_ITEM', message: '不支持的条目类型', input: String(item) },
      };
    }

    try {
      if (kind === 'modules') {
        const result = decode(raw);
        insertRecord(db, {
          op: 'decode',
          kind,
          input: raw,
          ok: true,
          result: { ...result, index },
          batchId,
        });
        return { index, kind, op: 'decode', input: raw, ok: true, result };
      }
      if (op === 'encode') {
        const result = encode(raw);
        insertRecord(db, {
          op: 'encode',
          kind,
          input: raw,
          ok: true,
          result: { ...result, index },
          batchId,
        });
        return { index, kind, op: 'encode', input: raw, ok: true, result };
      }
      const result = checkDigits(raw);
      insertRecord(db, {
        op: 'check',
        kind,
        input: raw,
        ok: true,
        result: { ...result, index },
        batchId,
      });
      return { index, kind, op: 'check', input: raw, ok: true, result };
    } catch (err) {
      const body = fail(raw, err);
      insertRecord(db, {
        op,
        kind,
        input: raw,
        ok: false,
        errorCode: body.error.code as EanErrorCode,
        errorMessage: body.error.message,
        batchId,
      });
      return { index, kind, op, input: raw, ...body };
    }
  });

  const summary = {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
  const report = { ok: true, batchId, summary, results };
  const saved = saveReport(db, 'batch', report);
  return { ...report, reportId: saved.id };
}

export function handleSaveSample(
  db: DatabaseSync,
  name: unknown,
  kind: unknown,
  payload: unknown,
  note?: unknown,
): Record<string, unknown> {
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: { code: 'INVALID_NAME', message: 'name 必须是非空字符串', input: String(name) } };
  }
  if (kind !== 'digits' && kind !== 'modules') {
    return { ok: false, error: { code: 'INVALID_KIND', message: "kind 必须是 'digits' 或 'modules'", input: String(kind) } };
  }
  if (typeof payload !== 'string' || !payload.length) {
    return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'payload 必须是非空字符串', input: String(payload) } };
  }
  const row = saveSample(db, name.trim(), kind, payload, typeof note === 'string' ? note : null);
  return { ok: true, sample: row };
}

export function handleListSamples(db: DatabaseSync): { ok: true; samples: SampleRow[] } {
  return { ok: true, samples: listSamples(db) };
}

export function handleListRecords(db: DatabaseSync, limit: number): {
  ok: true;
  records: RecordRow[];
} {
  return { ok: true, records: listRecords(db, limit) };
}

export interface StoredReport {
  id: number;
  name: string | null;
  kind: string;
  createdAt: string;
  report: unknown;
}

function shapeReport(row: ReportRow): StoredReport {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
    report: JSON.parse(row.result_json) as unknown,
  };
}

export function handleGetReport(db: DatabaseSync, id: unknown, name?: unknown): Record<string, unknown> {
  let row: ReportRow | null = null;
  if (typeof name === 'string' && name.length) {
    row = getReportByName(db, name);
  } else {
    const numId = Number(id);
    if (Number.isInteger(numId)) row = getReportById(db, numId);
  }
  if (!row) {
    return { ok: false, error: { code: 'REPORT_NOT_FOUND', message: '报告不存在', input: String(name ?? id) } };
  }
  return { ok: true, stored: true, ...shapeReport(row) };
}

export function handleListReports(db: DatabaseSync) {
  return { ok: true, reports: listReports(db) };
}

/** 导出 JSON 报告字符串；可选命名保存，重复打开同名报告时返回原结果。 */
export function handleExportReport(
  db: DatabaseSync,
  kind: string,
  report: unknown,
  name?: string,
): { ok: true; reportId: number; name: string | null; json: string; reused: boolean } {
  if (name) {
    const existing = getReportByName(db, name);
    if (existing) {
      return {
        ok: true,
        reportId: existing.id,
        name: existing.name,
        json: existing.result_json,
        reused: true,
      };
    }
  }
  const row = saveReport(db, kind, report, name);
  return { ok: true, reportId: row.id, name: row.name, json: row.result_json, reused: false };
}
