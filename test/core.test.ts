import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generate, validateCycle, findWord, unwrap, ApiError } from "../src/core";
import { Store } from "../src/store";

/** 独立穷举：生成全部 k^n 个词，与候选循环窗口作多重集合比较（不依赖生成函数）。 */
function exhaustiveCheck(alphabet: string[], n: number, cycle: string[]) {
  const want = new Map<string, number>();
  const idx = new Array<number>(n).fill(0);
  const total = alphabet.length ** n;
  for (let c = 0; c < total; c++) {
    const w = idx.map((i) => alphabet[i]).join("");
    want.set(w, (want.get(w) ?? 0) + 1);
    for (let p = n - 1; p >= 0; p--) {
      if (idx[p] + 1 < alphabet.length) { idx[p]++; break; }
      idx[p] = 0;
    }
  }
  const got = new Map<string, number>();
  for (let s = 0; s < cycle.length; s++) {
    const w: string[] = [];
    for (let i = 0; i < n; i++) w.push(cycle[(s + i) % cycle.length]);
    const k = w.join("");
    got.set(k, (got.get(k) ?? 0) + 1);
  }
  assert.deepEqual(got, want);
}

function rotate<T>(a: T[], r: number): T[] {
  return a.slice(r).concat(a.slice(0, r));
}

test("二元 n=2：四种窗口各一次", () => {
  const { cycle } = generate(["0", "1"], 2);
  assert.equal(cycle.length, 4);
  exhaustiveCheck(["0", "1"], 2, cycle);
  const r = validateCycle(["0", "1"], 2, cycle);
  assert.equal(r.complete, true);
  assert.equal(r.distinctWords, 4);
});

test("二元 n=3：八种窗口各一次", () => {
  const { cycle } = generate(["0", "1"], 3);
  assert.equal(cycle.length, 8);
  exhaustiveCheck(["0", "1"], 3, cycle);
  assert.equal(validateCycle(["0", "1"], 3, cycle).complete, true);
});

test("多组小参数穷举核验（含 k=3, n=1）", () => {
  for (const [alpha, n] of [
    [["0", "1"], 1], [["0", "1"], 4], [["a", "b", "c"], 2], [["a", "b", "c"], 3],
    [["w", "x", "y", "z"], 2], [["0", "1"], 5],
  ] as [string[], number][]) {
    const { cycle } = generate(alpha, n);
    assert.equal(cycle.length, alpha.length ** n);
    exhaustiveCheck(alpha, n, cycle);
  }
});

test("字母表顺序保留，不按系统语言排序", () => {
  const a1 = generate(["乙", "甲"], 2).cycle;
  const a2 = generate(["甲", "乙"], 2).cycle;
  assert.notDeepEqual(a1, a2);
  assert.equal(a1[0], "乙");
});

test("中文符号与 emoji（单码点）", () => {
  const { cycle } = generate(["春", "夏", "秋"], 2);
  exhaustiveCheck(["春", "夏", "秋"], 2, cycle);
  assert.equal(validateCycle(["春", "夏", "秋"], 2, cycle).complete, true);
});

test("单符号字母表：循环只有一个符号，窗口绕回", () => {
  const { cycle } = generate(["甲"], 3);
  assert.deepEqual(cycle, ["甲"]);
  const r = validateCycle(["甲"], 3, cycle);
  assert.equal(r.complete, true);
  const hits = findWord(cycle, 3, ["甲", "甲", "甲"]);
  assert.deepEqual(hits, [{ start: 0, wraps: true }]);
});

test("删除符号：缺失词被报告", () => {
  const { cycle } = generate(["0", "1"], 2);
  const broken = cycle.filter((_, i) => i !== 1);
  const r = validateCycle(["0", "1"], 2, broken);
  assert.equal(r.complete, false);
  assert.ok(r.missingCount > 0);
  assert.ok(r.errors.some((e) => e.code === "E_CYCLE_LENGTH"));
});

test("替换符号：产生重复与缺失，报告首个重复及起点", () => {
  const { cycle } = generate(["0", "1"], 3);
  const broken = [...cycle];
  broken[0] = broken[0] === "0" ? "1" : "0";
  const r = validateCycle(["0", "1"], 3, broken);
  assert.equal(r.complete, false);
  assert.ok(r.duplicateCount > 0);
  assert.ok(r.missingCount > 0);
  assert.ok(r.firstDuplicate && typeof r.firstDuplicate.start === "number");
});

test("重复周期：n=2 候选 0101 被判定重复", () => {
  const r = validateCycle(["0", "1"], 2, ["0", "1", "0", "1"]);
  assert.equal(r.complete, false);
  assert.ok(r.duplicateCount > 0);
  assert.ok(r.missingCount > 0);
});

test("错误长度被拒绝", () => {
  const r = validateCycle(["0", "1"], 2, ["0", "1", "1"]);
  assert.equal(r.complete, false);
  assert.ok(r.errors.some((e) => e.code === "E_CYCLE_LENGTH"));
});

test("尾部跨界窗口必须统计：0011 的窗口含 10(跨尾)", () => {
  // 0011 是合法 B(2,2)；起点 3 的窗口为 1,0（绕回）
  const hits = findWord(["0", "0", "1", "1"], 2, ["1", "0"]);
  assert.deepEqual(hits, [{ start: 3, wraps: true }]);
  // 只查内部窗口会漏掉它；循环验证必须通过
  assert.equal(validateCycle(["0", "1"], 2, ["0", "0", "1", "1"]).complete, true);
});

test("非法词查询：长度不符与非法符号", () => {
  assert.throws(() => findWord(["0", "1"], 2, ["0"]), (e: ApiError) => e.code === "E_WORD_LENGTH");
  const r = validateCycle(["0", "1"], 2, ["0", "0", "1", "2"]);
  assert.equal(r.alphabetValid, false);
  assert.deepEqual(r.invalidSymbols, ["2"]);
});

test("任意旋转仍验证成功", () => {
  const alpha = ["0", "1"];
  const { cycle } = generate(alpha, 3);
  for (let r = 0; r < cycle.length; r++) {
    assert.equal(validateCycle(alpha, 3, rotate(cycle, r)).complete, true, `rotation ${r}`);
  }
});

test("反转后仍保留覆盖性质", () => {
  const alpha = ["0", "1"];
  const { cycle } = generate(alpha, 3);
  assert.equal(validateCycle(alpha, 3, [...cycle].reverse()).complete, true);
});

test("相同参数重复生成字节级一致", () => {
  const a = JSON.stringify(generate(["春", "夏", "秋"], 2).cycle);
  const b = JSON.stringify(generate(["春", "夏", "秋"], 2).cycle);
  assert.equal(a, b);
});

test("unwrap：主体长度不含附加尾部", () => {
  const { cycle } = generate(["0", "1"], 3);
  const u = unwrap(cycle, 3);
  assert.equal(u.body.length, 8);
  assert.equal(u.tail.length, 2);
  assert.equal(u.display.length, 10);
  assert.deepEqual(u.tail, cycle.slice(0, 2));
});

test("参数校验错误码", () => {
  assert.throws(() => generate([], 2), (e: ApiError) => e.code === "E_ALPHABET_EMPTY");
  assert.throws(() => generate(["a", "a"], 2), (e: ApiError) => e.code === "E_DUPLICATE_SYMBOL");
  assert.throws(() => generate(["ab"], 2), (e: ApiError) => e.code === "E_INVALID_SYMBOL");
  assert.throws(() => generate(["a"], 0), (e: ApiError) => e.code === "E_INVALID_N");
  assert.throws(() => generate(["a", "b"], 25), (e: ApiError) => e.code === "E_INVALID_N");
});

test("资源预算：超大 k^n 在分配前拒绝", () => {
  const big = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4e00 + i));
  assert.throws(() => generate(big, 5), (e: ApiError) => e.code === "E_BUDGET_EXCEEDED");
});

test("解释步骤：小步构造含前缀/候选/周期/输出片段", () => {
  const r = generate(["0", "1"], 2);
  assert.ok(r.steps.length > 0);
  const emitted = r.steps.filter((s) => s.emitted !== null);
  assert.ok(emitted.length > 0);
  const total = emitted.reduce((acc, s) => acc + (s.emitted?.length ?? 0), 0);
  assert.equal(total, 4);
});

test("SQLite：保存后重启可读，报告可复查", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbdb-"));
  const dbPath = path.join(dir, "t.db");
  const { cycle } = generate(["0", "1"], 3);
  const report = validateCycle(["0", "1"], 3, cycle);
  let id: number;
  {
    const s = new Store(dbPath);
    id = s.save("generated", ["0", "1"], 3, cycle, report);
    s.close();
  }
  {
    const s = new Store(dbPath); // 模拟重启
    const run = s.get(id);
    assert.ok(run);
    assert.deepEqual(run!.cycle, cycle);
    assert.equal(run!.report!.complete, true);
    assert.equal(run!.version, "fkm-1");
    s.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("构造失败不覆盖此前成功结果", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbdb-"));
  const dbPath = path.join(dir, "t.db");
  const s = new Store(dbPath);
  const { cycle } = generate(["0", "1"], 2);
  const id = s.save("generated", ["0", "1"], 2, cycle, null);
  assert.throws(() => generate(["a", "a"], 2)); // 失败在 save 之前抛出
  const run = s.get(id);
  assert.deepEqual(run!.cycle, cycle);
  s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});