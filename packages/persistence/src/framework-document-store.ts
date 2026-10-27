import type Database from "better-sqlite3";
import type { DocumentField, DocumentListFilter, DocumentRepository, DocumentStatus, DocumentWritePrecondition, FrameworkDocument } from "@mezan/domain";
import { refuseUnlessInserted } from "./insert-new.js";
import { columnsOf, FRAMEWORK_DOCUMENT_COLUMNS } from "./document-field-write.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * Generic {@link DocumentRepository} for a document-framework
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

function frameworkDocumentDdl(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
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
    CREATE INDEX IF NOT EXISTS idx_${tableName}_status ON ${tableName}(status);
    CREATE INDEX IF NOT EXISTS idx_${tableName}_date ON ${tableName}(date);
  `;
}

const ROW_COLUMNS = [
  "id", "doc_no", "date", "memo", "status", "lines_json", "created_at", "confirmed_at",
  "reverses_doc_id", "reversed_by_doc_id", "workflow_request_id", "journal_entry_id",
] as const;

const UPDATE_COLUMNS = ROW_COLUMNS.filter((column) => column !== "id" && column !== "created_at");

type DocumentRowValues = Record<(typeof ROW_COLUMNS)[number], SqlValue>;

class SqlFrameworkDocumentStore<Line> implements DocumentRepository<Line> {
  constructor(
    private readonly db: SqlDb,
    private readonly opts: FrameworkDocumentStoreOptions<Line>,
  ) {}

  private toRow(doc: FrameworkDocument<Line>): DocumentRowValues {
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
    const row = this.toRow(doc);
    const inserted = await this.db.run(
      `INSERT INTO ${this.opts.tableName} (${ROW_COLUMNS.join(", ")}) VALUES (${placeholders(ROW_COLUMNS.length)})
       ON CONFLICT (id) DO NOTHING`,
      ROW_COLUMNS.map((column) => row[column]),
    );
    refuseUnlessInserted(doc.id, inserted.changes);
  }

  async update(doc: FrameworkDocument<Line>): Promise<void> {
    const row = this.toRow(doc);
    await this.db.run(
      `UPDATE ${this.opts.tableName} SET ${UPDATE_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...UPDATE_COLUMNS.map((column) => row[column]), doc.id],
    );
  }

  async writeFields(next: FrameworkDocument<Line>, fields: readonly DocumentField[], expected: DocumentWritePrecondition): Promise<boolean> {
    const columns = columnsOf(FRAMEWORK_DOCUMENT_COLUMNS, fields);
    if (columns.length === 0) return false;
    const row = this.toRow(next) as Record<string, SqlValue>;
    const result = await this.db.run(
      `UPDATE ${this.opts.tableName} SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND status IN (?)`,
      [...columns.map((column) => row[column]!), next.id, expected.status],
    );
    return result.changes === 1;
  }

  async findById(id: string): Promise<FrameworkDocument<Line> | null> {
    const row = await this.db.get<DocumentRow>(`SELECT * FROM ${this.opts.tableName} WHERE id = ?`, [id]);
    return row ? this.fromRow(row) : null;
  }

  async list(filter: DocumentListFilter = {}): Promise<readonly FrameworkDocument<Line>[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
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
    const rows = await this.db.all<DocumentRow>(`SELECT * FROM ${this.opts.tableName} ${where} ORDER BY date, created_at`, params);
    return rows.map((r) => this.fromRow(r));
  }

  /**
   * Re-entrant: a nested call on the same connection (this document's own
   * confirm() driving the stock-ledger engine's GL posting) becomes a
   * SAVEPOINT, and concurrent outermost calls on the connection several
   * stores share are serialised.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }
}

export async function ensureFrameworkDocumentSchema(db: SqlDb, tableName: string): Promise<void> {
  await db.applySchema(frameworkDocumentDdl(tableName));
}

export function createFrameworkDocumentStore<Line>(db: SqlDb, opts: FrameworkDocumentStoreOptions<Line>): DocumentRepository<Line> {
  const store = new SqlFrameworkDocumentStore<Line>(db, opts);
  return {
    save: (d) => store.save(d),
    update: (d) => store.update(d),
    writeFields: (next, fields, expected) => store.writeFields(next, fields, expected),
    findById: (id) => store.findById(id),
    list: (f) => store.list(f),
    transaction: (fn) => store.transaction(fn),
  };
}

export function createSqliteFrameworkDocumentStore<Line>(
  sqlite: Database.Database,
  opts: FrameworkDocumentStoreOptions<Line>,
): SqliteFrameworkDocumentStoreHandle<Line> {
  sqlite.exec(frameworkDocumentDdl(opts.tableName));
  return createFrameworkDocumentStore(sqliteDb(sqlite), opts);
}
