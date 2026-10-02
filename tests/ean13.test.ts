import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDigits,
  computeCheckDigit,
  decode,
  encode,
  EanError,
  PARITY_PATTERNS,
  L_CODES,
  G_CODES,
  R_CODES,
} from '../src/ean13.js';

/** 独立基准：由 Wikipedia 官方 SVG (File:EAN-13-5901234123457.svg) 逐模块解析得到。 */
const REF_590_MODULES =
  '10100010110100111011001100100110111101001110101010110011011011001000010101110010011101000100101';

test('已知条码校验位基准', () => {
  assert.equal(checkDigits('4006381333931').normalized, '4006381333931');
  assert.equal(checkDigits('5901234123457').normalized, '5901234123457');
  assert.equal(computeCheckDigit('400638133393'), 1);
  assert.equal(computeCheckDigit('590123412345'), 7);
});

test('12 位输入自动补全校验位并保留前导零', () => {
  const r = checkDigits('000000000000');
  assert.equal(r.normalized, '0000000000000');
  assert.equal(r.checkDigit, 0);
  const r2 = checkDigits('001234567890');
  assert.match(r2.normalized, /^001234567890/);
  assert.equal(r2.normalized.length, 13);
});

test('坏校验位抛出 CHECKSUM_MISMATCH 并保留原输入', () => {
  try {
    checkDigits('4006381333930');
    assert.fail('应拒绝');
  } catch (err) {
    assert.ok(err instanceof EanError);
    assert.equal((err as EanError).code, 'CHECKSUM_MISMATCH');
    assert.equal((err as EanError).input, '4006381333930');
  }
});

test('长度错误与非数字字符错误', () => {
  assert.throws(() => checkDigits('123'), (e: EanError) => e.code === 'INVALID_DIGITS_LENGTH');
  assert.throws(() => checkDigits('12345678901234'), (e: EanError) => e.code === 'INVALID_DIGITS_LENGTH');
  assert.throws(() => checkDigits('400638133393A'), (e: EanError) => e.code === 'INVALID_DIGITS_CHAR');
});

test('独立模块串期望值（非自身编码器产出）', () => {
  assert.equal(REF_590_MODULES.length, 95);
  const enc = encode('5901234123457');
  assert.equal(enc.modules, REF_590_MODULES);
  const dec = decode(REF_590_MODULES);
  assert.equal(dec.digits, '5901234123457');
});

test('4006381333931 编码往返与护栏结构', () => {
  const enc = encode('4006381333931');
  assert.equal(enc.modules.length, 95);
  assert.equal(enc.modules.slice(0, 3), '101');
  assert.equal(enc.modules.slice(45, 50), '01010');
  assert.equal(enc.modules.slice(92, 95), '101');
  assert.equal(enc.firstDigit, '4');
  assert.equal(enc.parityPattern, 'LGLLGG');
  assert.equal(decode(enc.modules).digits, '4006381333931');
});

test('全部首位数字的奇偶规则均可编码并解码', () => {
  for (let first = 0; first <= 9; first++) {
    const body = `${first}01234567890`;
    const full = body + computeCheckDigit(body);
    const enc = encode(full);
    assert.equal(enc.parityPattern, PARITY_PATTERNS[first]);
    assert.equal(decode(enc.modules).digits, full);
  }
});

test('奇偶模式表唯一性（每个组合只对应一个首位）', () => {
  assert.equal(new Set(PARITY_PATTERNS).size, 10);
});

test('L/G/R 三张表内 7 位模式互不冲突（同表）', () => {
  assert.equal(new Set(L_CODES).size, 10);
  assert.equal(new Set(G_CODES).size, 10);
  assert.equal(new Set(R_CODES).size, 10);
});

test('模块串长度错误', () => {
  assert.throws(() => decode('1010'), (e: EanError) => e.code === 'INVALID_MODULES_LENGTH');
  assert.throws(() => decode(REF_590_MODULES + '0'), (e: EanError) => e.code === 'INVALID_MODULES_LENGTH');
});

test('非二进制模块字符', () => {
  const bad = REF_590_MODULES.slice(0, 10) + '2' + REF_590_MODULES.slice(11);
  assert.throws(() => decode(bad), (e: EanError) => e.code === 'INVALID_MODULES_CHAR');
});

test('起始/中间/结束护栏损坏分别被拒绝', () => {
  const ok = REF_590_MODULES;
  const breakStart = '001' + ok.slice(3);
  assert.throws(() => decode(breakStart), (e: EanError) => e.code === 'GUARD_DAMAGED');
  const breakCenter = ok.slice(0, 45) + '11111' + ok.slice(50);
  assert.throws(() => decode(breakCenter), (e: EanError) => e.code === 'GUARD_DAMAGED');
  const breakEnd = ok.slice(0, 92) + '111';
  assert.throws(() => decode(breakEnd), (e: EanError) => e.code === 'GUARD_DAMAGED');
});

test('无法识别的数字模式', () => {
  const bad = REF_590_MODULES.slice(0, 3) + '0000000' + REF_590_MODULES.slice(10);
  assert.throws(() => decode(bad), (e: EanError) => e.code === 'UNKNOWN_DIGIT_PATTERN');
});

test('非法奇偶组合：把左侧某位换成另一数字的 L 码以破坏奇偶序列', () => {
  // 5901234123457 首位 5 -> LGGLLG。将第一个左块（应为 L 码的 9）
  // 换成同为某数字 G 码，制造非标准 L/G 组合。
  const g0 = G_CODES[0]; // 合法 7 位但起始位置按 5 的规则应为 L
  const bad = REF_590_MODULES.slice(0, 3) + g0 + REF_590_MODULES.slice(10);
  assert.throws(() => decode(bad), (e: EanError) => e.code === 'INVALID_PARITY_PATTERN');
});

test('错误不会通过补零/删模块修复：长度错误绝不进入护栏判定', () => {
  try {
    decode(REF_590_MODULES.slice(1));
    assert.fail();
  } catch (e) {
    assert.equal((e as EanError).code, 'INVALID_MODULES_LENGTH');
  }
});
