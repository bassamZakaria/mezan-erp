import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import { placeholders, TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
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
  approved_by         TEXT,
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
  amount: bigint;
  release_event_date: string | null;
  early_release: bigint;
  status: string;
  notes: string | null;
  invoice_id: string | null;
  invoice_doc_no: string | null;
  released_at: string | null;
  released_by: string | null;
  approved_by: string | null;
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
    earlyRelease: Number(row.early_release) === 1,
    status: row.status as RetentionReleaseStatus,
    notes: row.notes,
    invoiceId: row.invoice_id,
    invoiceDocNo: row.invoice_doc_no,
    releasedAt: row.released_at,
    releasedBy: row.released_by,
    approvedBy: row.approved_by ?? null,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

const UPSERT = `
      INSERT INTO contracting_retention_release (
        id, doc_no, contract_id, contract_doc_no, project_id, customer_id, kind, date, amount,
        release_event_date, early_release, status, notes, invoice_id, invoice_doc_no,
        released_at, released_by, approved_by, cancelled_at, created_at, created_by
      ) VALUES (${placeholders(21)})
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
        approved_by = excluded.approved_by,
        cancelled_at = excluded.cancelled_at
    `;

function releaseParams(release: RetentionRelease): SqlValue[] {
  return [
    release.id,
    release.docNo,
    release.contractId,
    release.contractDocNo,
    release.projectId,
    release.customerId,
    release.kind,
    release.date,
    release.amount.scaled,
    release.releaseEventDate,
    release.earlyRelease ? 1 : 0,
    release.status,
    release.notes,
    release.invoiceId,
    release.invoiceDocNo,
    release.releasedAt,
    release.releasedBy,
    release.approvedBy,
    release.cancelledAt,
    release.createdAt,
    release.createdBy,
  ];
}

class SqlRetentionReleaseStore implements RetentionReleaseStore {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<RetentionRelease | null> {
    const row = await this.db.get<ReleaseRow>(`SELECT * FROM contracting_retention_release WHERE id = ?`, [id]);
    return row ? toRelease(row) : null;
  }

  async findByDocNo(docNo: string): Promise<RetentionRelease | null> {
    const row = await this.db.get<ReleaseRow>(`SELECT * FROM contracting_retention_release WHERE doc_no = ?`, [docNo]);
    return row ? toRelease(row) : null;
  }

  async list(filter?: RetentionReleaseListFilter): Promise<RetentionRelease[]> {
    const rows = await this.db.all<ReleaseRow>(`SELECT * FROM contracting_retention_release ORDER BY date DESC, doc_no DESC`);
    return rows
      .map(toRelease)
      .filter(
        (r) =>
          (!filter?.contractId || r.contractId === filter.contractId) &&
          (!filter?.projectId || r.projectId === filter.projectId) &&
          (!filter?.status || r.status === filter.status),
      );
  }

  async save(release: RetentionRelease): Promise<void> {
    await this.db.run(UPSERT, releaseParams(release));
  }

  async insert(release: RetentionRelease): Promise<void> {
    await insertNew(this.db, release.id, UPSERT, releaseParams(release));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn, TransactionMode.Immediate);
  }
}

export async function ensureContractingControlsSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createContractingControlsStore(db: SqlDb): RetentionReleaseStore {
  return new SqlRetentionReleaseStore(db);
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
  const releaseColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(contracting_retention_release)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!releaseColumns.has("approved_by")) {
    sqlite.exec(`ALTER TABLE contracting_retention_release ADD COLUMN approved_by TEXT`);
  }
  return Object.assign(createContractingControlsStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteContractingControlsStoreHandle;
}
