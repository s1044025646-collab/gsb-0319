import { ApiError } from "./errors.js";
import { Alphabet, checkedTotalWords } from "./debruijn.js";

export interface VerifyReport {
  ok: boolean;
  length: number;
  expectedLength: number;
  errors: { code: string; message: string }[];
  coverage: { distinct: number; total: number; complete: boolean };
  firstDuplicate: { start: number; word: string[] } | null;
  missingSample: string[][];
  missingCount: number;
}

const SAMPLE_LIMIT = 8;

function wordKey(w: number[]): string {
  return w.join(",");
}

/** 独立穷举全部 k^n 个词（按索引计数法），与生成函数无关 */
export function enumerateAllWords(k: number, n: number): number[][] {
  const total = checkedTotalWords(k, n);
  const words: number[][] = new Array(total);
  const idx = new Array<number>(n).fill(0);
  for (let c = 0; c < total; c++) {
    words[c] = idx.slice();
    for (let pos = n - 1; pos >= 0; pos--) {
      if (++idx[pos] < k) break;
      idx[pos] = 0;
    }
  }
  return words;
}

export function verifyCycle(cycleIndices: number[], alphabet: Alphabet, n: number): VerifyReport {
  const k = alphabet.symbols.length;
  const expected = checkedTotalWords(k, n);
  const errors: { code: string; message: string }[] = [];
  const len = cycleIndices.length;

  if (len !== expected)
    errors.push({ code: "INVALID_CYCLE_LENGTH", message: `循环长度 ${len} != k^n ${expected}` });

  const counts = new Map<string, number>();
  const wordAt = new Map<string, number[]>();
  let firstDuplicate: VerifyReport["firstDuplicate"] = null;
  for (let s = 0; s < len; s++) {
    const w = new Array<number>(n);
    for (let j = 0; j < n; j++) w[j] = cycleIndices[(s + j) % len];
    const key = wordKey(w);
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    if (c === 2 && !firstDuplicate)
      firstDuplicate = { start: s, word: w.map((i) => alphabet.symbols[i]) };
    if (!wordAt.has(key)) wordAt.set(key, w);
  }
  const missing: string[][] = [];
  let missingCount = 0;
  for (const w of enumerateAllWords(k, n)) {
    if (!counts.has(wordKey(w))) {
      missingCount++;
      if (missing.length < SAMPLE_LIMIT) missing.push(w.map((i) => alphabet.symbols[i]));
    }
  }
  if (missingCount > 0)
    errors.push({ code: "MISSING_WORDS", message: `缺失 ${missingCount} 个词` });
  if (firstDuplicate)
    errors.push({ code: "DUPLICATE_WORD", message: `起点 ${firstDuplicate.start} 处词重复` });

  const distinct = counts.size;
  const complete = errors.length === 0 && distinct === expected && len === expected;
  return {
    ok: complete,
    length: len,
    expectedLength: expected,
    errors,
    coverage: { distinct, total: expected, complete },
    firstDuplicate,
    missingSample: missing,
    missingCount,
  };
}

export interface QueryResult {
  found: boolean;
  starts: number[];
  wraps: boolean[];
}

export function queryWord(cycleIndices: number[], wordIndices: number[], n: number): QueryResult {
  if (wordIndices.length !== n)
    throw new ApiError("WORD_LENGTH_MISMATCH", `查询词长度 ${wordIndices.length} != n ${n}`);
  const len = cycleIndices.length;
  const starts: number[] = [];
  const wraps: boolean[] = [];
  for (let s = 0; s < len; s++) {
    let match = true;
    for (let j = 0; j < n; j++) {
      if (cycleIndices[(s + j) % len] !== wordIndices[j]) { match = false; break; }
    }
    if (match) { starts.push(s); wraps.push(s + n > len); }
  }
  return { found: starts.length > 0, starts, wraps };
}

/** 线性展示：循环主体 + 前 n-1 个符号作为附加尾部（不计入循环长度） */
export function expandLinear(cycleIndices: number[], n: number): { body: number[]; tail: number[] } {
  return { body: cycleIndices.slice(), tail: cycleIndices.slice(0, Math.max(0, n - 1)) };
}
