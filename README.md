# de Bruijn 循环序列生成与窗口覆盖核验后端

纯后端项目（API + CLI），使用 TypeScript、Node.js 与 SQLite（Node 内置 `node:sqlite`，无原生依赖、无外部服务），在 Windows 本地直接运行。

## 功能

- **FKM 项链递归构造**：按有序符号的索引递归展开前缀 `a[1..t]`。候选符号 `j` 从 `a[t-p]` 开始枚举；当 `j === a[t-p]` 时周期 `p` 不变，否则周期更新为 `t`；当递归到 `t = n` 且 `p` 整除 `n` 时输出周期片段 `a[1..p]`。所有片段依序拼接即得 de Bruijn 循环。不枚举所有词、不调用现成序列库。
- **独立覆盖验证**：对任意候选循环，按每个起点取 `n` 个符号（越过末端绕回开头）统计窗口。完整性要求：长度恰为 `k^n`、符号全部合法、无重复词、无缺失词。报告首个重复及其起点、缺失词样例（截短，判定覆盖全部 `k^n` 个词）、覆盖数量与格式错误。
- **窗口查询**：返回词在循环中的全部起点及是否跨尾部绕回。
- **循环展开**：主体 + 前 `n-1` 个符号的线性展示；返回与保存的主体始终只有 `k^n` 个符号，附加尾部不计入循环长度。
- **SQLite 持久化**：保存字母表顺序、参数 `n`、构造版本、循环主体与验证摘要；生成与导入记录均可在重启后复查；构造失败在写库前抛出，不会覆盖既有成功结果。

## 约定与限制

- 符号为单个 Unicode 码点；字母表保留用户给定顺序，不按系统语言排序；序列一律用符号数组表达。
- 资源预算（`src/core.ts` 的 `LIMITS`）：`k^n ≤ 1,000,000`，`n ≤ 24`，解释条数 ≤ 2000。先用整数运算核算 `k^n` 再分配数组，超限返回 `E_BUDGET_EXCEEDED`。
- 仅做组合序列生成与覆盖验证，不做 DNA 读段组装、密码破解或真实设备输入。

## 命令

```powershell
npm install        # 安装 devDependencies（typescript / @types/node）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API（默认自动选择空闲端口）
npm run demo       # 演示：二元 n=2 / n=3、中文符号、单符号
```

CLI 子命令（`node dist/src/cli.js <命令>`）：`version`、`generate <符号串> <n>`、`validate <符号串> <n> <循环串>`、`query <符号串> <n> <循环串> <词>`、`unwrap <循环串> <n>`、`explain <符号串> <n>`、`runs`、`export <id>`、`serve [端口]`、`demo`。

## HTTP API

默认监听 `127.0.0.1`，端口为 0 时由系统分配空闲端口。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/version` | 构造版本与资源限制 |
| POST | `/api/generate` | `{alphabet, n}` → 生成循环并保存 |
| POST | `/api/validate` | `{alphabet, n, cycle}` → 独立验证并保存报告 |
| POST | `/api/query` | `{alphabet, n, cycle, word}` → 起点与是否跨尾部 |
| POST | `/api/unwrap` | `{cycle, n}` → 主体 + 附加尾部线性展示 |
| POST | `/api/explain` | `{alphabet, n, limit?}` → FKM 小步构造解释 |
| GET | `/api/runs` | 已保存记录列表 |
| GET | `/api/runs/:id/export` | JSON 导出单条记录 |

## 错误码

`E_ALPHABET_EMPTY`、`E_ALPHABET_TOO_LARGE`、`E_DUPLICATE_SYMBOL`、`E_INVALID_SYMBOL`、`E_INVALID_N`、`E_BUDGET_EXCEEDED`、`E_CYCLE_EMPTY`、`E_CYCLE_LENGTH`、`E_CYCLE_SYMBOL`、`E_WORD_LENGTH`、`E_NOT_FOUND`、`E_BAD_REQUEST`、`E_INTERNAL`。

## 数据目录

项目内 `data/debruijn.db`（自动创建）。

## 测试要点

独立穷举小参数全部词并与循环窗口作多重集合比较（不以同一生成函数自证）；覆盖删除符号、替换符号、重复周期、错误长度、尾部跨界、非法词查询；任意旋转与反转仍验证成功；相同参数重复生成字节级一致；验证报告重启后可读。