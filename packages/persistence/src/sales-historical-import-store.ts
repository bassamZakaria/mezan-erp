import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type HistoricalSalesArchive,
  type HistoricalSalesArchiveLine,
  type HistoricalSalesArchiveRepository,
  type HistoricalSalesDocType,
} from "@mezan/domain";

/**
 * SQLite store for the historical sales-document archive (docs/archive/catalog/01
 * §"استيراد فواتير سابقة" / §"استيراد مرتجعات سابقة") — one row per archived
 * document (lines as JSON, document-owned), following the same
 * standalone-store pattern as historical-import-store.ts.
 */

const CREATE_ARCHIVE = `
CREATE TABLE IF NOT EXISTS historical_sales_archive (
  id                TEXT PRIMARY KEY,
  doc_type          TEXT NOT NULL,
  original_number   TEXT NOT NULL,
  customer_id       TEXT NOT NULL,
  date              TEXT NOT NULL,
  due_date          TEXT,
  lines             TEXT NOT NULL,
  total             TEXT NOT NULL,
  amount_paid       TEXT NOT NULL,
  remaining_balance TEXT NOT NULL,
  settled           INTEGER NOT NULL,
  import_batch_id   TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hsa_original ON historical_sales_archive(doc_type, original_number);
CREATE INDEX IF NOT EXISTS idx_hsa_batch ON historical_sales_archive(import_batch_id);
`;

interface ArchiveRow {
  id: string;
  doc_type: string;
  original_number: string;
  customer_id: string;
  date: string;
  due_date: string | null;
  lines: string;
  total: string;
  amount_paid: string;
  remaining_balance: string;
  settled: bigint;
  import_batch_id: string;
  created_by: string;
  created_at: string;
}

function toDomain(row: ArchiveRow): HistoricalSalesArchive {
  const lines = (
    JSON.parse(row.lines) as { itemId: string | null; description: string | null; qty: string; unitCost: string }[]
  ).map<HistoricalSalesArchiveLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    qty: Qty.fromMajor(l.qty),
    unitCost: Money.fromMajor(l.unitCost),
  }));
  return {
    id: row.id,
    docType: row.doc_type as HistoricalSalesDocType,
    originalNumber: row.original_number,
    customerId: row.customer_id,
    date: row.date,
    dueDate: row.due_date,
    lines,
    total: Money.fromMajor(row.total),
    amountPaid: Money.fromMajor(row.amount_paid),
    remainingBalance: Money.fromMajor(row.remaining_balance),
    settled: Number(row.settled) === 1,
    importBatchId: row.import_batch_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class SqlHistoricalSalesArchiveStore implements HistoricalSalesArchiveRepository {
  constructor(private readonly db: SqlDb) {}

  async create(archive: HistoricalSalesArchive): Promise<void> {
    await this.db.run(
      `INSERT INTO historical_sales_archive
         (id, doc_type, original_number, customer_id, date, due_date, lines, total, amount_paid, remaining_balance, settled, import_batch_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        archive.id,
        archive.docType,
        archive.originalNumber,
        archive.customerId,
        archive.date,
        archive.dueDate,
        JSON.stringify(
          archive.lines.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            qty: l.qty.toString(),
            unitCost: l.unitCost.toString(),
          })),
        ),
        archive.total.toString(),
        archive.amountPaid.toString(),
        archive.remainingBalance.toString(),
        archive.settled ? 1 : 0,
        archive.importBatchId,
        archive.createdBy,
        archive.createdAt,
      ],
    );
  }
  async list(): Promise<HistoricalSalesArchive[]> {
    return (await this.db.all<ArchiveRow>(`SELECT * FROM historical_sales_archive`)).map(toDomain);
  }
  async findById(id: string): Promise<HistoricalSalesArchive | null> {
    const row = await this.db.get<ArchiveRow>(`SELECT * FROM historical_sales_archive WHERE id = ?`, [id]);
    return row ? toDomain(row) : null;
  }
  async findByOriginalNumber(
    docType: HistoricalSalesDocType,
    originalNumber: string,
  ): Promise<HistoricalSalesArchive | null> {
    const row = await this.db.get<ArchiveRow>(`SELECT * FROM historical_sales_archive WHERE doc_type = ? AND original_number = ?`, [docType, originalNumber]);
    return row ? toDomain(row) : null;
  }
}

export interface SqliteHistoricalSalesArchiveStoreHandle extends HistoricalSalesArchiveRepository {
  close(): void;
}

export async function ensureHistoricalSalesArchiveSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_ARCHIVE);
}

export function createHistoricalSalesArchiveStore(db: SqlDb): HistoricalSalesArchiveRepository {
  return new SqlHistoricalSalesArchiveStore(db);
}

/** Open a SQLite-backed HistoricalSalesArchiveRepository. ":memory:" for tests, a path for real. */
export function createSqliteHistoricalSalesArchiveStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteHistoricalSalesArchiveStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ARCHIVE);
  return Object.assign(createHistoricalSalesArchiveStore(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}
