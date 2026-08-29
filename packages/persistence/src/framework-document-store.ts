import Database from "better-sqlite3";
import type { DocumentListFilter, DocumentRepository, DocumentStatus, FrameworkDocument } from "@mezan/domain";
import { withSqliteTransaction } from "./sqlite-connection.js";

/**
 * Generic SQLite-backed {@link DocumentRepository} for a document-framework
 * consumer (docs/archive/plan.md §3). One table per concrete document type (Stock
 * Adjustment, Stock Transfer, …); `lines` is stored as one JSON blob column —
 * the type-specific line shape is opaque to this store, so it never needs its
 * own schema. `lineToWire`/`lineFromWire` do the Money/Qty <-> exact-decimal-
 * string boundary conversion the same way every other wire boundary in this
 * codebase does (docs/archive/plan.md §2.3 "no floats, ever").
 */

interface DocumentRow {
  id: string;
  doc_no: string | null;
  date: string;
  memo: string;
  status: string;
  lines_json: string;
  created_at: string;
  confirmed_at: string | null;
  reverses_doc_id: string | null;
  reversed_by_doc_id: string | null;
  workflow_request_id: string | null;
  journal_entry_id: string | null;
}

export interface FrameworkDocumentStoreOptions<Line> {
  /** SQL-safe table name — a fixed constant from our own code, one per document type. */
  readonly tableName: string;
  readonly docType: string;
  readonly lineToWire: (line: Line) => unknown;
  readonly lineFromWire: (wire: unknown) => Line;
}

/**
 * The store takes an ALREADY-OPEN connection (so several document tables can
 * share one SQLite file/connection) — the caller that opened it owns its
 * lifecycle, so this handle deliberately has no `close()` of its own.
 */
export type SqliteFrameworkDocumentStoreHandle<Line> = DocumentRepository<Line>;

class SqliteFrameworkDocumentStore<Line> implements DocumentRepository<Line> {
  private readonly insert: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly opts: FrameworkDocumentStoreOptions<Line>,
  ) {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ${opts.tableName} (
        id                   TEXT PRIMARY KEY,
        doc_no               TEXT,
        date                 TEXT NOT NULL,
        memo                 TEXT NOT NULL,
        status               TEXT NOT NULL,
        lines_json           TEXT NOT NULL,
        created_at           TEXT NOT NULL,
        confirmed_at         TEXT,
        reverses_doc_id      TEXT,
        reversed_by_doc_id   TEXT,
        workflow_request_id  TEXT,
        journal_entry_id     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_${opts.tableName}_status ON ${opts.tableName}(status);
      CREATE INDEX IF NOT EXISTS idx_${opts.tableName}_date ON ${opts.tableName}(date);
    `);

    this.insert = sqlite.prepare(`
      INSERT INTO ${opts.tableName}
        (id, doc_no, date, memo, status, lines_json, created_at, confirmed_at,
         reverses_doc_id, reversed_by_doc_id, workflow_request_id, journal_entry_id)
      VALUES
        (@id, @doc_no, @date, @memo, @status, @lines_json, @created_at, @confirmed_at,
         @reverses_doc_id, @reversed_by_doc_id, @workflow_request_id, @journal_entry_id)
    `);
    this.upsert = sqlite.prepare(`
      UPDATE ${opts.tableName} SET
        doc_no = @doc_no, date = @date, memo = @memo, status = @status,
        lines_json = @lines_json, confirmed_at = @confirmed_at,
        reverses_doc_id = @reverses_doc_id, reversed_by_doc_id = @reversed_by_doc_id,
        workflow_request_id = @workflow_request_id, journal_entry_id = @journal_entry_id
      WHERE id = @id
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM ${opts.tableName} WHERE id = ?`);
  }

  private toRow(doc: FrameworkDocument<Line>): Record<string, unknown> {
    return {
      id: doc.id,
      doc_no: doc.docNo,
      date: doc.date,
      memo: doc.memo,
      status: doc.status,
      lines_json: JSON.stringify(doc.lines.map((l) => this.opts.lineToWire(l))),
      created_at: doc.createdAt,
      confirmed_at: doc.confirmedAt,
      reverses_doc_id: doc.reversesDocId,
      reversed_by_doc_id: doc.reversedByDocId,
      workflow_request_id: doc.workflowRequestId,
      journal_entry_id: doc.journalEntryId,
    };
  }

  private fromRow(row: DocumentRow): FrameworkDocument<Line> {
    const wireLines = JSON.parse(row.lines_json) as unknown[];
    return {
      id: row.id,
      docType: this.opts.docType,
      docNo: row.doc_no,
      date: row.date,
      memo: row.memo,
      status: row.status as DocumentStatus,
      lines: wireLines.map((w) => this.opts.lineFromWire(w)),
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      reversesDocId: row.reverses_doc_id,
      reversedByDocId: row.reversed_by_doc_id,
      workflowRequestId: row.workflow_request_id,
      journalEntryId: row.journal_entry_id,
    };
  }

  async save(doc: FrameworkDocument<Line>): Promise<void> {
    this.insert.run(this.toRow(doc));
  }

  async update(doc: FrameworkDocument<Line>): Promise<void> {
    this.upsert.run(this.toRow(doc));
  }

  async findById(id: string): Promise<FrameworkDocument<Line> | null> {
    const row = this.selectById.get(id) as DocumentRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  async list(filter: DocumentListFilter = {}): Promise<readonly FrameworkDocument<Line>[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.fromDate) {
      clauses.push("date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("date <= ?");
      params.push(filter.toDate);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM ${this.opts.tableName} ${where} ORDER BY date, created_at`)
      .all(...params) as DocumentRow[];
    return rows.map((r) => this.fromRow(r));
  }

  /**
   * `withSqliteTransaction` — matches every other store in this package
   * (document-store.ts, sqlite-connection.ts's own doc comment): safe both for
   * re-entrancy (a nested call on the SAME shared connection, e.g. this
   * document's own confirm() driving the stock-ledger engine's GL posting,
   * becomes a SAVEPOINT instead of a second top-level BEGIN — which SQLite
   * rejects with "cannot start a transaction within a transaction") and for
   * concurrent outermost calls on a connection several stores now share
   * (create-backend.ts's ONE connection).
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn);
  }
}

export function createSqliteFrameworkDocumentStore<Line>(
  sqlite: Database.Database,
  opts: FrameworkDocumentStoreOptions<Line>,
): SqliteFrameworkDocumentStoreHandle<Line> {
  const store = new SqliteFrameworkDocumentStore<Line>(sqlite, opts);
  return {
    save: (d) => store.save(d),
    update: (d) => store.update(d),
    findById: (id) => store.findById(id),
    list: (f) => store.list(f),
    transaction: (fn) => store.transaction(fn),
  };
}
