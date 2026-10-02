import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import {
  handleBatch,
  handleDigits,
  handleExportReport,
  handleGetReport,
  handleListRecords,
  handleListSamples,
  handleModules,
  handleSaveSample,
} from '../src/service.js';
import { encode } from '../src/ean13.js';
import type { DatabaseSync } from 'node:sqlite';

const dbPath = join(tmpdir(), `ean13-svc-${process.pid}.db`);
let db: DatabaseSync;

before(() => {
  rmSync(dbPath, { force: true });
  db = openDb(dbPath);
});

test('成功与失败处理均入记录，数字串按字符串保留前导零', () => {
  const ok = handleDigits(db, '0076211900019', 'check') as { ok: boolean; result?: { normalized: string } };
  assert.equal(ok.ok, true);
  assert.equal(ok.result!.normalized, '0076211900019');
  const bad = handleDigits(db, '0076211900013', 'check') as { ok: boolean };
  assert.equal(bad.ok, false);
  const records = handleListRecords(db, 10).records;
  assert.ok(records.length >= 2);
  const stored = records.find((r) => r.input === '0076211900019');
  assert.ok(stored);
  assert.equal(stored!.ok, 1);
});

test('混合好坏批次按原顺序逐条返回且互不吞掉', () => {
  const modules = encode('4006381333931').modules;
  const out = handleBatch(db, [
    '4006381333931',
    '1',
    modules,
    'XXXXXXXXXXXXX',
  ]) as {
    summary: { total: number; succeeded: number; failed: number };
    results: Array<{ index: number; input: string; ok: boolean }>;
    reportId: number;
  };
  assert.deepEqual(out.summary, { total: 4, succeeded: 2, failed: 2 });
  assert.deepEqual(out.results.map((r) => r.index), [0, 1, 2, 3]);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.results[1].ok, false);
  assert.equal(out.results[2].ok, true);
  assert.equal(out.results[3].ok, false);

  const reopened = handleGetReport(db, out.reportId) as {
    ok: boolean;
    report: { results: unknown[] };
  };
  assert.equal(reopened.ok, true);
  assert.equal(reopened.report.results.length, 4);
});

test('模块串解码成功与失败', () => {
  const modules = encode('5901234123457').modules;
  assert.equal((handleModules(db, modules) as { result: { digits: string } }).result.digits, '5901234123457');
  const broken = modules.slice(0, 45) + '11111' + modules.slice(50);
  assert.equal((handleModules(db, broken) as { ok: boolean }).ok, false);
});

test('命名样例保存、重名覆盖与列举', () => {
  handleSaveSample(db, 'lead-zero', 'digits', '0000000000000');
  const again = handleSaveSample(db, 'lead-zero', 'digits', '0000000000017', 'updated');
  assert.equal((again as { sample: { payload: string } }).sample.payload, '0000000000017');
  const list = handleListSamples(db).samples;
  assert.ok(list.some((s) => s.name === 'lead-zero' && s.payload === '0000000000017'));
});

test('命名报告重复打开返回原结果', () => {
  const first = handleExportReport(db, 'custom', { hello: 'world', n: 1 }, 'weekly') as {
    reused: boolean;
    json: string;
  };
  assert.equal(first.reused, false);
  const second = handleExportReport(db, 'custom', { hello: 'CHANGED', n: 2 }, 'weekly') as {
    reused: boolean;
    json: string;
  };
  assert.equal(second.reused, true);
  assert.equal(second.json, first.json);
  assert.match(second.json, /world/);
});

test('重启后（重新打开同一 SQLite 文件）记录与样例仍可查', () => {
  db.close();
  const reopenedDb = openDb(dbPath);
  const records = handleListRecords(reopenedDb, 1000).records;
  assert.ok(records.some((r) => r.input === '0076211900019'));
  const samples = handleListSamples(reopenedDb).samples;
  assert.ok(samples.some((s) => s.name === 'lead-zero'));
  const reports = handleGetReport(reopenedDb, undefined, 'weekly') as { ok: boolean };
  assert.equal(reports.ok, true);
  reopenedDb.close();
});

