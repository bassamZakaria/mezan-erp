import type Database from "better-sqlite3";
import { Money, type VatFiling, type VatFilingRepository, type VatFilingStatus } from "@mezan/domain";

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
  net_amount: number;
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

class SqliteVatFilingStore implements VatFilingRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectCovering: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO vat_filing
        (id, period_from, period_to, net_amount, reference_no, status, filed_at, filed_by, amended_at, amendment_reason)
      VALUES
        (@id, @period_from, @period_to, @net_amount, @reference_no, @status, @filed_at, @filed_by, @amended_at, @amendment_reason)
      ON CONFLICT(id) DO UPDATE SET
        period_from = excluded.period_from, period_to = excluded.period_to,
        net_amount = excluded.net_amount, reference_no = excluded.reference_no,
        status = excluded.status, filed_at = excluded.filed_at, filed_by = excluded.filed_by,
        amended_at = excluded.amended_at, amendment_reason = excluded.amendment_reason
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM vat_filing WHERE id = ?`).safeIntegers(false);
    this.selectAll = sqlite.prepare(`SELECT * FROM vat_filing ORDER BY period_from DESC`).safeIntegers(false);
    this.selectCovering = sqlite
      .prepare(`SELECT * FROM vat_filing WHERE period_from <= ? AND period_to >= ?`)
      .safeIntegers(false);
  }

  async findById(id: string): Promise<VatFiling | null> {
    const row = this.selectById.get(id) as FilingRow | undefined;
    return row ? toFiling(row) : null;
  }

  async list(): Promise<readonly VatFiling[]> {
    return (this.selectAll.all() as FilingRow[]).map(toFiling);
  }

  async findCovering(date: string): Promise<readonly VatFiling[]> {
    return (this.selectCovering.all(date, date) as FilingRow[]).map(toFiling);
  }

  async save(filing: VatFiling): Promise<void> {
    this.upsert.run({
      id: filing.id,
      period_from: filing.periodFrom,
      period_to: filing.periodTo,
      net_amount: filing.netAmount.toScaledNumber(),
      reference_no: filing.referenceNo,
      status: filing.status,
      filed_at: filing.filedAt,
      filed_by: filing.filedBy,
      amended_at: filing.amendedAt,
      amendment_reason: filing.amendmentReason,
    });
  }
}

export function createSqliteVatFilingStore(sqlite: Database.Database): VatFilingRepository {
  sqlite.exec(CREATE_TABLE);
  return new SqliteVatFilingStore(sqlite);
}
