import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  type RetentionRelease,
  type RetentionReleaseKind,
  type RetentionReleaseListFilter,
  type RetentionReleaseStatus,
  type RetentionReleaseStore,
} from "@mezan/domain";

/**
 * SQLite-backed store for الإفراج عن المحتجزات (slice 5B of المقاولات).
 *
 * Only the release DOCUMENT lives here. What is held, what has been released
 * and what is left are read off the posted ledger by the domain service — a
 * stored balance beside the control account is the copy that ends up
 * disagreeing with it.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS contracting_retention_release (
  id                  TEXT PRIMARY KEY,
  doc_no              TEXT NOT NULL UNIQUE,
  contract_id         TEXT NOT NULL,
  contract_doc_no     TEXT NOT NULL,
  project_id          TEXT NOT NULL,
  customer_id         TEXT NOT NULL,
  kind                TEXT NOT NULL,
  date                TEXT NOT NULL,
  amount              INTEGER NOT NULL,
  release_event_date  TEXT,
  early_release       INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL,
  notes               TEXT,
  invoice_id          TEXT,
  invoice_doc_no      TEXT,
  released_at         TEXT,
  released_by         TEXT,
  cancelled_at        TEXT,
  created_at          TEXT NOT NULL,
  created_by          TEXT
);
CREATE INDEX IF NOT EXISTS idx_retention_release_contract ON contracting_retention_release (contract_id, date);
CREATE INDEX IF NOT EXISTS idx_retention_release_project ON contracting_retention_release (project_id, date);
`;

interface ReleaseRow {
  id: string;
  doc_no: string;
  contract_id: string;
  contract_doc_no: string;
  project_id: string;
  customer_id: string;
  kind: string;
  date: string;
  amount: number;
  release_event_date: string | null;
  early_release: number;
  status: string;
  notes: string | null;
  invoice_id: string | null;
  invoice_doc_no: string | null;
  released_at: string | null;
  released_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  created_by: string | null;
}

function toRelease(row: ReleaseRow): RetentionRelease {
  return {
    id: row.id,
    docNo: row.doc_no,
    contractId: row.contract_id,
    contractDocNo: row.contract_doc_no,
    projectId: row.project_id,
    customerId: row.customer_id,
    kind: row.kind as RetentionReleaseKind,
    date: row.date,
    amount: Money.fromScaled(row.amount),
    releaseEventDate: row.release_event_date,
    earlyRelease: row.early_release === 1,
    status: row.status as RetentionReleaseStatus,
    notes: row.notes,
    invoiceId: row.invoice_id,
    invoiceDocNo: row.invoice_doc_no,
    releasedAt: row.released_at,
    releasedBy: row.released_by,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

class SqliteRetentionReleaseStore implements RetentionReleaseStore {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByDocNo: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO contracting_retention_release (
        id, doc_no, contract_id, contract_doc_no, project_id, customer_id, kind, date, amount,
        release_event_date, early_release, status, notes, invoice_id, invoice_doc_no,
        released_at, released_by, cancelled_at, created_at, created_by
      ) VALUES (
        @id, @doc_no, @contract_id, @contract_doc_no, @project_id, @customer_id, @kind, @date, @amount,
        @release_event_date, @early_release, @status, @notes, @invoice_id, @invoice_doc_no,
        @released_at, @released_by, @cancelled_at, @created_at, @created_by
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        date = excluded.date,
        amount = excluded.amount,
        release_event_date = excluded.release_event_date,
        early_release = excluded.early_release,
        status = excluded.status,
        notes = excluded.notes,
        invoice_id = excluded.invoice_id,
        invoice_doc_no = excluded.invoice_doc_no,
        released_at = excluded.released_at,
        released_by = excluded.released_by,
        cancelled_at = excluded.cancelled_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM contracting_retention_release WHERE id = ?`);
    this.selectByDocNo = sqlite.prepare(`SELECT * FROM contracting_retention_release WHERE doc_no = ?`);
    this.selectAll = sqlite.prepare(
      `SELECT * FROM contracting_retention_release ORDER BY date DESC, doc_no DESC`,
    );
  }

  async findById(id: string): Promise<RetentionRelease | null> {
    const row = this.selectById.get(id) as ReleaseRow | undefined;
    return row ? toRelease(row) : null;
  }

  async findByDocNo(docNo: string): Promise<RetentionRelease | null> {
    const row = this.selectByDocNo.get(docNo) as ReleaseRow | undefined;
    return row ? toRelease(row) : null;
  }

  async list(filter?: RetentionReleaseListFilter): Promise<RetentionRelease[]> {
    return (this.selectAll.all() as ReleaseRow[])
      .map(toRelease)
      .filter(
        (r) =>
          (!filter?.contractId || r.contractId === filter.contractId) &&
          (!filter?.projectId || r.projectId === filter.projectId) &&
          (!filter?.status || r.status === filter.status),
      );
  }

  async save(release: RetentionRelease): Promise<void> {
    this.upsert.run({
      id: release.id,
      doc_no: release.docNo,
      contract_id: release.contractId,
      contract_doc_no: release.contractDocNo,
      project_id: release.projectId,
      customer_id: release.customerId,
      kind: release.kind,
      date: release.date,
      amount: release.amount.toScaledNumber(),
      release_event_date: release.releaseEventDate,
      early_release: release.earlyRelease ? 1 : 0,
      status: release.status,
      notes: release.notes,
      invoice_id: release.invoiceId,
      invoice_doc_no: release.invoiceDocNo,
      released_at: release.releasedAt,
      released_by: release.releasedBy,
      cancelled_at: release.cancelledAt,
      created_at: release.createdAt,
      created_by: release.createdBy,
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }
}

export interface SqliteContractingControlsStoreHandle extends RetentionReleaseStore {
  close(): void;
}

/** Open a SQLite-backed retention-release store. ":memory:" for tests, a path for real. */
export function createSqliteContractingControlsStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteContractingControlsStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteRetentionReleaseStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteContractingControlsStoreHandle;
}
