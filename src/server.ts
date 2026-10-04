// HTTP API：生成、验证、窗口查询、循环展开、构造解释、版本读取、JSON 导出。
import * as http from "node:http";
import * as net from "node:net";
import {
  ApiError, CONSTRUCTION_VERSION, LIMITS,
  generate, validateCycle, findWord, unwrap,
} from "./core";
import { Store } from "./store";

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 32 * 1024 * 1024) reject(new ApiError("E_BAD_REQUEST", "请求体过大"));
    });
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch { reject(new ApiError("E_BAD_REQUEST", "请求体必须是 JSON")); }
    });
    req.on("error", reject);
  });
}

export function createServer(store: Store) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/api/version") {
        return send(res, 200, { construction: CONSTRUCTION_VERSION, limits: LIMITS, node: process.version });
      }
      if (req.method === "POST" && path === "/api/generate") {
        const { alphabet, n } = await readBody(req);
        const r = generate(alphabet, n);
        const id = store.save("generated", alphabet, n, r.cycle, null);
        return send(res, 200, { id, cycle: r.cycle, length: r.cycle.length, totalWords: r.totalWords });
      }
      if (req.method === "POST" && path === "/api/validate") {
        const { alphabet, n, cycle } = await readBody(req);
        const report = validateCycle(alphabet, n, cycle);
        const id = store.save("imported", alphabet, n, cycle as string[], report);
        return send(res, 200, { id, report });
      }
      if (req.method === "POST" && path === "/api/query") {
        const { alphabet, n, cycle, word } = await readBody(req);
        const report = validateCycle(alphabet, n, cycle);
        const hits = findWord(cycle as string[], n, word);
        return send(res, 200, { hits, cycleComplete: report.complete });
      }
      if (req.method === "POST" && path === "/api/unwrap") {
        const { cycle, n } = await readBody(req);
        return send(res, 200, unwrap(cycle as string[], n));
      }
      if (req.method === "POST" && path === "/api/explain") {
        const { alphabet, n, limit } = await readBody(req);
        const r = generate(alphabet, n, typeof limit === "number" ? limit : LIMITS.maxExplainSteps);
        return send(res, 200, { steps: r.steps, truncated: r.truncated, cycle: r.cycle });
      }
      if (req.method === "GET" && path === "/api/runs") {
        return send(res, 200, { runs: store.list() });
      }
      const m = path.match(/^\/api\/runs\/(\d+)\/export$/);
      if (req.method === "GET" && m) {
        const run = store.get(Number(m[1]));
        if (!run) throw new ApiError("E_NOT_FOUND", `记录 ${m[1]} 不存在`);
        return send(res, 200, run);
      }
      throw new ApiError("E_NOT_FOUND", `${req.method} ${path} 不存在`);
    } catch (e: any) {
      if (e instanceof ApiError) {
        return send(res, 400, { error: { code: e.code, message: e.message, details: e.details ?? null } });
      }
      return send(res, 500, { error: { code: "E_INTERNAL", message: String(e?.message ?? e) } });
    }
  });
}

/** 默认选择空闲端口：port 为 0 或未指定时由系统分配。 */
export async function startServer(store: Store, port = 0): Promise<{ server: http.Server; port: number }> {
  const server = createServer(store);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address() as net.AddressInfo;
  return { server, port: addr.port };
}