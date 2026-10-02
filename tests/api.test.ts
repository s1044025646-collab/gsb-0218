import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type StartedServer } from '../src/server.js';
import { encode } from '../src/ean13.js';

let started: StartedServer;
let base: string;

before(async () => {
  started = await startServer({ dataDir: join(tmpdir(), `ean13-api-${process.pid}`) });
  base = `http://127.0.0.1:${started.port}`;
});

after(() => {
  started.server.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test('GET /health', async () => {
  const res = await fetch(base + '/health');
  const json = (await res.json()) as { ok: boolean };
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});

test('POST /api/check 与 /api/encode', async () => {
  const chk = await post('/api/check', { input: '400638133393' });
  assert.equal(chk.json.result.normalized, '4006381333931');
  const enc = await post('/api/encode', { input: '5901234123457' });
  assert.equal(enc.json.result.modules.length, 95);
});

test('POST /api/decode 独立基准串与坏校验返回结构化错误', async () => {
  const ref = encode('5901234123457').modules;
  const ok = await post('/api/decode', { input: ref });
  assert.equal(ok.json.result.digits, '5901234123457');
  const bad = await post('/api/decode', { input: ref.slice(0, -1) });
  assert.equal(bad.json.ok, false);
  assert.equal(bad.json.error.code, 'INVALID_MODULES_LENGTH');
  assert.equal(bad.json.error.input.length, 94);
});

test('POST /api/batch 混合批次保留顺序', async () => {
  const r = await post('/api/batch', {
    items: ['4006381333931', '12', { input: '5901234123457', op: 'encode' }],
  });
  assert.deepEqual(r.json.summary, { total: 3, succeeded: 2, failed: 1 });
  assert.equal(r.json.results[1].error.code, 'INVALID_DIGITS_LENGTH');
});

test('样例保存/查询、记录、报告保存与重复打开', async () => {
  const saved = await post('/api/samples', {
    name: 'api-case',
    kind: 'digits',
    payload: '0000000000000',
  });
  assert.equal(saved.json.ok, true);
  const list = await post('/api/samples', { action: 'list' });
  assert.ok(list.json.samples.some((s: { name: string }) => s.name === 'api-case'));

  const records = await post('/api/records', { limit: 5 });
  assert.ok(records.json.records.length >= 1);

  const exp = await post('/api/reports', {
    action: 'export',
    name: 'api-report',
    kind: 'manual',
    report: { v: 1 },
  });
  assert.equal(exp.json.reused, false);
  const exp2 = await post('/api/reports', {
    action: 'export',
    name: 'api-report',
    kind: 'manual',
    report: { v: 2 },
  });
  assert.equal(exp2.json.reused, true);
  const got = await post('/api/reports', { action: 'get', name: 'api-report' });
  assert.deepEqual(got.json.report, { v: 1 });
});

test('非法 JSON 与未知路径返回明确错误码', async () => {
  const res = await fetch(base + '/api/check', {
    method: 'POST',
    body: 'not-json',
  });
  const json = (await res.json()) as { error: { code: string } };
  assert.equal(res.status, 400);
  assert.equal(json.error.code, 'INVALID_JSON');
  const res2 = await fetch(base + '/nope');
  assert.equal(res2.status, 405);
});
