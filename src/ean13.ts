// EAN-13 核心编码/校验逻辑（自行实现，不依赖现成条码引擎）

export const EAN13_MODULE_LENGTH = 95;

// 左侧数字编码：L（奇）与 G（偶）
const L_CODES = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const G_CODES = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
// 右侧 R 编码 = L 编码取反
const R_CODES = L_CODES.map((c) => c.split("").map((b) => (b === "0" ? "1" : "0")).join(""));

// 首位数字 -> 左侧 6 位的奇偶模式（L=奇, G=偶）
const PARITY_PATTERNS = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

const GUARD_START = "101";
const GUARD_MIDDLE = "01010";
const GUARD_END = "101";

export type ErrorCode =
  | "INVALID_DIGIT_LENGTH"
  | "INVALID_DIGIT_CHARS"
  | "INVALID_MODULE_LENGTH"
  | "INVALID_MODULE_CHARS"
  | "GUARD_DAMAGED"
  | "UNKNOWN_DIGIT_PATTERN"
  | "ILLEGAL_PARITY"
  | "CHECKSUM_MISMATCH";

export interface EanError {
  ok: false;
  code: ErrorCode;
  message: string;
  input: string;
}

export interface ChecksumOk {
  ok: true;
  digits: string;
  checkDigit: string;
  full: string;
}

export interface EncodeOk {
  ok: true;
  digits: string;
  modules: string;
}

export interface DecodeOk {
  ok: true;
  digits: string;
  checkDigit: string;
  parityPattern: string;
}

function err(code: ErrorCode, message: string, input: string): EanError {
  return { ok: false, code, message, input };
}

export function isValidDigitString(s: string, len: number): boolean {
  return typeof s === "string" && s.length === len && /^[0-9]+$/.test(s);
}

/** 计算 EAN-13 校验位（输入 12 位或 13 位数字串） */
export function computeCheckDigit(digits12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = digits12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

/** 校验：12 位 -> 计算第 13 位；13 位 -> 验证校验位 */
export function validateDigits(input: string): ChecksumOk | EanError {
  if (typeof input !== "string" || !/^[0-9]+$/.test(input)) {
    return err("INVALID_DIGIT_CHARS", "数字串只能包含 0-9 字符", String(input));
  }
  if (input.length !== 12 && input.length !== 13) {
    return err("INVALID_DIGIT_LENGTH", `数字串长度必须为 12 或 13，实际为 ${input.length}`, input);
  }
  const check = computeCheckDigit(input.slice(0, 12));
  if (input.length === 13 && input[12] !== check) {
    return err("CHECKSUM_MISMATCH", `校验位不符：期望 ${check}，实际 ${input[12]}`, input);
  }
  return { ok: true, digits: input.slice(0, 12), checkDigit: check, full: input.slice(0, 12) + check };
}

/** 编码：12/13 位数字串 -> 95 位模块串（不含静区） */
export function encode(input: string): EncodeOk | EanError {
  const v = validateDigits(input);
  if (!v.ok) return v;
  const digits = v.full;
  const first = digits.charCodeAt(0) - 48;
  const parity = PARITY_PATTERNS[first];
  let out = GUARD_START;
  for (let i = 0; i < 6; i++) {
    const d = digits.charCodeAt(1 + i) - 48;
    out += parity[i] === "L" ? L_CODES[d] : G_CODES[d];
  }
  out += GUARD_MIDDLE;
  for (let i = 0; i < 6; i++) {
    const d = digits.charCodeAt(7 + i) - 48;
    out += R_CODES[d];
  }
  out += GUARD_END;
  return { ok: true, digits, modules: out };
}

/** 解码：95 位模块串 -> 13 位数字串 */
export function decode(modules: string): DecodeOk | EanError {
  if (typeof modules !== "string" || !/^[01]+$/.test(modules)) {
    return err("INVALID_MODULE_CHARS", "模块串只能包含 0 和 1", String(modules));
  }
  if (modules.length !== EAN13_MODULE_LENGTH) {
    return err("INVALID_MODULE_LENGTH", `模块串长度必须为 ${EAN13_MODULE_LENGTH}，实际为 ${modules.length}`, modules);
  }
  if (
    modules.slice(0, 3) !== GUARD_START ||
    modules.slice(45, 50) !== GUARD_MIDDLE ||
    modules.slice(92, 95) !== GUARD_END
  ) {
    return err("GUARD_DAMAGED", "起始/中间/结束护栏损坏", modules);
  }

  // 左侧 6 位：先按 L 识别，失败再按 G 识别
  const leftDigits: number[] = [];
  let parity = "";
  for (let i = 0; i < 6; i++) {
    const seg = modules.slice(3 + i * 7, 10 + i * 7);
    const li = L_CODES.indexOf(seg);
    const gi = G_CODES.indexOf(seg);
    if (li >= 0 && gi < 0) {
      leftDigits.push(li);
      parity += "L";
    } else if (gi >= 0 && li < 0) {
      leftDigits.push(gi);
      parity += "G";
    } else {
      return err("UNKNOWN_DIGIT_PATTERN", `左侧第 ${i + 1} 个数字模块无法识别`, modules);
    }
  }
  const first = PARITY_PATTERNS.indexOf(parity);
  if (first < 0) {
    return err("ILLEGAL_PARITY", `左侧奇偶组合 ${parity} 非法`, modules);
  }

  const rightDigits: number[] = [];
  for (let i = 0; i < 6; i++) {
    const seg = modules.slice(50 + i * 7, 57 + i * 7);
    const ri = R_CODES.indexOf(seg);
    if (ri < 0) {
      return err("UNKNOWN_DIGIT_PATTERN", `右侧第 ${i + 1} 个数字模块无法识别`, modules);
    }
    rightDigits.push(ri);
  }

  const digits = String(first) + leftDigits.join("") + rightDigits.join("");
  const check = computeCheckDigit(digits.slice(0, 12));
  if (digits[12] !== check) {
    return err("CHECKSUM_MISMATCH", `校验位不符：期望 ${check}，实际 ${digits[12]}`, modules);
  }
  return { ok: true, digits, checkDigit: check, parityPattern: parity };
}
