import http from "node:http";
import { ApiError } from "./errors.js";
import { Service } from "./service.js";
import { Store } from "./store.js";

const DATA_DIR = process.env.DATA_DIR ?? "data";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError("BAD_REQUEST", "请求体不是合法 JSON"); }
}

export function createServer(service: Service): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === "GET /api/version") return json(res, 200, service.version());
      if (route === "POST /api/generate") return json(res, 200, service.generate(await readBody(req)));
      if (route === "POST /api/verify") return json(res, 200, service.verify(await readBody(req)));
      if (route === "POST /api/query") return json(res, 200, service.query(await readBody(req)));
      if (route === "POST /api/expand") return json(res, 200, service.expand(await readBody(req)));
      if (route === "POST /api/explain") return json(res, 200, service.explain(await readBody(req)));
      if (route === "GET /api/sequences") return json(res, 200, service["store"].listSequences());
      if (route === "GET /api/verifications") return json(res, 200, service["store"].listVerifications());
      const m = url.pathname.match(/^\/api\/sequences\/(\d+)$/);
      if (m && req.method === "GET") {
        const row = service["store"].getSequence(Number(m[1]));
        if (!row) throw new ApiError("NOT_FOUND", `序列 ${m[1]} 不存在`);
        return json(res, 200, row);
      }
      if (route === "GET /api/export") return json(res, 200, service.exportAll());
      throw new ApiError("NOT_FOUND", `未知路由: ${route}`);
    } catch (err) {
      if (err instanceof ApiError) return json(res, 400, { error: { code: err.code, message: err.message, details: err.details } });
      console.error(err);
      return json(res, 500, { error: { code: "INTERNAL", message: String(err) } });
    }
  });
}

export function startServer(port?: number): Promise<{ port: number; close: () => void }> {
  const service = new Service(new Store(DATA_DIR));
  const server = createServer(service);
  return new Promise((resolve) => {
    // port 0 表示由系统分配空闲端口（默认行为）
    server.listen(port ?? 0, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port: p, close: () => server.close() });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const portArg = process.argv.find((a) => a.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : (process.env.PORT ? Number(process.env.PORT) : 0);
  startServer(port).then(({ port }) => console.log(`de Bruijn API 已启动: http://localhost:${port}`));
}
