import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.js';
import { decode, encode } from '../src/ean13.js';
import {
  handleBatch,
  handleDigits,
  handleModules,
  handleSaveSample,
  handleListSamples,
  handleGetReport,
} from '../src/service.js';

const line = (s: string) => console.log(`\n=== ${s} ===`);

const dbPath = join(tmpdir(), `ean13-demo-${Date.now()}.db`);
const db = openDb(dbPath);

line('1. 合法条码完整往返（已知基准 4006381333931）');
const enc = encode('4006381333931');
console.log('数字串:', enc.digits, '| 首位:', enc.firstDigit, '| 奇偶:', enc.parityPattern);
console.log('95 位模块串:', enc.modules);
const dec = decode(enc.modules);
console.log('解码结果:', dec.digits, '| 往返一致:', dec.digits === enc.digits);

line('2. 第二已知基准 5901234123457');
const enc2 = encode('5901234123457');
console.log('模块串:', enc2.modules);
console.log('解码:', decode(enc2.modules).digits);

line('3. 修改一个数字 -> 校验位不符（拒绝）');
const tampered = '4006381333939';
console.log(JSON.stringify(handleDigits(db, tampered, 'check'), null, 2));

line('4. 破坏中间护栏 -> 护栏损坏（拒绝，不做任何修补）');
const brokenGuard = enc.modules.slice(0, 47) + '111' + enc.modules.slice(50);
console.log('坏串长度仍为', brokenGuard.length, '位');
console.log(JSON.stringify(handleModules(db, brokenGuard), null, 2));

line('5. 混合好坏批次（按原顺序逐条返回）');
const batch = handleBatch(db, [
  '4006381333931',
  '123',
  enc.modules,
  'abcdefghijklm',
  enc2.modules,
  brokenGuard,
]);
console.log('汇总:', JSON.stringify(batch.summary));
for (const r of batch.results as unknown[]) console.log(JSON.stringify(r));

line('6. 保存命名样例与报告复用');
handleSaveSample(db, '示例-波兰', 'digits', '5901234123457', 'Wikipedia 示例');
console.log(JSON.stringify(handleListSamples(db), null, 2));
const reopened = handleGetReport(db, batch.reportId);
console.log('报告 id =', batch.reportId, '重复打开 ok =', reopened.ok,
  '结果条数 =', (reopened as { report: { results: unknown[] } }).report.results.length);

line('7. 前导零保留（字符串存储）');
console.log(JSON.stringify(handleDigits(db, '000000000000', 'check'), null, 2));

db.close();
rmSync(dbPath, { force: true });
console.log('\n演示完成。');
