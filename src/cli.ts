import { Service } from "./service.js";
import { Store } from "./store.js";
import { startServer } from "./server.js";

const DATA_DIR = process.env.DATA_DIR ?? "data";

function parseSymbols(value: string | undefined, name: string): string[] {
  if (!value) throw new Error(`缺少参数 --${name}`);
  if (value.startsWith("[")) return JSON.parse(value);
  return Array.from(value);
}

function parseArgs(argv: string[]): { cmd: string; opts: Record<string, string> } {
  const [cmd = "help", ...rest] = argv;
  const opts: Record<string, string> = {};
  for (const a of rest) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) opts[m[1]] = m[2] ?? "true";
  }
  return { cmd, opts };
}

function windowsTable(cycle: string[], n: number): string {
  const len = cycle.length;
  const lines: string[] = [];
  for (let s = 0; s < len; s++) {
    const w: string[] = [];
    for (let j = 0; j < n; j++) w.push(cycle[(s + j) % len]);
    const wrap = s + n > len ? " (跨尾部)" : "";
    lines.push(`  起点 ${String(s).padStart(4)}: ${w.join("")}${wrap}`);
  }
  return lines.join("\n");
}

function showCycle(cycle: string[], n: number): void {
  console.log(`循环主体 (长度 ${cycle.length}): ${cycle.join("")}`);
  const tail = cycle.slice(0, Math.max(0, n - 1));
  console.log(`线性展示 (主体 + 附加尾部 ${tail.length} 符号): ${cycle.join("")}|${tail.join("")}`);
  console.log("逐起点窗口:");
  console.log(windowsTable(cycle, n));
}

async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  const service = new Service(new Store(DATA_DIR));

  switch (cmd) {
    case "version":
      console.log(JSON.stringify(service.version(), null, 2));
      break;
    case "generate": {
      const alphabet = parseSymbols(opts.alphabet, "alphabet");
      const n = Number(opts.n);
      const r = service.generate({ alphabet, n });
      console.log(`sequenceId=${r.sequenceId} k=${r.k} n=${r.n} 版本=${r.constructionVersion} ${r.reused ? "(复用已有结果)" : "(新生成)"}`);
      showCycle(r.cycle, r.n);
      break;
    }
    case "verify": {
      const alphabet = parseSymbols(opts.alphabet, "alphabet");
      const cycle = parseSymbols(opts.cycle, "cycle");
      const n = Number(opts.n);
      const r = service.verify({ alphabet, n, cycle });
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case "query": {
      const alphabet = parseSymbols(opts.alphabet, "alphabet");
      const cycle = parseSymbols(opts.cycle, "cycle");
      const word = parseSymbols(opts.word, "word");
      const n = Number(opts.n);
      console.log(JSON.stringify(service.query({ alphabet, n, cycle, word }), null, 2));
      break;
    }
    case "expand": {
      const alphabet = parseSymbols(opts.alphabet, "alphabet");
      const cycle = parseSymbols(opts.cycle, "cycle");
      const n = Number(opts.n);
      console.log(JSON.stringify(service.expand({ alphabet, n, cycle }), null, 2));
      break;
    }
    case "explain": {
      const alphabet = parseSymbols(opts.alphabet, "alphabet");
      const n = Number(opts.n);
      const maxSteps = opts["max-steps"] ? Number(opts["max-steps"]) : undefined;
      console.log(JSON.stringify(service.explain({ alphabet, n, maxSteps }), null, 2));
      break;
    }
    case "list":
      console.log(JSON.stringify(service["store"].listSequences(), null, 2));
      break;
    case "export":
      console.log(JSON.stringify(service.exportAll(), null, 2));
      break;
    case "serve": {
      const port = opts.port ? Number(opts.port) : 0;
      const { port: p } = await startServer(port);
      console.log(`de Bruijn API 已启动: http://localhost:${p}`);
      return;
    }
    case "demo": {
      console.log("=== 演示 1: 二元字母表 {0,1}, n=2 (4 种窗口) ===");
      const r1 = service.generate({ alphabet: ["0", "1"], n: 2 });
      showCycle(r1.cycle, 2);
      console.log("\n=== 演示 2: 二元字母表 {0,1}, n=3 (8 种窗口) ===");
      const r2 = service.generate({ alphabet: ["0", "1"], n: 3 });
      showCycle(r2.cycle, 3);
      console.log("\n=== 演示 3: 中文符号 {天,地,人}, n=2 ===");
      const r3 = service.generate({ alphabet: ["天", "地", "人"], n: 2 });
      showCycle(r3.cycle, 2);
      console.log("\n=== 演示 4: 单符号字母表 {甲}, n=3 (绕回形成重复词) ===");
      const r4 = service.generate({ alphabet: ["甲"], n: 3 });
      showCycle(r4.cycle, 3);
      console.log("\n=== 验证报告 (演示 2 的循环) ===");
      const v = service.verify({ alphabet: ["0", "1"], n: 3, cycle: r2.cycle });
      console.log(JSON.stringify(v, null, 2));
      break;
    }
    default:
      console.log(`用法: node dist/src/cli.js <命令> [选项]
命令:
  generate --alphabet=01 --n=3        生成 de Bruijn 循环
  verify   --alphabet=01 --n=3 --cycle=0011   验证候选循环
  query    --alphabet=01 --n=2 --cycle=0011 --word=10   查询词起点
  expand   --alphabet=01 --n=2 --cycle=0011   循环展开为线性展示
  explain  --alphabet=01 --n=2 [--max-steps=50]   FKM 构造步骤解释
  demo                                  运行全部演示
  list / export / version / serve [--port=8080]
说明: --alphabet=01 按码点拆分；也可用 JSON 数组，如 --alphabet='["天","地"]'`);
  }
}

main().catch((e) => { console.error(`错误 [${e.code ?? "INTERNAL"}]: ${e.message}`); process.exit(1); });
