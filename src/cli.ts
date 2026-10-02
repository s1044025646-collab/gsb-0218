#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import {
  handleBatch,
  handleDigits,
  handleGetReport,
  handleListRecords,
  handleListReports,
  handleListSamples,
  handleModules,
  handleSaveSample,
} from './service.js';

const USAGE = [
  'ean13 — 本地 EAN-13 编码/解码实验 CLI',
  '',
  '用法:',
  '  ean13 check <12或13位数字串>        计算或校验校验位',
  '  ean13 encode <12或13位数字串>       输出 95 位模块串',
  '  ean13 decode <95位0/1模块串>        解码并校验',
  '  ean13 batch <file.json>            批量处理（JSON 数组或 {"items":[...]}）',
  '  ean13 sample save <name> <digits|modules> <payload> [note]',
  '                                      保存命名样例（重名覆盖）',
  '  ean13 sample list                  列出命名样例',
  '  ean13 records [limit]              查询最近处理记录',
  '  ean13 report list                  列出已保存报告',
  '  ean13 report get <id|name>         打开已保存报告（重复打开结果一致）',
  '  ean13 help                         显示本帮助',
  '',
  '环境变量:',
  '  DATA_DIR   数据目录（默认 ./data）',
  '',
  '示例:',
  '  ean13 check 4006381333931',
  '  ean13 encode 5901234123457',
  '  ean13 decode 10100010100100010010001000100100001001000100101010100010010010001000010100100010001001000100101',
  '',
].join('\n');

function print(body: unknown): void {
  console.log(JSON.stringify(body, null, 2));
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
  const db = openDb(join(dataDir, 'ean13.db'));

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return;
    case 'check': {
      if (!rest[0]) throw new Error('check 需要一个数字串参数');
      print(handleDigits(db, rest[0], 'check'));
      return;
    }
    case 'encode': {
      if (!rest[0]) throw new Error('encode 需要一个数字串参数');
      print(handleDigits(db, rest[0], 'encode'));
      return;
    }
    case 'decode': {
      if (!rest[0]) throw new Error('decode 需要一个模块串参数');
      print(handleModules(db, rest[0]));
      return;
    }
    case 'batch': {
      if (!rest[0]) throw new Error('batch 需要一个 JSON 文件路径');
      const parsed = JSON.parse(readFileSync(rest[0], 'utf8')) as unknown;
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed as { items?: unknown[] }).items;
      print(handleBatch(db, items));
      return;
    }
    case 'sample': {
      if (rest[0] === 'list') {
        print(handleListSamples(db));
        return;
      }
      if (rest[0] === 'save') {
        const [, name, kind, payload, note] = rest;
        print(handleSaveSample(db, name, kind, payload, note));
        return;
      }
      throw new Error('sample 子命令: save | list');
    }
    case 'records': {
      const limit = rest[0] ? Number(rest[0]) : 100;
      print(handleListRecords(db, Number.isFinite(limit) ? limit : 100));
      return;
    }
    case 'report': {
      if (rest[0] === 'list') {
        print(handleListReports(db));
        return;
      }
      if (rest[0] === 'get') {
        const key = rest[1];
        if (key === undefined) throw new Error('report get 需要 id 或名称');
        const asId = Number(key);
        print(
          Number.isInteger(asId)
            ? handleGetReport(db, asId)
            : handleGetReport(db, undefined, key),
        );
        return;
      }
      throw new Error('report 子命令: list | get');
    }
    default:
      console.error(`未知命令: ${command}\n`);
      console.log(USAGE);
      process.exitCode = 2;
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: {
          code: 'CLI_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
