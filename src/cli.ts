// CLI：generate / validate / query / unwrap / explain / version / export / serve / demo
import { generate, validateCycle, findWord, unwrap, CONSTRUCTION_VERSION, LIMITS } from "./core";
import { Store } from "./store";
import { startServer } from "./server";

function parseSymbols(s: string): string[] {
  return [...s]; // 按码点切分，避免多字节字符与字节长度混淆
}

function show(x: unknown) {
  console.log(JSON.stringify(x, null, 2));
}

function windowTable(cycle: string[], n: number) {
  const len = cycle.length;
  const lines: string[] = [];
  for (let s = 0; s < len; s++) {
    const w: string[] = [];
    for (let i = 0; i < n; i++) w.push(cycle[(s + i) % len]);
    lines.push(`  起点 ${String(s).padStart(3)}: ${w.join(" ")}${s + n > len ? "  (跨尾部绕回)" : ""}`);
  }
  return lines.join("\n");
}

function demoCase(alphabet: string[], n: number, label: string) {
  const { cycle } = generate(alphabet, n);
  const { display, tail } = unwrap(cycle, n);
  const report = validateCycle(alphabet, n, cycle);
  console.log(`\n=== ${label} ===`);
  console.log(`字母表(保序): [${alphabet.join(", ")}]  n=${n}  k^n=${alphabet.length ** n}`);
  console.log(`循环主体 (${cycle.length} 个符号): ${cycle.join("")}`);
  console.log(`线性展示 (主体 + 附加尾部 ${tail.length} 个符号，仅用于展示): ${display.join("")}`);
  console.log(`逐起点窗口表:`);
  console.log(windowTable(cycle, n));
  console.log(`覆盖核验: complete=${report.complete} 窗口数=${report.windowCount} 不同词=${report.distinctWords} 重复=${report.duplicateCount} 缺失=${report.missingCount}`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store();
  try {
    switch (cmd) {
      case "version":
        show({ construction: CONSTRUCTION_VERSION, limits: LIMITS });
        break;
      case "generate": {
        // 用法: generate <符号串> <n>
        const alphabet = parseSymbols(args[0] ?? "");
        const n = Number(args[1]);
        const r = generate(alphabet, n);
        const id = store.save("generated", alphabet, n, r.cycle, null);
        show({ id, cycle: r.cycle, length: r.cycle.length, totalWords: r.totalWords });
        break;
      }
      case "validate": {
        // 用法: validate <符号串> <n> <候选循环串>
        const alphabet = parseSymbols(args[0] ?? "");
        const n = Number(args[1]);
        const cycle = parseSymbols(args[2] ?? "");
        const report = validateCycle(alphabet, n, cycle);
        const id = store.save("imported", alphabet, n, cycle, report);
        show({ id, report });
        break;
      }
      case "query": {
        // 用法: query <符号串> <n> <循环串> <查询词>
        const alphabet = parseSymbols(args[0] ?? "");
        const n = Number(args[1]);
        const cycle = parseSymbols(args[2] ?? "");
        const word = parseSymbols(args[3] ?? "");
        validateCycle(alphabet, n, cycle);
        show({ hits: findWord(cycle, n, word) });
        break;
      }
      case "unwrap": {
        const cycle = parseSymbols(args[0] ?? "");
        const n = Number(args[1]);
        show(unwrap(cycle, n));
        break;
      }
      case "explain": {
        const alphabet = parseSymbols(args[0] ?? "");
        const n = Number(args[1]);
        const r = generate(alphabet, n);
        show({ steps: r.steps, truncated: r.truncated, cycle: r.cycle });
        break;
      }
      case "export": {
        const id = Number(args[0]);
        const run = store.get(id);
        if (!run) throw new Error(`记录 ${id} 不存在`);
        show(run);
        break;
      }
      case "runs":
        show({ runs: store.list() });
        break;
      case "serve": {
        const port = args[0] ? Number(args[0]) : 0; // 默认空闲端口
        const { port: p } = await startServer(store, port);
        console.log(`API 服务已启动: http://127.0.0.1:${p}/api/version`);
        return; // 保持进程
      }
      case "demo": {
        demoCase(["0", "1"], 2, "二元字母表 n=2（四种窗口）");
        demoCase(["0", "1"], 3, "二元字母表 n=3（八种窗口）");
        demoCase(["春", "夏", "秋"], 2, "中文符号 n=2");
        demoCase(["甲"], 3, "单符号字母表 n=3（绕回形成重复词）");
        break;
      }
      default:
        console.log(`用法: node dist/src/cli.js <命令>
  version                          读取构造版本与限制
  generate <符号串> <n>            生成 de Bruijn 循环并保存
  validate <符号串> <n> <循环串>   独立验证候选循环并保存报告
  query <符号串> <n> <循环串> <词> 查询词在循环中的起点与是否跨尾部
  unwrap <循环串> <n>              展开为主体+附加尾部的线性展示
  explain <符号串> <n>             输出 FKM 小步构造解释
  runs                             列出已保存记录
  export <id>                      JSON 导出一条记录
  serve [端口]                     启动 API（默认自动选空闲端口）
  demo                             演示：二元 n=2/n=3、中文符号、单符号`);
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

main().catch((e) => {
  const code = e?.code ?? "E_INTERNAL";
  console.error(`错误 [${code}]: ${e.message}`);
  process.exit(1);
});