#!/usr/bin/env node
import { doChecksum, doEncode, doDecode, doBatch, doSaveSample, doGetSample, doListSamples, doListRecords, doReport } from "./service.js";
import { createServer, resolvePort } from "./server.js";

function out(x: unknown) {
  console.log(JSON.stringify(x, null, 2));
}

function fail(msg: string): never {
  console.error(`错误: ${msg}`);
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "checksum":
    if (!args[0]) fail("用法: cli checksum <12或13位数字串>");
    out(doChecksum(args[0]));
    break;
  case "encode":
    if (!args[0]) fail("用法: cli encode <12或13位数字串>");
    out(doEncode(args[0]));
    break;
  case "decode":
    if (!args[0]) fail("用法: cli decode <95位模块串>");
    out(doDecode(args[0]));
    break;
  case "batch": {
    // 用法: cli batch checksum:400638133393 encode:590123412345 decode:1010...
    if (args.length === 0) fail("用法: cli batch <action:input> [...]");
    const items = args.map((a) => {
      const i = a.indexOf(":");
      if (i < 0) fail(`批量条目格式应为 action:input，收到: ${a}`);
      return { action: a.slice(0, i), input: a.slice(i + 1) };
    });
    out(doBatch(items));
    break;
  }
  case "save": {
    // 用法: cli save <name> <digits|modules> <value>
    const [name, kind, ...rest] = args;
    if (!name || (kind !== "digits" && kind !== "modules") || rest.length === 0) {
      fail("用法: cli save <name> <digits|modules> <value>");
    }
    out({ ok: true, sample: doSaveSample(name, kind, rest.join(" ")) });
    break;
  }
  case "sample":
    if (!args[0]) fail("用法: cli sample <name>");
    out(doGetSample(args[0]) ?? { ok: false, code: "NOT_FOUND", message: "样例不存在" });
    break;
  case "samples":
    out({ ok: true, samples: doListSamples() });
    break;
  case "records":
    out({ ok: true, records: doListRecords(args[0] ? Number(args[0]) : 50) });
    break;
  case "report":
    out(doReport(args[0] ? Number(args[0]) : undefined) ?? { ok: false, code: "NOT_FOUND", message: "报告不存在" });
    break;
  case "serve": {
    const server = createServer();
    const port = resolvePort(args);
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`EAN-13 服务已启动: http://localhost:${actual}`);
    });
    break;
  }
  case "demo": {
    console.log("=== 1. 合法条码完整往返 ===");
    const digits = "4006381333931";
    const enc = doEncode(digits);
    console.log(`编码 ${digits} -> ${enc.ok ? enc.modules : "失败"}`);
    if (enc.ok) {
      const dec = doDecode(enc.modules);
      console.log(`解码 -> ${dec.ok ? dec.digits : "失败"}（往返${dec.ok && dec.digits === digits ? "一致" : "不一致"}）`);
    }
    console.log("\n=== 2. 修改一个数字（破坏校验位） ===");
    out(doChecksum("4006381333932"));
    console.log("\n=== 3. 破坏一段护栏 ===");
    if (enc.ok) {
      const broken = "111" + enc.modules.slice(3);
      out(doDecode(broken));
    }
    break;
  }
  default:
    console.log(`EAN-13 实验服务 CLI
用法:
  checksum <digits>          计算/验证校验位
  encode <digits>            编码为 95 位模块串
  decode <modules>           解码模块串
  batch <action:input> ...   批量处理
  save <name> <kind> <value> 保存命名样例 (kind: digits|modules)
  sample <name>              查询样例
  samples                    列出全部样例
  records [limit]            查询处理记录
  report [id]                导出 JSON 报告（带 id 时展示原结果）
  serve [--port N]           启动 HTTP 服务（默认自动选择空闲端口）
  demo                       演示往返与拒绝原因`);
}
