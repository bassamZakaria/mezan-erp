import type Database from "better-sqlite3";
import { Money, type VatFiling, type VatFilingRepository, type VatFilingStatus } from "@mezan/domain";
import { calendarDay } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * Filed VAT returns (docs/archive/defect-register.md D29). One row per submission; an amended
 * one keeps its row and changes status, so the trail of what was told to the
 * authority and when survives the amendment.
 */
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS vat_filing (
  id                TEXT PRIMARY KEY,
  period_from       TEXT NOT NULL,
  period_to         TEXT NOT NULL,
  net_amount        INTEGER NOT NULL,
  reference_no      TEXT,
  status            TEXT NOT NULL,
  filed_at          TEXT NOT NULL,
  filed_by          TEXT NOT NULL,
  amended_at        TEXT,
  amendment_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_vat_filing_window ON vat_filing(period_from, period_to);
`;

interface FilingRow {
  id: string;
  period_from: string;
  period_to: string;
  net_amount: bigint;
  reference_no: string | null;
  status: string;
  filed_at: string;
  filed_by: string;
  amended_at: string | null;
  amendment_reason: string | null;
}

function toFiling(row: FilingRow): VatFiling {
  return {
    id: row.id,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    netAmount: Money.fromScaled(row.net_amount),
    referenceNo: row.reference_no,
    status: row.status as VatFilingStatus,
    filedAt: row.filed_at,
    filedBy: row.filed_by,
    amendedAt: row.amended_at,
    amendmentReason: row.amendment_reason,
  };
}

const UPSERT = `
  INSERT INTO vat_filing
    (id, period_from, period_to, net_amount, reference_no, status, filed_at, filed_by, amended_at, amendment_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    period_from = excluded.period_from, period_to = excluded.period_to,
    net_amount = excluded.net_amount, reference_no = excluded.reference_no,
    status = excluded.status, filed_at = excluded.filed_at, filed_by = excluded.filed_by,
    amended_at = excluded.amended_at, amendment_reason = excluded.amendment_reason`;

function params(filing: VatFiling): SqlValue[] {
  return [
    filing.id,
    filing.periodFrom,
    filing.periodTo,
    filing.netAmount.scaled,
    filing.referenceNo,
    filing.status,
    filing.filedAt,
    filing.filedBy,
    filing.amendedAt,
    filing.amendmentReason,
  ];
}

class SqlVatFilingStore implements VatFilingRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<VatFiling | null> {
    const row = await this.db.get<FilingRow>(`SELECT * FROM vat_filing WHERE id = ?`, [id]);
    return row ? toFiling(row) : null;
  }

  async list(): Promise<readonly VatFiling[]> {
    return (await this.db.all<FilingRow>(`SELECT * FROM vat_filing ORDER BY period_from DESC`)).map(toFiling);
  }

  async findCovering(date: string): Promise<readonly VatFiling[]> {
    // Day versus instant: compared as an instant, `period_to >= ?` missed the
    // period's last day and let a posting into a FILED period through.
    const day = calendarDay(date);
    return (await this.db.all<FilingRow>(`SELECT * FROM vat_filing WHERE period_from <= ? AND period_to >= ?`, [day, day])).map(toFiling);
  }

  async save(filing: VatFiling): Promise<void> {
    await this.db.run(UPSERT, params(filing));
  }

  async insert(filing: VatFiling): Promise<void> {
    await insertNew(this.db, filing.id, UPSERT, params(filing));
  }
}

export async function ensureVatFilingSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createVatFilingStore(db: SqlDb): VatFilingRepository {
  return new SqlVatFilingStore(db);
}

export function createSqliteVatFilingStore(sqlite: Database.Database): VatFilingRepository {
  sqlite.exec(CREATE_TABLE);
  return createVatFilingStore(sqliteDb(sqlite));
}
