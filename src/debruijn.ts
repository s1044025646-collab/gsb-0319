import { ApiError } from "./errors.js";

export const CONSTRUCTION_VERSION = "fkm-1.0.0";

export const LIMITS = {
  MAX_TOTAL_WORDS: 1_000_000,
  MAX_N: 64,
  MAX_ALPHABET: 256,
  MAX_EXPLAIN_STEPS: 500,
} as const;

export interface Alphabet {
  symbols: string[];
  index: Map<string, number>;
}

export function validateAlphabet(input: unknown): Alphabet {
  if (!Array.isArray(input)) throw new ApiError("BAD_REQUEST", "alphabet 必须是字符串数组");
  if (input.length === 0) throw new ApiError("EMPTY_ALPHABET", "字母表不能为空");
  if (input.length > LIMITS.MAX_ALPHABET)
    throw new ApiError("LIMIT_EXCEEDED", `字母表大小超过上限 ${LIMITS.MAX_ALPHABET}`);
  const index = new Map<string, number>();
  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    if (typeof s !== "string" || Array.from(s).length !== 1)
      throw new ApiError("INVALID_SYMBOL", `符号必须是单个 Unicode 码点，收到: ${JSON.stringify(s)}`);
    if (index.has(s))
      throw new ApiError("DUPLICATE_SYMBOL", `字母表包含重复符号: ${JSON.stringify(s)}`);
    index.set(s, i);
  }
  return { symbols: input.slice(), index };
}

export function validateN(input: unknown): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1)
    throw new ApiError("INVALID_N", "n 必须是正整数");
  if (input > LIMITS.MAX_N) throw new ApiError("LIMIT_EXCEEDED", `n 超过上限 ${LIMITS.MAX_N}`);
  return input;
}

/** 整数幂，带上限早退，避免先分配再失败 */
export function checkedTotalWords(k: number, n: number): number {
  let total = 1;
  for (let i = 0; i < n; i++) {
    total *= k;
    if (total > LIMITS.MAX_TOTAL_WORDS)
      throw new ApiError("LIMIT_EXCEEDED", `k^n = ${k}^${n} 超过总词数上限 ${LIMITS.MAX_TOTAL_WORDS}`);
  }
  return total;
}

export interface ExplainStep {
  t: number;
  prefix: number[];
  candidate: number;
  period: number;
  action: "recurse" | "emit";
  emitted?: number[];
}

export interface FkmResult {
  cycleIndices: number[];
  steps: ExplainStep[];
  truncated: boolean;
}

/**
 * FKM (Fredricksen-Kessler-Maiorana) 项链递归构造。
 * a[1..n] 为当前前缀（符号索引），t 为待填位置，p 为当前周期。
 * 位置 t 先继承 a[t-p]（保持周期 p），再依次尝试更大的候选符号 j，
 * 此时周期更新为 t。递归到 t>n 时，若 p 整除 n，输出一个周期 a[1..p]。
 */
export function fkm(k: number, n: number, maxSteps = 0): FkmResult {
  const total = checkedTotalWords(k, n);
  const a = new Array<number>(n + 1).fill(0);
  const out: number[] = [];
  const steps: ExplainStep[] = [];
  let truncated = false;

  function record(step: ExplainStep): void {
    if (maxSteps > 0) {
      if (steps.length >= maxSteps) { truncated = true; return; }
      steps.push(step);
    }
  }

  function neck(t: number, p: number): void {
    if (t > n) {
      if (n % p === 0) {
        const emitted = a.slice(1, p + 1);
        for (const v of emitted) out.push(v);
        record({ t, prefix: a.slice(1, n + 1), candidate: -1, period: p, action: "emit", emitted });
      }
      return;
    }
    a[t] = a[t - p];
    record({ t, prefix: a.slice(1, t), candidate: a[t], period: p, action: "recurse" });
    neck(t + 1, p);
    for (let j = a[t - p] + 1; j < k; j++) {
      a[t] = j;
      record({ t, prefix: a.slice(1, t + 1), candidate: j, period: t, action: "recurse" });
      neck(t + 1, t);
    }
  }
  neck(1, 1);
  if (out.length !== total) throw new Error(`内部错误: 输出长度 ${out.length} != k^n ${total}`);
  return { cycleIndices: out, steps, truncated };
}

export function toSymbols(indices: number[], alphabet: Alphabet): string[] {
  return indices.map((i) => alphabet.symbols[i]);
}

export function toIndices(symbols: unknown, alphabet: Alphabet): number[] {
  if (!Array.isArray(symbols)) throw new ApiError("BAD_REQUEST", "序列必须是符号数组");
  return symbols.map((s) => {
    const i = alphabet.index.get(s as string);
    if (i === undefined) throw new ApiError("UNKNOWN_SYMBOL", `符号不在字母表中: ${JSON.stringify(s)}`);
    return i;
  });
}
