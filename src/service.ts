import { ApiError } from "./errors.js";
import {
  Alphabet, CONSTRUCTION_VERSION, LIMITS, checkedTotalWords, fkm, toIndices, toSymbols,
  validateAlphabet, validateN,
} from "./debruijn.js";
import { expandLinear, queryWord, verifyCycle } from "./verify.js";
import { Store } from "./store.js";

export interface GenerateResult {
  sequenceId: number;
  alphabet: string[];
  n: number;
  k: number;
  constructionVersion: string;
  cycle: string[];
  cycleLength: number;
  reused: boolean;
}

export class Service {
  constructor(private store: Store) {}

  close(): void { this.store.close(); }

  generate(input: { alphabet: unknown; n: unknown }): GenerateResult {
    const alphabet = validateAlphabet(input.alphabet);
    const n = validateN(input.n);
    const total = checkedTotalWords(alphabet.symbols.length, n);
    const existing = this.store.findSequence(JSON.stringify(alphabet.symbols), n);
    if (existing) {
      return { sequenceId: existing.id, alphabet: existing.alphabet, n, k: existing.k,
        constructionVersion: existing.constructionVersion, cycle: existing.cycle,
        cycleLength: existing.cycle.length, reused: true };
    }
    const { cycleIndices } = fkm(alphabet.symbols.length, n);
    const cycle = toSymbols(cycleIndices, alphabet);
    // 只有构造成功才落库；失败抛错不会覆盖旧结果
    const row = this.store.saveSequence(alphabet.symbols, n, CONSTRUCTION_VERSION, cycle);
    void total;
    return { sequenceId: row.id, alphabet: row.alphabet, n, k: row.k,
      constructionVersion: row.constructionVersion, cycle: row.cycle,
      cycleLength: row.cycle.length, reused: false };
  }

  verify(input: { alphabet: unknown; n: unknown; cycle: unknown; sequenceId?: unknown }) {
    const alphabet = validateAlphabet(input.alphabet);
    const n = validateN(input.n);
    checkedTotalWords(alphabet.symbols.length, n);
    const indices = toIndices(input.cycle, alphabet);
    const report = verifyCycle(indices, alphabet, n);
    const seqId = typeof input.sequenceId === "number" ? input.sequenceId : null;
    const row = this.store.saveVerification(seqId, input.cycle as string[], report);
    return { verificationId: row.id, ...report };
  }

  query(input: { alphabet: unknown; n: unknown; cycle: unknown; word: unknown }) {
    const alphabet = validateAlphabet(input.alphabet);
    const n = validateN(input.n);
    const cycleIndices = toIndices(input.cycle, alphabet);
    const wordIndices = toIndices(input.word, alphabet);
    return queryWord(cycleIndices, wordIndices, n);
  }

  expand(input: { alphabet: unknown; n: unknown; cycle: unknown }) {
    const alphabet = validateAlphabet(input.alphabet);
    const n = validateN(input.n);
    const indices = toIndices(input.cycle, alphabet);
    const { body, tail } = expandLinear(indices, n);
    return {
      body: toSymbols(body, alphabet),
      tail: toSymbols(tail, alphabet),
      linear: toSymbols([...body, ...tail], alphabet),
      note: "body 为循环主体；tail 仅为线性展示附加的前 n-1 个符号，不计入循环长度",
    };
  }

  explain(input: { alphabet: unknown; n: unknown; maxSteps?: unknown }) {
    const alphabet = validateAlphabet(input.alphabet);
    const n = validateN(input.n);
    let maxSteps = 50;
    if (input.maxSteps !== undefined) {
      if (typeof input.maxSteps !== "number" || !Number.isInteger(input.maxSteps) || input.maxSteps < 1)
        throw new ApiError("BAD_REQUEST", "maxSteps 必须是正整数");
      maxSteps = Math.min(input.maxSteps, LIMITS.MAX_EXPLAIN_STEPS);
    }
    const { steps, truncated } = fkm(alphabet.symbols.length, n, maxSteps);
    return {
      alphabet: alphabet.symbols, n, truncated, maxSteps,
      steps: steps.map((s) => ({
        t: s.t,
        prefix: toSymbols(s.prefix, alphabet),
        candidate: s.candidate >= 0 ? alphabet.symbols[s.candidate] : null,
        period: s.period,
        action: s.action,
        emitted: s.emitted ? toSymbols(s.emitted, alphabet) : undefined,
      })),
    };
  }

  version() {
    return { constructionVersion: CONSTRUCTION_VERSION, limits: LIMITS };
  }

  exportAll() {
    return {
      constructionVersion: CONSTRUCTION_VERSION,
      exportedAt: new Date().toISOString(),
      sequences: this.store.listSequences(),
      verifications: this.store.listVerifications(),
    };
  }
}
