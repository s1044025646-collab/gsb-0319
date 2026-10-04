// de Bruijn 循环核心：FKM 项链递归构造、覆盖验证、窗口查询、构造解释。
// 序列一律用符号数组（string[]）表达，每个符号是单个 Unicode 码点。

export const LIMITS = {
  maxTotalWords: 1_000_000, // k^n 上限
  maxWindow: 24, // n 上限
  maxAlphabet: 65536, // k 上限
  maxExplainSteps: 2000, // 解释条数上限
} as const;

export const CONSTRUCTION_VERSION = "fkm-1";

export type ErrorCode =
  | "E_ALPHABET_EMPTY"
  | "E_ALPHABET_TOO_LARGE"
  | "E_DUPLICATE_SYMBOL"
  | "E_INVALID_SYMBOL"
  | "E_INVALID_N"
  | "E_BUDGET_EXCEEDED"
  | "E_CYCLE_LENGTH"
  | "E_CYCLE_SYMBOL"
  | "E_CYCLE_EMPTY"
  | "E_WORD_LENGTH"
  | "E_WORD_SYMBOL"
  | "E_NOT_FOUND"
  | "E_BAD_REQUEST"
  | "E_INTERNAL";

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
  }
}

/** 校验符号表：非空、元素为单个码点、无重复；保留用户给定顺序。 */
export function validateAlphabet(alphabet: unknown): string[] {
  if (!Array.isArray(alphabet) || alphabet.length === 0) {
    throw new ApiError("E_ALPHABET_EMPTY", "字母表不能为空");
  }
  if (alphabet.length > LIMITS.maxAlphabet) {
    throw new ApiError("E_ALPHABET_TOO_LARGE", `字母表大小超过上限 ${LIMITS.maxAlphabet}`);
  }
  const seen = new Set<string>();
  for (const s of alphabet) {
    if (typeof s !== "string" || [...s].length !== 1) {
      throw new ApiError("E_INVALID_SYMBOL", `符号必须是单个 Unicode 码点: ${JSON.stringify(s)}`);
    }
    if (seen.has(s)) {
      throw new ApiError("E_DUPLICATE_SYMBOL", `符号重复: ${JSON.stringify(s)}`);
    }
    seen.add(s);
  }
  return alphabet as string[];
}

export function validateN(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > LIMITS.maxWindow) {
    throw new ApiError("E_INVALID_N", `窗口长度 n 必须是 1..${LIMITS.maxWindow} 的整数`);
  }
  return n;
}

/** 整数运算计算 k^n，并在分配任何数组之前核对资源预算。 */
export function checkedTotalWords(k: number, n: number): number {
  let total = 1;
  for (let i = 0; i < n; i++) {
    total *= k;
    if (!Number.isSafeInteger(total) || total > LIMITS.maxTotalWords) {
      throw new ApiError(
        "E_BUDGET_EXCEEDED",
        `k^n = ${k}^${n} 超过资源预算上限 ${LIMITS.maxTotalWords}，拒绝分配`,
      );
    }
  }
  return total;
}

export interface ExplainStep {
  prefix: number[]; // 当前前缀（符号索引）
  candidate: number; // 候选符号索引
  period: number; // 当前周期 p
  emitted: number[] | null; // 若 p 整除 n，输出的周期片段（索引），否则 null
}

export interface GenerateResult {
  cycle: string[]; // 循环主体，长度恰为 k^n，不含线性展示追加的尾部
  totalWords: number;
  truncated: boolean; // 解释是否被截断（序列本身始终完整）
  steps: ExplainStep[];
}

/**
 * FKM（Fredricksen-Kessler-Maiorana）项链递归构造。
 * 按有序符号的索引递归展开前缀 a[1..t]：
 *   - 候选符号 j 从 a[t-p] 开始（保证生成的是项链/前缀项链），
 *   - 当 j === a[t-p] 时周期 p 不变，否则周期变为 t；
 *   - 当 t === n 且 n % p === 0 时，输出周期片段 a[1..p]。
 * 所有项链（含周期整除 n 的周期串）的周期片段按字典序拼接即得 de Bruijn 循环。
 */
export function generate(alphabet: string[], n: number, explainLimit: number = LIMITS.maxExplainSteps): GenerateResult {
  const alpha = validateAlphabet(alphabet);
  const w = validateN(n);
  const k = alpha.length;
  const total = checkedTotalWords(k, w);

  const cycleIdx: number[] = [];
  const steps: ExplainStep[] = [];
  let truncated = false;
  const a = new Array<number>(w + 1).fill(0);

  function record(prefixLen: number, candidate: number, period: number, emitted: number[] | null) {
    if (steps.length < explainLimit) {
      steps.push({ prefix: a.slice(1, prefixLen + 1), candidate, period, emitted });
    } else {
      truncated = true;
    }
  }

  function fkm(t: number, p: number) {
    if (t > w) {
      if (w % p === 0) {
        const piece = a.slice(1, p + 1);
        record(w, -1, p, piece);
        for (const idx of piece) cycleIdx.push(idx);
      }
      return;
    }
    a[t] = a[t - p];
    record(t - 1, a[t], p, null);
    fkm(t + 1, p);
    for (let j = a[t - p] + 1; j < k; j++) {
      a[t] = j;
      record(t - 1, j, t, null);
      fkm(t + 1, t);
    }
  }
  fkm(1, 1);

  if (cycleIdx.length !== total) {
    throw new ApiError("E_INTERNAL", `构造长度 ${cycleIdx.length} 与 k^n=${total} 不一致`);
  }
  return { cycle: cycleIdx.map((i) => alpha[i]), totalWords: total, truncated, steps };
}

/** 把循环展开为线性展示串：主体 + 前 n-1 个符号（仅用于展示，不计入循环长度）。 */
export function unwrap(cycle: string[], n: number): { body: string[]; display: string[]; tail: string[] } {
  const w = validateN(n);
  const tail = cycle.slice(0, Math.max(0, w - 1));
  return { body: cycle, display: cycle.concat(tail), tail };
}

export interface WordHit {
  start: number;
  wraps: boolean; // 窗口是否越过末端绕回开头
}

/** 查询一个词在循环中的所有起点；词按符号数组比较。 */
export function findWord(cycle: string[], n: number, word: string[]): WordHit[] {
  const w = validateN(n);
  if (!Array.isArray(word) || word.length !== w) {
    throw new ApiError("E_WORD_LENGTH", `查询词长度必须等于 n=${w}`);
  }
  const len = cycle.length;
  const hits: WordHit[] = [];
  for (let s = 0; s < len; s++) {
    let ok = true;
    for (let i = 0; i < w; i++) {
      if (cycle[(s + i) % len] !== word[i]) { ok = false; break; }
    }
    if (ok) hits.push({ start: s, wraps: s + w > len });
  }
  return hits;
}

export interface ValidationReport {
  valid: boolean;
  complete: boolean; // 长度正确 + 符号合法 + 无重复 + 无缺失
  length: number;
  expectedLength: number;
  alphabetValid: boolean;
  invalidSymbols: string[];
  windowCount: number; // 实际统计的循环窗口数（含跨尾部）
  distinctWords: number;
  duplicateCount: number;
  firstDuplicate: { word: string[]; start: number } | null;
  missingCount: number;
  missingSamples: string[][]; // 截短样例，判定本身覆盖全部
  errors: { code: ErrorCode; message: string }[];
}

const MISSING_SAMPLE_LIMIT = 10;

/** 独立验证：按每个循环起点取 n 个符号（绕回），统计窗口出现次数。 */
export function validateCycle(alphabet: string[], n: number, candidate: unknown): ValidationReport {
  const alpha = validateAlphabet(alphabet);
  const w = validateN(n);
  const k = alpha.length;
  const total = checkedTotalWords(k, w);
  const allowed = new Set(alpha);

  const report: ValidationReport = {
    valid: false,
    complete: false,
    length: 0,
    expectedLength: total,
    alphabetValid: true,
    invalidSymbols: [],
    windowCount: 0,
    distinctWords: 0,
    duplicateCount: 0,
    firstDuplicate: null,
    missingCount: 0,
    missingSamples: [],
    errors: [],
  };

  if (!Array.isArray(candidate) || candidate.length === 0) {
    report.errors.push({ code: "E_CYCLE_EMPTY", message: "候选循环必须是非空符号数组" });
    return report;
  }
  const cycle = candidate as string[];
  report.length = cycle.length;

  const seenBad = new Set<string>();
  for (const s of cycle) {
    if (typeof s !== "string" || [...s].length !== 1 || !allowed.has(s)) {
      const key = String(s);
      if (!seenBad.has(key)) {
        seenBad.add(key);
        report.invalidSymbols.push(key);
      }
    }
  }
  if (report.invalidSymbols.length > 0) {
    report.alphabetValid = false;
    report.errors.push({ code: "E_CYCLE_SYMBOL", message: `含非法符号: ${report.invalidSymbols.slice(0, 5).join(",")}` });
  }
  if (cycle.length !== total) {
    report.errors.push({ code: "E_CYCLE_LENGTH", message: `长度 ${cycle.length} 应为 k^n=${total}` });
  }

  // 循环窗口统计：越过末端绕回开头。
  const counts = new Map<string, { word: string[]; count: number }>();
  const len = cycle.length;
  for (let s = 0; s < len; s++) {
    const word: string[] = [];
    for (let i = 0; i < w; i++) word.push(cycle[(s + i) % len]);
    const key = word.join("");
    const e = counts.get(key);
    if (e) {
      e.count++;
      if (!report.firstDuplicate) report.firstDuplicate = { word, start: s };
    } else {
      counts.set(key, { word, count: 1 });
    }
  }
  report.windowCount = len;
  report.distinctWords = counts.size;
  for (const e of counts.values()) {
    if (e.count > 1) report.duplicateCount += e.count - 1;
  }

  // 缺失检查：穷举全部 k^n 个允许词（判定覆盖完整范围，仅样例截短）。
  const idx = new Array<number>(w).fill(0);
  for (let c = 0; c < total; c++) {
    const word: string[] = idx.map((i) => alpha[i]);
    if (!counts.has(word.join(""))) {
      report.missingCount++;
      if (report.missingSamples.length < MISSING_SAMPLE_LIMIT) report.missingSamples.push(word);
    }
    for (let p = w - 1; p >= 0; p--) {
      if (idx[p] + 1 < k) { idx[p]++; break; }
      idx[p] = 0;
    }
  }

  report.complete =
    report.length === total &&
    report.alphabetValid &&
    report.duplicateCount === 0 &&
    report.missingCount === 0;
  report.valid = report.complete;
  return report;
}