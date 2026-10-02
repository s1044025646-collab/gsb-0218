// API 与 CLI 共用的业务逻辑
import { validateDigits, encode, decode } from "./ean13.js";
import { saveRecord, saveSample, getSample, listSamples, getRecord, listRecords } from "./db.js";

export function doChecksum(input: string, persist = true) {
  const result = validateDigits(input);
  if (persist) saveRecord("checksum", input, result.ok, result);
  return result;
}

export function doEncode(input: string, persist = true) {
  const result = encode(input);
  if (persist) saveRecord("encode", input, result.ok, result);
  return result;
}

export function doDecode(modules: string, persist = true) {
  const result = decode(modules);
  if (persist) saveRecord("decode", modules, result.ok, result);
  return result;
}

export function doBatch(items: Array<{ action: string; input: string }>) {
  // 按原顺序逐条处理，单条失败不影响其他条目
  const results = items.map((item, index) => {
    let result;
    if (item.action === "checksum") result = doChecksum(item.input);
    else if (item.action === "encode") result = doEncode(item.input);
    else if (item.action === "decode") result = doDecode(item.input);
    else result = { ok: false, code: "UNKNOWN_ACTION", message: `未知操作: ${item.action}`, input: item.input };
    return { index, action: item.action, result };
  });
  return { total: results.length, okCount: results.filter((r) => r.result.ok).length, results };
}

export function doSaveSample(name: string, kind: "digits" | "modules", value: string) {
  return saveSample(name, kind, value);
}

export function doGetSample(name: string) {
  return getSample(name);
}

export function doListSamples() {
  return listSamples();
}

export function doGetRecord(id: number) {
  return getRecord(id);
}

export function doListRecords(limit = 50) {
  return listRecords(limit);
}

/** 导出 JSON 报告：重复打开已保存报告时展示原结果 */
export function doReport(id?: number) {
  if (id !== undefined) {
    const rec = getRecord(id);
    if (!rec) return null;
    return { report: rec, result: JSON.parse((rec as { result: string }).result) };
  }
  return { records: listRecords(1000) };
}
