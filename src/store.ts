import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface SequenceRow {
  id: number;
  alphabet: string[];
  n: number;
  k: number;
  constructionVersion: string;
  cycle: string[];
  createdAt: string;
}

export interface VerificationRow {
  id: number;
  sequenceId: number | null;
  candidate: string[];
  summary: unknown;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "debruijn.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alphabet TEXT NOT NULL,
        n INTEGER NOT NULL,
        k INTEGER NOT NULL,
        construction_version TEXT NOT NULL,
        cycle TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id INTEGER,
        candidate TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  /** 相同参数已存在成功结果时直接复用，保证重复操作行为确定 */
  findSequence(alphabetJson: string, n: number): SequenceRow | null {
    const row = this.db
      .prepare("SELECT * FROM sequences WHERE alphabet = ? AND n = ? ORDER BY id LIMIT 1")
      .get(alphabetJson, n) as any;
    return row ? this.toSequence(row) : null;
  }

  saveSequence(alphabet: string[], n: number, version: string, cycle: string[]): SequenceRow {
    const alphabetJson = JSON.stringify(alphabet);
    const existing = this.findSequence(alphabetJson, n);
    if (existing) return existing;
    const now = new Date().toISOString();
    const r = this.db
      .prepare("INSERT INTO sequences (alphabet, n, k, construction_version, cycle, created_at) VALUES (?,?,?,?,?,?)")
      .run(alphabetJson, n, alphabet.length, version, JSON.stringify(cycle), now);
    return this.getSequence(Number(r.lastInsertRowid))!;
  }

  getSequence(id: number): SequenceRow | null {
    const row = this.db.prepare("SELECT * FROM sequences WHERE id = ?").get(id) as any;
    return row ? this.toSequence(row) : null;
  }

  listSequences(): SequenceRow[] {
    const rows = this.db.prepare("SELECT * FROM sequences ORDER BY id").all() as any[];
    return rows.map((r) => this.toSequence(r));
  }

  saveVerification(sequenceId: number | null, candidate: string[], summary: unknown): VerificationRow {
    const now = new Date().toISOString();
    const r = this.db
      .prepare("INSERT INTO verifications (sequence_id, candidate, summary, created_at) VALUES (?,?,?,?)")
      .run(sequenceId, JSON.stringify(candidate), JSON.stringify(summary), now);
    return this.getVerification(Number(r.lastInsertRowid))!;
  }

  getVerification(id: number): VerificationRow | null {
    const row = this.db.prepare("SELECT * FROM verifications WHERE id = ?").get(id) as any;
    return row ? this.toVerification(row) : null;
  }

  listVerifications(): VerificationRow[] {
    const rows = this.db.prepare("SELECT * FROM verifications ORDER BY id").all() as any[];
    return rows.map((r) => this.toVerification(r));
  }

  close(): void { this.db.close(); }

  private toSequence(row: any): SequenceRow {
    return {
      id: row.id, alphabet: JSON.parse(row.alphabet), n: row.n, k: row.k,
      constructionVersion: row.construction_version, cycle: JSON.parse(row.cycle),
      createdAt: row.created_at,
    };
  }

  private toVerification(row: any): VerificationRow {
    return {
      id: row.id, sequenceId: row.sequence_id, candidate: JSON.parse(row.candidate),
      summary: JSON.parse(row.summary), createdAt: row.created_at,
    };
  }
}
