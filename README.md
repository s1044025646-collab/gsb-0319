# de Bruijn 循环序列生成与窗口覆盖核验后端

纯后端项目（API + CLI），使用 TypeScript、Node.js 与 SQLite（Node 内置 `node:sqlite`，无原生依赖、无外部服务），在 Windows 本地直接运行。

给定**有序且不重复**的符号表（每个符号为单个 Unicode 码点，保留用户给定顺序）与窗口长度 `n`，生成一个 de Bruijn 循环：每个长度为 `n` 的可能词在循环中恰好出现一次。循环长度为 `k^n`（`k` 为字母表大小），返回的主体只保存这一个周期；线性展示时附加的前 `n-1` 个符号**不计入**循环长度。

## 环境要求

- Node.js >= 22.5（使用内置 `node:sqlite`，开发版本为 Node 25）
- 仅开发依赖 TypeScript；不需要 Docker / WSL / 任何在线服务

## 快速开始

```powershell
npm install        # 安装 typescript 与 @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API（默认自动选择空闲端口）
npm run demo       # 运行演示：二元 n=2 / n=3、中文符号、单符号
```

## 核心构造：FKM 项链递归

`src/debruijn.ts` 自行实现 Fredricksen–Kessler–Maiorana 算法，不枚举所有词再拼接，也不调用现成序列库：

- `a[1..n]` 为当前前缀（存符号**索引**，避免多字节字符与字节长度混淆）；
- 位置 `t` 先继承 `a[t-p]`（`p` 为当前周期），再依次尝试更大的候选符号 `j`，此时周期更新为 `t`；
- 递归到 `t > n` 时，若周期 `p` 整除 `n`，输出一个周期片段 `a[1..p]`；
- 全部片段按字典序拼接即得长度恰为 `k^n` 的循环。

`explain` 接口按小步返回当前前缀、候选符号、周期与输出片段（条数可限，默认 50，上限 500）。

## 资源预算与参数校验

先用整数运算计算 `k^n` 并核对预算，**再**分配数组：

| 限制 | 值 |
|---|---|
| 总词数 `k^n` | ≤ 1,000,000 |
| 窗口长度 `n` | 1–64（正整数） |
| 字母表大小 | 1–256，非空、无重复、每符号单码点 |
| 解释条数 | ≤ 500 |

错误码：`EMPTY_ALPHABET`、`DUPLICATE_SYMBOL`、`INVALID_SYMBOL`、`INVALID_N`、`LIMIT_EXCEEDED`、`INVALID_CYCLE_LENGTH`、`UNKNOWN_SYMBOL`、`WORD_LENGTH_MISMATCH`、`NOT_FOUND`、`BAD_REQUEST`。

## HTTP API

`npm start`（或 `node dist/src/server.js --port=8080`，`PORT` 环境变量亦可；默认端口 0 = 系统自动分配空闲端口，启动时打印实际端口）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/version` | 构造版本与资源上限 |
| POST | `/api/generate` | `{alphabet, n}` 生成循环（相同参数复用已有结果，幂等） |
| POST | `/api/verify` | `{alphabet, n, cycle}` 独立核验候选循环 |
| POST | `/api/query` | `{alphabet, n, cycle, word}` 查询词起点与是否跨尾部 |
| POST | `/api/expand` | 循环展开：主体 + 附加尾部的线性展示 |
| POST | `/api/explain` | `{alphabet, n, maxSteps?}` FKM 构造步骤 |
| GET | `/api/sequences`、`/api/sequences/:id` | 查询已存序列 |
| GET | `/api/verifications` | 查询验证报告 |
| GET | `/api/export` | 导出全部数据为 JSON |

### 验证语义

验证独立于生成函数：按每个循环起点取 `n` 个符号（越过末端绕回开头）统计窗口出现次数，并与按索引计数法**独立穷举**的全部 `k^n` 个词作多重集合比较。完整性同时要求：长度正确、符号合法、无重复词、无缺失词。报告包含首个重复及其起点、缺失词样例（截短展示，判定覆盖完整范围）、覆盖数量与格式错误。任意旋转、反转后的合法循环仍验证成功。

## CLI

```powershell
node dist/src/cli.js generate --alphabet=01 --n=3
node dist/src/cli.js verify   --alphabet=01 --n=2 --cycle=0011
node dist/src/cli.js query    --alphabet=01 --n=2 --cycle=0011 --word=10
node dist/src/cli.js expand   --alphabet=01 --n=2 --cycle=0011
node dist/src/cli.js explain  --alphabet=01 --n=2 --max-steps=20
node dist/src/cli.js demo          # 循环主体 + 逐起点窗口表，区分主体与附加尾部
node dist/src/cli.js list          # 已存序列
node dist/src/cli.js export        # JSON 导出
node dist/src/cli.js version
node dist/src/cli.js serve --port=8080
```

符号参数按码点拆分（`--alphabet=01`），也可用 JSON 数组：`--alphabet='["天","地"]'`。

## 持久化

数据保存在项目内 `data/debruijn.sqlite`（可用 `DATA_DIR` 环境变量更改），包含字母表顺序、参数 `n/k`、构造版本、循环主体与验证摘要。相同参数重复生成直接复用首次成功结果（字节级一致）；构造失败抛错，不会覆盖此前成功结果；导入候选的验证报告重启后可复查。

## 测试

`npm test` 运行 16 项测试：二元 `n=2`/`n=3` 与独立穷举的多重集合比较、中文符号、单符号绕回、重复生成字节级一致、任意旋转与反转仍合法、删除/替换符号、重复周期、错误长度、跨尾部窗口、非法词查询、参数校验、资源预算、SQLite 重启可读。

## 假设与限制

- 只做组合序列生成与覆盖验证，不做 DNA 读段组装、密码破解或真实设备输入。
- 单符号字母表合法：循环仅一个符号，窗口通过绕回形成重复词。
- `node:sqlite` 在 Node 25 仍标记为 experimental（启动时有一条警告），功能稳定可用；如需消除警告可换 `better-sqlite3`。
- 不提供图形界面、通用图编辑器与递归栈中途保存续算。
