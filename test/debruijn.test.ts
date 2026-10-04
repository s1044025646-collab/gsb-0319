import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fkm, validateAlphabet, checkedTotalWords } from "../src/debruijn.js";
import { enumerateAllWords, queryWord, verifyCycle, expandLinear } from "../src/verify.js";
import { Store } from "../src/store.js";
import { Service } from "../src/service.js";

const bin = validateAlphabet(["0", "1"]);

function multisetKey(w: number[]): string { return w.join(","); }

function cyclicWindows(cycle: number[], n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let s = 0; s < cycle.length; s++) {
    const w: number[] = [];
    for (let j = 0; j < n; j++) w.push(cycle[(s + j) % cycle.length]);
    m.set(multisetKey(w), (m.get(multisetKey(w)) ?? 0) + 1);
  }
  return m;
}

test("二元 n=2: 循环 0011 覆盖全部 4 种窗口", () => {
  const { cycleIndices } = fkm(2, 2);
  assert.deepEqual(cycleIndices, [0, 0, 1, 1]);
  const got = cyclicWindows(cycleIndices, 2);
  const want = new Map(enumerateAllWords(2, 2).map((w) => [multisetKey(w), 1]));
  assert.deepEqual(got, want);
  assert.equal(verifyCycle(cycleIndices, bin, 2).ok, true);
});

test("二元 n=3: 8 种窗口与独立穷举多重集合一致", () => {
  const { cycleIndices } = fkm(2, 3);
  assert.equal(cycleIndices.length, 8);
  const got = cyclicWindows(cycleIndices, 3);
  const want = new Map(enumerateAllWords(2, 3).map((w) => [multisetKey(w), 1]));
  assert.deepEqual(got, want);
  assert.equal(verifyCycle(cycleIndices, bin, 3).ok, true);
});

test("中文符号字母表保持给定顺序", () => {
  const zh = validateAlphabet(["天", "地", "人"]);
  const { cycleIndices } = fkm(3, 2);
  assert.equal(cycleIndices.length, 9);
  assert.equal(verifyCycle(cycleIndices, zh, 2).ok, true);
  assert.equal(zh.symbols[0], "天");
});

test("单符号字母表: 循环仅一个符号, 窗口绕回", () => {
  const one = validateAlphabet(["甲"]);
  const { cycleIndices } = fkm(1, 3);
  assert.deepEqual(cycleIndices, [0]);
  const report = verifyCycle(cycleIndices, one, 3);
  assert.equal(report.ok, true);
  const q = queryWord(cycleIndices, [0, 0, 0], 3);
  assert.equal(q.found, true);
  assert.deepEqual(q.wraps, [true]);
});

test("相同参数重复生成字节级一致", () => {
  const a = JSON.stringify(fkm(2, 5).cycleIndices);
  const b = JSON.stringify(fkm(2, 5).cycleIndices);
  assert.equal(a, b);
});

test("合法循环的任意旋转与反转仍验证成功", () => {
  const { cycleIndices } = fkm(2, 3);
  for (let r = 0; r < cycleIndices.length; r++) {
    const rot = [...cycleIndices.slice(r), ...cycleIndices.slice(0, r)];
    assert.equal(verifyCycle(rot, bin, 3).ok, true, `旋转 ${r} 应通过`);
  }
  const rev = cycleIndices.slice().reverse();
  assert.equal(verifyCycle(rev, bin, 3).ok, true, "反转应通过");
});

test("删除符号 -> 缺失词", () => {
  const { cycleIndices } = fkm(2, 2);
  const broken = cycleIndices.slice(1);
  const report = verifyCycle(broken, bin, 2);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "INVALID_CYCLE_LENGTH"));
});

test("替换符号 -> 重复词与缺失词", () => {
  const { cycleIndices } = fkm(2, 2); // 0011
  const broken = [0, 0, 1, 0];
  const report = verifyCycle(broken, bin, 2);
  assert.equal(report.ok, false);
  assert.ok(report.firstDuplicate);
  assert.ok(report.missingCount > 0);
});

test("重复周期 0101 不是 n=2 的 de Bruijn 循环", () => {
  const report = verifyCycle([0, 1, 0, 1], bin, 2);
  assert.equal(report.ok, false);
  assert.deepEqual(report.firstDuplicate?.word, ["0", "1"]);
});

test("错误长度被拒绝", () => {
  const report = verifyCycle([0, 0, 1], bin, 2);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "INVALID_CYCLE_LENGTH"));
});

test("跨尾部窗口被计入覆盖", () => {
  const { cycleIndices } = fkm(2, 2); // 0011
  const q = queryWord(cycleIndices, [1, 0], 2);
  assert.deepEqual(q.starts, [3]);
  assert.deepEqual(q.wraps, [true]);
});

test("非法词查询报错", () => {
  const { cycleIndices } = fkm(2, 2);
  assert.throws(() => queryWord(cycleIndices, [0], 2), /长度/);
});

test("字母表校验: 空/重复/多码点", () => {
  assert.throws(() => validateAlphabet([]), /不能为空/);
  assert.throws(() => validateAlphabet(["a", "a"]), /重复/);
  assert.throws(() => validateAlphabet(["ab"]), /单个 Unicode 码点/);
});

test("资源预算: k^n 超限先报错再分配", () => {
  assert.throws(() => checkedTotalWords(10, 10), /上限/);
});

test("循环展开: 主体与附加尾部分离", () => {
  const { body, tail } = expandLinear([0, 0, 1, 1], 2);
  assert.deepEqual(body, [0, 0, 1, 1]);
  assert.deepEqual(tail, [0]);
});

test("SQLite 持久化: 重启后报告可读, 重复生成复用", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dbj-"));
  try {
    let s1 = new Service(new Store(dir));
    const g1 = s1.generate({ alphabet: ["0", "1"], n: 3 });
    const v1 = s1.verify({ alphabet: ["0", "1"], n: 3, cycle: g1.cycle });
    assert.equal(v1.ok, true);
    s1.close();
    s1 = new Service(new Store(dir)); // 模拟重启
    const g2 = s1.generate({ alphabet: ["0", "1"], n: 3 });
    assert.equal(g2.reused, true);
    assert.equal(JSON.stringify(g2.cycle), JSON.stringify(g1.cycle));
    s1.close();
    const store = new Store(dir);
    const saved = store.getVerification(v1.verificationId);
    assert.ok(saved);
    assert.equal((saved!.summary as any).ok, true);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
