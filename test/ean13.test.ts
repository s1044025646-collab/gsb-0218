import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { validateDigits, encode, decode, computeCheckDigit } from "../src/ean13.js";
import { doSaveSample, doEncode, doBatch } from "../src/service.js";
import { DATA_DIR } from "../src/db.js";

// 手工按标准编码表推导的独立期望值（不是用本实现生成的）
const EXPECTED_4006381333931 =
  "101" + // 起始护栏
  "0001101" + "0100111" + "0101111" + "0111101" + "0001001" + "0110011" + // 左侧 006381, 奇偶 LGLLGG
  "01010" + // 中间护栏
  "1000010" + "1000010" + "1000010" + "1110100" + "1000010" + "1100110" + // 右侧 333931
  "101"; // 结束护栏

test("已知条码校验基准", () => {
  assert.equal(computeCheckDigit("400638133393"), "1");
  assert.equal(computeCheckDigit("590123412345"), "7");
  const a = validateDigits("4006381333931");
  const b = validateDigits("5901234123457");
  assert.ok(a.ok && b.ok);
});

test("编码输出与独立期望模块串一致", () => {
  const r = encode("4006381333931");
  assert.ok(r.ok);
  assert.equal(r.modules.length, 95);
  assert.equal(r.modules, EXPECTED_4006381333931);
});

test("解码独立期望模块串还原数字", () => {
  const r = decode(EXPECTED_4006381333931);
  assert.ok(r.ok);
  assert.equal(r.digits, "4006381333931");
  assert.equal(r.parityPattern, "LGLLGG");
});

test("12 位输入自动补校验位", () => {
  const r = validateDigits("590123412345");
  assert.ok(r.ok);
  assert.equal(r.full, "5901234123457");
});

test("前导零保留", () => {
  const r = validateDigits("0012345678905");
  assert.ok(r.ok);
  assert.equal(r.full, "0012345678905");
  const e = encode("0012345678905");
  assert.ok(e.ok);
  const d = decode(e.modules);
  assert.ok(d.ok);
  assert.equal(d.digits, "0012345678905");
});

test("全部首位数字的奇偶规则", () => {
  const expectedParity = [
    "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
    "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
  ];
  for (let first = 0; first <= 9; first++) {
    const base = String(first) + "01234567890";
    const v = validateDigits(base);
    assert.ok(v.ok);
    const e = encode(v.full);
    assert.ok(e.ok);
    const d = decode(e.modules);
    assert.ok(d.ok);
    assert.equal(d.digits, v.full);
    assert.equal(d.parityPattern, expectedParity[first], `首位 ${first} 奇偶模式`);
  }
});

test("长度不符", () => {
  const r = validateDigits("12345");
  assert.ok(!r.ok && r.code === "INVALID_DIGIT_LENGTH");
  const m = decode("101");
  assert.ok(!m.ok && m.code === "INVALID_MODULE_LENGTH");
});

test("非法字符", () => {
  const r = validateDigits("40063813339a1");
  assert.ok(!r.ok && r.code === "INVALID_DIGIT_CHARS");
  const m = decode("1012010" + "0".repeat(88));
  assert.ok(!m.ok && m.code === "INVALID_MODULE_CHARS");
});

test("坏校验位", () => {
  const r = validateDigits("4006381333932");
  assert.ok(!r.ok && r.code === "CHECKSUM_MISMATCH");
  assert.equal(r.input, "4006381333932"); // 保留原输入
});

test("护栏损坏", () => {
  const broken = "111" + EXPECTED_4006381333931.slice(3);
  const r = decode(broken);
  assert.ok(!r.ok && r.code === "GUARD_DAMAGED");
});

test("无法识别的数字模式", () => {
  const bad = EXPECTED_4006381333931.slice(0, 3) + "1111111" + EXPECTED_4006381333931.slice(10);
  const r = decode(bad);
  assert.ok(!r.ok && r.code === "UNKNOWN_DIGIT_PATTERN");
});

test("非法奇偶组合", () => {
  // 构造左侧奇偶为 LLLLLG（不在标准表中）: 前 5 位用 L 码，第 6 位用 G 码
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011"];
  const G6 = "0111001";
  const modules =
    "101" + L.join("") + G6 + "01010" + EXPECTED_4006381333931.slice(50);
  const r = decode(modules);
  assert.ok(!r.ok && r.code === "ILLEGAL_PARITY");
});

test("混合好坏批次按原顺序逐条返回", () => {
  const r = doBatch([
    { action: "checksum", input: "4006381333931" },
    { action: "checksum", input: "4006381333932" },
    { action: "encode", input: "5901234123457" },
    { action: "decode", input: "xyz" },
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.okCount, 2);
  assert.ok(r.results[0].result.ok);
  assert.ok(!r.results[1].result.ok && r.results[1].result.code === "CHECKSUM_MISMATCH");
  assert.ok(r.results[2].result.ok);
  assert.ok(!r.results[3].result.ok && r.results[3].result.code === "INVALID_MODULE_CHARS");
  assert.deepEqual(r.results.map((x) => x.index), [0, 1, 2, 3]);
});

test("保存记录重启后可查（新连接读取同一数据库文件）", () => {
  doSaveSample("persist-test", "digits", "4006381333931");
  doEncode("4006381333931");
  const fresh = new DatabaseSync(path.join(DATA_DIR, "ean13.db"));
  const sample = fresh.prepare(`SELECT * FROM samples WHERE name = 'persist-test'`).get() as { value: string };
  assert.equal(sample.value, "4006381333931");
  const rec = fresh.prepare(`SELECT * FROM records WHERE action = 'encode' AND input = '4006381333931'`).get() as { result: string };
  const parsed = JSON.parse(rec.result);
  assert.equal(parsed.modules, EXPECTED_4006381333931);
  fresh.close();
});
