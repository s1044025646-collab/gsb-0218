/**
 * EAN-13 核心编码/解码算法（自行实现，未使用任何现成条码引擎）。
 *
 * 模块串约定：
 *   1 = 黑色模块（条），0 = 白色模块（空）
 *   共 95 位，不含左右静区：
 *   起始护栏(3) + 左侧 6 位(42) + 中间护栏(5) + 右侧 6 位(42) + 结束护栏(3)
 */

export const MODULE_LENGTH = 95;
export const START_GUARD = '101';
export const CENTER_GUARD = '01010';
export const END_GUARD = '101';

/** 左侧奇校验编码（L / Number Set A）。 */
export const L_CODES: readonly string[] = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

/** 左侧偶校验编码（G / Number Set B）。 */
export const G_CODES: readonly string[] = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

/** 右侧编码（R / Number Set C，均为偶校验）。 */
export const R_CODES: readonly string[] = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

/**
 * 首位数字对应的左侧 6 位奇偶模式。
 * 'L' 表示该位使用 L_CODES（奇校验），'G' 表示使用 G_CODES（偶校验）。
 */
export const PARITY_PATTERNS: readonly string[] = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

/** 业务错误码。 */
export type EanErrorCode =
  | 'INVALID_DIGITS_LENGTH'
  | 'INVALID_DIGITS_CHAR'
  | 'INVALID_MODULES_LENGTH'
  | 'INVALID_MODULES_CHAR'
  | 'GUARD_DAMAGED'
  | 'UNKNOWN_DIGIT_PATTERN'
  | 'INVALID_PARITY_PATTERN'
  | 'CHECKSUM_MISMATCH';

export class EanError extends Error {
  readonly code: EanErrorCode;
  readonly input: string;
  constructor(code: EanErrorCode, message: string, input: string) {
    super(message);
    this.name = 'EanError';
    this.code = code;
    this.input = input;
  }
}

/** 校验一个字符串是否全部由数字组成。 */
export function isDigits(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

/**
 * 计算 EAN-13 校验位（第 13 位）。
 * 规则：从右往左（含校验位占位），奇数位乘 3，偶数位乘 1，求和后取 10 的补数。
 * 等价的“从左往右”实现：12 位数据中下标 0,2,4,... 权重为 1，下标 1,3,5,... 权重为 3。
 */
export function computeCheckDigit(data12: string): number {
  if (!isDigits(data12)) {
    throw new EanError('INVALID_DIGITS_CHAR', '输入必须全部由数字 0-9 组成', data12);
  }
  if (data12.length !== 12) {
    throw new EanError(
      'INVALID_DIGITS_LENGTH',
      `计算校验位需要恰好 12 位数字，收到 ${data12.length} 位`,
      data12,
    );
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const value = data12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? value : value * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export interface CheckResult {
  input: string;
  normalized: string;
  checkDigit: number;
  valid: boolean;
}

/**
 * 校验/补全条码数字串。
 * - 12 位：计算并追加校验位，valid 恒为 true（新算出的校验位必然自洽）。
 * - 13 位：核对第 13 位是否正确，不符时抛出 CHECKSUM_MISMATCH。
 * - 其他长度：抛出 INVALID_DIGITS_LENGTH。
 */
export function checkDigits(input: string): CheckResult {
  if (!isDigits(input)) {
    throw new EanError('INVALID_DIGITS_CHAR', '输入必须全部由数字 0-9 组成', input);
  }
  if (input.length === 12) {
    const checkDigit = computeCheckDigit(input);
    return {
      input,
      normalized: input + String(checkDigit),
      checkDigit,
      valid: true,
    };
  }
  if (input.length === 13) {
    const expected = computeCheckDigit(input.slice(0, 12));
    const actual = Number(input[12]);
    if (actual !== expected) {
      throw new EanError(
        'CHECKSUM_MISMATCH',
        `校验位不符：第 13 位为 ${actual}，应为 ${expected}`,
        input,
      );
    }
    return { input, normalized: input, checkDigit: expected, valid: true };
  }
  throw new EanError(
    'INVALID_DIGITS_LENGTH',
    `数字串长度必须为 12 或 13，收到 ${input.length} 位`,
    input,
  );
}

export interface EncodeResult {
  digits: string;
  firstDigit: string;
  parityPattern: string;
  leftDigits: string;
  rightDigits: string;
  modules: string;
}

/**
 * 将 12 或 13 位数字串编码为 95 位模块串（不含静区）。
 */
export function encode(input: string): EncodeResult {
  const { normalized } = checkDigits(input);
  const firstDigit = normalized[0];
  const parityPattern = PARITY_PATTERNS[Number(firstDigit)];
  const leftDigits = normalized.slice(1, 7);
  const rightDigits = normalized.slice(7, 13);

  const leftParts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const digit = Number(leftDigits[i]);
    leftParts.push(parityPattern[i] === 'L' ? L_CODES[digit] : G_CODES[digit]);
  }
  const rightParts: string[] = [];
  for (let i = 0; i < 6; i++) {
    rightParts.push(R_CODES[Number(rightDigits[i])]);
  }

  const modules =
    START_GUARD +
    leftParts.join('') +
    CENTER_GUARD +
    rightParts.join('') +
    END_GUARD;

  return {
    digits: normalized,
    firstDigit,
    parityPattern,
    leftDigits,
    rightDigits,
    modules,
  };
}

export interface DecodeResult {
  modules: string;
  digits: string;
  firstDigit: string;
  parityPattern: string;
  checkDigit: number;
}

/**
 * 解码 95 位模块串：
 * 1. 校验字符（仅允许 0/1）与长度；
 * 2. 校验起止、中间护栏；
 * 3. 解析右侧 6 位（R 码）与左侧 6 位（L/G 码），无法查表即拒绝；
 * 4. 由左侧 L/G 奇偶组合反查首位数字，非法组合即拒绝；
 * 5. 核对校验位。
 * 任何错误都不会通过删除模块、补零或猜测数字来“修复”。
 */
export function decode(input: string): DecodeResult {
  if (!/^[01]+$/.test(input)) {
    throw new EanError('INVALID_MODULES_CHAR', '模块串只能由 0 和 1 组成', input);
  }
  if (input.length !== MODULE_LENGTH) {
    throw new EanError(
      'INVALID_MODULES_LENGTH',
      `模块串长度必须为 ${MODULE_LENGTH} 位（不含静区），收到 ${input.length} 位`,
      input,
    );
  }

  if (input.slice(0, 3) !== START_GUARD) {
    throw new EanError('GUARD_DAMAGED', `起始护栏损坏：应为 ${START_GUARD}`, input);
  }
  if (input.slice(45, 50) !== CENTER_GUARD) {
    throw new EanError('GUARD_DAMAGED', `中间护栏损坏：应为 ${CENTER_GUARD}`, input);
  }
  if (input.slice(92, 95) !== END_GUARD) {
    throw new EanError('GUARD_DAMAGED', `结束护栏损坏：应为 ${END_GUARD}`, input);
  }

  const leftBlocks: string[] = [];
  for (let i = 0; i < 6; i++) leftBlocks.push(input.slice(3 + i * 7, 10 + i * 7));
  const rightBlocks: string[] = [];
  for (let i = 0; i < 6; i++) rightBlocks.push(input.slice(50 + i * 7, 57 + i * 7));

  let parityPattern = '';
  let leftDigits = '';
  for (const block of leftBlocks) {
    const lIndex = L_CODES.indexOf(block);
    const gIndex = G_CODES.indexOf(block);
    if (lIndex === -1 && gIndex === -1) {
      throw new EanError(
        'UNKNOWN_DIGIT_PATTERN',
        `无法识别的左侧 7 位模式：${block}`,
        input,
      );
    }
    if (lIndex !== -1 && gIndex !== -1) {
      // L 与 G 编码表互不相交，正常不会发生；保留为防御性检查。
      throw new EanError(
        'UNKNOWN_DIGIT_PATTERN',
        `左侧模式 ${block} 同时匹配 L/G，数据二义`,
        input,
      );
    }
    if (lIndex !== -1) {
      parityPattern += 'L';
      leftDigits += String(lIndex);
    } else {
      parityPattern += 'G';
      leftDigits += String(gIndex);
    }
  }

  const firstIndex = PARITY_PATTERNS.indexOf(parityPattern);
  if (firstIndex === -1) {
    throw new EanError(
      'INVALID_PARITY_PATTERN',
      `非法奇偶组合：${parityPattern}，无法恢复首位数字`,
      input,
    );
  }

  let rightDigits = '';
  for (const block of rightBlocks) {
    const rIndex = R_CODES.indexOf(block);
    if (rIndex === -1) {
      throw new EanError(
        'UNKNOWN_DIGIT_PATTERN',
        `无法识别的右侧 7 位模式：${block}`,
        input,
      );
    }
    rightDigits += String(rIndex);
  }

  const digits = String(firstIndex) + leftDigits + rightDigits;
  const expected = computeCheckDigit(digits.slice(0, 12));
  if (expected !== Number(digits[12])) {
    throw new EanError(
      'CHECKSUM_MISMATCH',
      `校验位不符：解码出第 13 位为 ${digits[12]}，应为 ${expected}`,
      input,
    );
  }

  return {
    modules: input,
    digits,
    firstDigit: String(firstIndex),
    parityPattern,
    checkDigit: expected,
  };
}

/** 将任意异常规范化为结构化错误对象。 */
export function toErrorBody(err: unknown, rawInput: string): {
  ok: false;
  error: { code: EanErrorCode | 'INTERNAL_ERROR'; message: string; input: string };
} {
  if (err instanceof EanError) {
    return { ok: false, error: { code: err.code, message: err.message, input: err.input } };
  }
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : String(err),
      input: rawInput,
    },
  };
}
