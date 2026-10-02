import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { openDb } from './db.js';
import {
  handleBatch,
  handleDigits,
  handleExportReport,
  handleGetReport,
  handleListRecords,
  handleListReports,
  handleListSamples,
  handleModules,
  handleSaveSample,
} from './service.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
}

export interface StartedServer {
  server: Server;
  port: number;
  dbPath: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export function startServer(options: ServerOptions = {}): Promise<StartedServer> {
  const dataDir = options.dataDir ?? join(process.cwd(), 'data');
  const dbPath = join(dataDir, 'ean13.db');
  const db = openDb(dbPath);
  const host = options.host ?? '127.0.0.1';

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';

      try {
        if (req.method === 'GET' && path === '/health') {
          return sendJson(res, 200, { ok: true, service: 'ean13-lab', db: dbPath });
        }

        if (req.method !== 'POST') {
          return sendJson(res, 405, {
            ok: false,
            error: { code: 'METHOD_NOT_ALLOWED', message: `不支持 ${req.method} ${path}`, input: '' },
          });
        }

        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          return sendJson(res, 400, {
            ok: false,
            error: { code: 'INVALID_JSON', message: '请求体必须是合法 JSON', input: '' },
          });
        }
        const data = (body ?? {}) as Record<string, unknown>;

        switch (path) {
          case '/api/check':
            return sendJson(res, 200, handleDigits(db, data.input, 'check'));
          case '/api/encode':
            return sendJson(res, 200, handleDigits(db, data.input, 'encode'));
          case '/api/decode':
            return sendJson(res, 200, handleModules(db, data.input));
          case '/api/batch':
            return sendJson(res, 200, handleBatch(db, data.items));
          case '/api/samples':
            if (data.action === 'list') return sendJson(res, 200, handleListSamples(db));
            return sendJson(res, 200, handleSaveSample(db, data.name, data.kind, data.payload, data.note));
          case '/api/records': {
            const limit = Math.min(1000, Math.max(1, Number(data.limit ?? 100)));
            return sendJson(res, 200, handleListRecords(db, Number.isFinite(limit) ? limit : 100));
          }
          case '/api/reports': {
            if (data.action === 'list') return sendJson(res, 200, handleListReports(db));
            if (data.action === 'get') {
              return sendJson(res, 200, handleGetReport(db, data.id, data.name));
            }
            if (data.action === 'export') {
              const report =
                typeof data.report === 'object' ? data.report : { generatedAt: new Date().toISOString() };
              const name = typeof data.name === 'string' ? data.name : undefined;
              return sendJson(res, 200, handleExportReport(db, String(data.kind ?? 'custom'), report, name));
            }
            return sendJson(res, 400, {
              ok: false,
              error: { code: 'INVALID_ACTION', message: "reports 需要 action: list|get|export", input: '' },
            });
          }
          default:
            return sendJson(res, 404, {
              ok: false,
              error: { code: 'NOT_FOUND', message: `未知路径 ${path}`, input: '' },
            });
        }
      } catch (err) {
        return sendJson(res, 500, {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : String(err),
            input: '',
          },
        });
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const listenPort = options.port ?? 0;
    server.listen(listenPort, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : Number(options.port ?? 0);
      resolve({ server, port, dbPath });
    });
  });
}

const invokedDirectly =
  process.argv[1] && /server\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  const requestedPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  startServer({
    port: requestedPort && Number.isInteger(requestedPort) ? requestedPort : undefined,
    host: process.env.HOST,
    dataDir: process.env.DATA_DIR,
  })
    .then(({ port }) => {
      console.log(`EAN-13 实验服务已启动: http://127.0.0.1:${port}`);
      console.log('默认选择空闲端口；可用环境变量 PORT 指定端口。');
    })
    .catch((err: unknown) => {
      console.error('启动失败:', err);
      process.exit(1);
    });
}
