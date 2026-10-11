import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { columnsOf, FRAMEWORK_DOCUMENT_COLUMNS, writeRowColumnsWhere } from "./document-field-write.js";
import type {
  DocumentListFilter,
  DocumentRepository,
  DocumentStatus,
  FrameworkDocument,
} from "@mezan/domain";

/**
 * Generic SQLite-backed {@link DocumentRepository} for the document framework
 * (docs/archive/plan.md §3). ONE `framework_document` table holds every concrete
 * type's header, partitioned by `doc_type`; `lines` is stored as a JSON array
 * of the type's own wire-shaped line objects (Money/Qty already turned into
 * exact decimal strings by the caller's `serializeLine`, same "never a float"
 * convention as everywhere else — see docs/archive/plan.md §2.3 — just carried as JSON
 * text instead of a scaled-INTEGER column, since a document type's line shape
 * varies too much to normalize into one shared column set without a table per
 * type). `deserializeLine` is the exact inverse, so a round trip through the
 * store is lossless. `transaction()` matches every other store in this
 * package: manual BEGIN/COMMIT/ROLLBACK, safe because better-sqlite3 is fully
 * synchronous.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS framework_document (
  id                   TEXT PRIMARY KEY,
  doc_type             TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_framework_document_type ON framework_document(doc_type, date);
CREATE INDEX IF NOT EXISTS idx_framework_document_status ON framework_document(doc_type, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_framework_document_no ON framework_document(doc_type, doc_no) WHERE doc_no IS NOT NULL;
`;

/** SQLite's compiled-in ceiling on bound parameters is 999; `IN (...)` stays under it. */
const MAX_BOUND_IDS = 900;

interface DocumentRow {
  id: string;
  doc_type: string;
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

export interface SqliteDocumentStoreHandle<Line> extends DocumentRepository<Line> {
  close(): void;
}

/** Ensures `framework_document` exists on `sqlite`. Idempotent — safe to call once per connection regardless of how many document types share it. */
export function ensureDocumentTable(sqlite: Database.Database): void {
  sqlite.exec(CREATE_TABLE);
}

/**
 * Bind a `DocumentRepository<Line>` for ONE `docType` against `sqlite`
 * (a connection the caller owns and may share with other stores — e.g. the
 * stock-ledger store, so a document's stock hook commits on the SAME
 * connection). Call {@link ensureDocumentTable} once per connection first.
 */
export function createSqliteDocumentStore<Line>(
  sqlite: Database.Database,
  docType: string,
  serializeLine: (line: Line) => unknown,
  deserializeLine: (wire: unknown) => Line,
): DocumentRepository<Line> {
  const insert = sqlite.prepare(`
    INSERT INTO framework_document
      (id, doc_type, doc_no, date, memo, status, lines_json, created_at, confirmed_at,
       reverses_doc_id, reversed_by_doc_id, workflow_request_id, journal_entry_id)
    VALUES
      (@id, @doc_type, @doc_no, @date, @memo, @status, @lines_json, @created_at, @confirmed_at,
       @reverses_doc_id, @reversed_by_doc_id, @workflow_request_id, @journal_entry_id)
  `);
  const update = sqlite.prepare(`
    UPDATE framework_document SET
      doc_no = @doc_no, date = @date, memo = @memo, status = @status, lines_json = @lines_json,
      confirmed_at = @confirmed_at, reverses_doc_id = @reverses_doc_id,
      reversed_by_doc_id = @reversed_by_doc_id, workflow_request_id = @workflow_request_id,
      journal_entry_id = @journal_entry_id
    WHERE id = @id AND doc_type = @doc_type
  `);
  const selectById = sqlite.prepare(`SELECT * FROM framework_document WHERE id = ? AND doc_type = ?`);
  const selectAll = sqlite.prepare(`SELECT * FROM framework_document WHERE doc_type = ? ORDER BY date, created_at`);

  function toRow(doc: FrameworkDocument<Line>) {
    return {
      id: doc.id,
      doc_type: docType,
      doc_no: doc.docNo,
      date: doc.date,
      memo: doc.memo,
      status: doc.status,
      lines_json: JSON.stringify(doc.lines.map(serializeLine)),
      created_at: doc.createdAt,
      confirmed_at: doc.confirmedAt,
      reverses_doc_id: doc.reversesDocId,
      reversed_by_doc_id: doc.reversedByDocId,
      workflow_request_id: doc.workflowRequestId,
      journal_entry_id: doc.journalEntryId,
    };
  }

  function fromRow(row: DocumentRow): FrameworkDocument<Line> {
    return {
      id: row.id,
      docType: row.doc_type,
      docNo: row.doc_no,
      date: row.date,
      memo: row.memo,
      status: row.status as DocumentStatus,
      lines: (JSON.parse(row.lines_json) as unknown[]).map(deserializeLine),
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      reversesDocId: row.reverses_doc_id,
      reversedByDocId: row.reversed_by_doc_id,
      workflowRequestId: row.workflow_request_id,
      journalEntryId: row.journal_entry_id,
    };
  }

  return {
    async save(doc) {
      insert.run(toRow(doc));
    },
    async update(doc) {
      update.run(toRow(doc));
    },
    async writeFields(next, fields, expected) {
      return writeRowColumnsWhere(sqlite, {
        table: "framework_document",
        row: toRow(next),
        columns: columnsOf(FRAMEWORK_DOCUMENT_COLUMNS, fields),
        id: next.id,
        expectedStatuses: [expected.status],
        and: { sql: "doc_type = ?", params: [docType] },
      });
    },
    async findById(id) {
      const row = selectById.get(id, docType) as DocumentRow | undefined;
      return row ? fromRow(row) : null;
    },
    async list(filter: DocumentListFilter = {}) {
      const rows = selectAll.all(docType) as DocumentRow[];
      return rows
        .filter((r) => (filter.status ? r.status === filter.status : true))
        .filter((r) => (filter.fromDate ? r.date >= filter.fromDate : true))
        .filter((r) => (filter.toDate ? r.date <= filter.toDate : true))
        .map(fromRow);
    },
    async listByLineRef(field: string, ids: readonly string[], filter: DocumentListFilter = {}) {
      if (ids.length === 0) return [];
      const path = `$.${field}`;
      const out: FrameworkDocument<Line>[] = [];
      for (let start = 0; start < ids.length; start += MAX_BOUND_IDS) {
        const chunk = ids.slice(start, start + MAX_BOUND_IDS);
        const clauses = ["d.doc_type = ?"];
        const params: unknown[] = [docType];
        if (filter.status) { clauses.push("d.status = ?"); params.push(filter.status); }
        if (filter.fromDate) { clauses.push("d.date >= ?"); params.push(filter.fromDate); }
        if (filter.toDate) { clauses.push("d.date <= ?"); params.push(filter.toDate); }
        clauses.push(`json_extract(l.value, ?) IN (${chunk.map(() => "?").join(",")})`);
        params.push(path, ...chunk);
        const rows = sqlite
          .prepare(
            `SELECT DISTINCT d.* FROM framework_document d, json_each(d.lines_json) l
              WHERE ${clauses.join(" AND ")} ORDER BY d.date, d.created_at`,
          )
          .all(...params) as DocumentRow[];
        for (const row of rows) out.push(fromRow(row));
      }
      return out;
    },
    async nameSourcedLineTaxRate(docId: string, sourceInvoiceId: string, taxRatePercent: number, taxRateId: string) {
      const row = selectById.get(docId, docType) as DocumentRow | undefined;
      if (!row) return 0;
      // EXTERNAL CONTRACT: the wire names both return stores serialise.
      const lines = JSON.parse(row.lines_json) as { sourceInvoiceId?: string; taxRatePercent?: number | null; taxRateId?: string | null }[];
      let named = 0;
      for (const line of lines) {
        if (line.sourceInvoiceId !== sourceInvoiceId || (line.taxRateId ?? null) !== null || (line.taxRatePercent ?? 0) !== taxRatePercent) continue;
        line.taxRateId = taxRateId;
        named += 1;
      }
      if (named === 0) return 0;
      // The stored lines are compared as read: a row another writer moved is left alone.
      const written = sqlite
        .prepare(`UPDATE framework_document SET lines_json = ? WHERE id = ? AND doc_type = ? AND lines_json = ?`)
        .run(JSON.stringify(lines), docId, docType, row.lines_json).changes;
      return written === 0 ? 0 : named;
    },
    async transaction(fn) {
      return withSqliteTransaction(sqlite, fn);
    },
  };
}

/** Stand-alone connection for a document type, when it isn't sharing one with another store. Mainly for tests/small tools. */
export function createStandaloneSqliteDocumentStore<Line>(
  docType: string,
  serializeLine: (line: Line) => unknown,
  deserializeLine: (wire: unknown) => Line,
  path: SqliteConnectionInput = ":memory:",
): SqliteDocumentStoreHandle<Line> {
  const { sqlite, owned } = openSqliteConnection(path);
  ensureDocumentTable(sqlite);
  const repo = createSqliteDocumentStore<Line>(sqlite, docType, serializeLine, deserializeLine);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } });
}
