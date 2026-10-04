// SQLite 持久化：保存字母表顺序、参数、构造版本、循环主体与验证摘要。
// 使用 Node 内置 node:sqlite，无原生依赖。
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import { CONSTRUCTION_VERSION, ValidationReport } from "./core";

export interface StoredRun {
  id: number;
  kind: "generated" | "imported";
  alphabet: string[];
  n: number;
  version: string;
  cycle: string[];
  report: ValidationReport | null;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const dir = path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath ?? path.join(dir, "debruijn.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        alphabet TEXT NOT NULL,
        n INTEGER NOT NULL,
        version TEXT NOT NULL,
        cycle TEXT NOT NULL,
        report TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  /** 写入一次运行记录；失败时抛错且不改动任何既有行（单条 INSERT 原子提交）。 */
  save(kind: "generated" | "imported", alphabet: string[], n: number, cycle: string[], report: ValidationReport | null): number {
    const stmt = this.db.prepare(
      "INSERT INTO runs (kind, alphabet, n, version, cycle, report, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const r = stmt.run(
      kind,
      JSON.stringify(alphabet),
      n,
      CONSTRUCTION_VERSION,
      JSON.stringify(cycle),
      report ? JSON.stringify(report) : null,
      new Date().toISOString(),
    );
    return Number(r.lastInsertRowid);
  }

  get(id: number): StoredRun | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    return row ? this.toRun(row) : null;
  }

  list(limit = 50): StoredRun[] {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit) as any[];
    return rows.map((r) => this.toRun(r));
  }

  private toRun(row: any): StoredRun {
    return {
      id: row.id,
      kind: row.kind,
      alphabet: JSON.parse(row.alphabet),
      n: row.n,
      version: row.version,
      cycle: JSON.parse(row.cycle),
      report: row.report ? JSON.parse(row.report) : null,
      createdAt: row.created_at,
    };
  }

  close() {
    this.db.close();
  }
}