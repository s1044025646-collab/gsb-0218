import http from "node:http";
import { doChecksum, doEncode, doDecode, doBatch, doSaveSample, doGetSample, doListSamples, doGetRecord, doListRecords, doReport } from "./service.js";

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    try {
      if (req.method === "POST") {
        const body = (await readBody(req)) as Record<string, unknown> | null;
        if (body === null) return json(res, 400, { ok: false, code: "BAD_JSON", message: "请求体不是合法 JSON" });

        if (p === "/api/checksum") {
          if (typeof body.digits !== "string") return json(res, 400, { ok: false, code: "MISSING_FIELD", message: "缺少 digits 字段" });
          const r = doChecksum(body.digits);
          return json(res, r.ok ? 200 : 422, r);
        }
        if (p === "/api/encode") {
          if (typeof body.digits !== "string") return json(res, 400, { ok: false, code: "MISSING_FIELD", message: "缺少 digits 字段" });
          const r = doEncode(body.digits);
          return json(res, r.ok ? 200 : 422, r);
        }
        if (p === "/api/decode") {
          if (typeof body.modules !== "string") return json(res, 400, { ok: false, code: "MISSING_FIELD", message: "缺少 modules 字段" });
          const r = doDecode(body.modules);
          return json(res, r.ok ? 200 : 422, r);
        }
        if (p === "/api/batch") {
          if (!Array.isArray(body.items)) return json(res, 400, { ok: false, code: "MISSING_FIELD", message: "缺少 items 数组" });
          return json(res, 200, doBatch(body.items as Array<{ action: string; input: string }>));
        }
        if (p === "/api/samples") {
          const { name, kind, value } = body as { name?: string; kind?: string; value?: string };
          if (!name || (kind !== "digits" && kind !== "modules") || typeof value !== "string") {
            return json(res, 400, { ok: false, code: "MISSING_FIELD", message: "需要 name、kind(digits|modules)、value" });
          }
          return json(res, 200, { ok: true, sample: doSaveSample(name, kind, value) });
        }
        return json(res, 404, { ok: false, code: "NOT_FOUND", message: "未知接口" });
      }

      if (req.method === "GET") {
        if (p === "/api/samples") return json(res, 200, { ok: true, samples: doListSamples() });
        let m = p.match(/^\/api\/samples\/(.+)$/);
        if (m) {
          const s = doGetSample(decodeURIComponent(m[1]));
          return s ? json(res, 200, { ok: true, sample: s }) : json(res, 404, { ok: false, code: "NOT_FOUND", message: "样例不存在" });
        }
        m = p.match(/^\/api\/records\/(\d+)$/);
        if (m) {
          const r = doGetRecord(Number(m[1]));
          return r ? json(res, 200, { ok: true, record: r }) : json(res, 404, { ok: false, code: "NOT_FOUND", message: "记录不存在" });
        }
        if (p === "/api/records") {
          const limit = Number(url.searchParams.get("limit") ?? 50);
          return json(res, 200, { ok: true, records: doListRecords(limit) });
        }
        if (p === "/api/report") {
          const idParam = url.searchParams.get("id");
          const report = doReport(idParam ? Number(idParam) : undefined);
          return report ? json(res, 200, { ok: true, ...report }) : json(res, 404, { ok: false, code: "NOT_FOUND", message: "报告不存在" });
        }
        return json(res, 404, { ok: false, code: "NOT_FOUND", message: "未知接口" });
      }

      json(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "仅支持 GET/POST" });
    } catch (e) {
      json(res, 500, { ok: false, code: "INTERNAL", message: String(e) });
    }
  });
}

// 端口：--port 或 PORT 环境变量；默认 0（自动选择空闲端口）
export function resolvePort(argv: string[] = process.argv.slice(2)): number {
  const i = argv.indexOf("--port");
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const server = createServer();
  const port = resolvePort();
  server.listen(port, () => {
    const addr = server.address();
    const actual = typeof addr === "object" && addr ? addr.port : port;
    console.log(`EAN-13 服务已启动: http://localhost:${actual}`);
  });
}
