import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  Qty,
  type HistoricalSalesArchive,
  type HistoricalSalesArchiveLine,
  type HistoricalSalesArchiveRepository,
  type HistoricalSalesDocType,
} from "@mezan/domain";

/**
 * SQLite store for the historical sales-document archive (docs/catalog/01
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
  settled: number;
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
    settled: row.settled === 1,
    importBatchId: row.import_batch_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class SqliteHistoricalSalesArchiveStore implements HistoricalSalesArchiveRepository {
  private readonly insert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByOriginal: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO historical_sales_archive
        (id, doc_type, original_number, customer_id, date, due_date, lines, total, amount_paid, remaining_balance, settled, import_batch_id, created_by, created_at)
      VALUES
        (@id, @doc_type, @original_number, @customer_id, @date, @due_date, @lines, @total, @amount_paid, @remaining_balance, @settled, @import_batch_id, @created_by, @created_at)
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM historical_sales_archive WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM historical_sales_archive`);
    this.selectByOriginal = sqlite.prepare(
      `SELECT * FROM historical_sales_archive WHERE doc_type = ? AND original_number = ?`,
    );
  }

  async create(archive: HistoricalSalesArchive): Promise<void> {
    this.insert.run({
      id: archive.id,
      doc_type: archive.docType,
      original_number: archive.originalNumber,
      customer_id: archive.customerId,
      date: archive.date,
      due_date: archive.dueDate,
      lines: JSON.stringify(
        archive.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          qty: l.qty.toString(),
          unitCost: l.unitCost.toString(),
        })),
      ),
      total: archive.total.toString(),
      amount_paid: archive.amountPaid.toString(),
      remaining_balance: archive.remainingBalance.toString(),
      settled: archive.settled ? 1 : 0,
      import_batch_id: archive.importBatchId,
      created_by: archive.createdBy,
      created_at: archive.createdAt,
    });
  }
  async list(): Promise<HistoricalSalesArchive[]> {
    return (this.selectAll.all() as ArchiveRow[]).map(toDomain);
  }
  async findById(id: string): Promise<HistoricalSalesArchive | null> {
    const row = this.selectById.get(id) as ArchiveRow | undefined;
    return row ? toDomain(row) : null;
  }
  async findByOriginalNumber(
    docType: HistoricalSalesDocType,
    originalNumber: string,
  ): Promise<HistoricalSalesArchive | null> {
    const row = this.selectByOriginal.get(docType, originalNumber) as ArchiveRow | undefined;
    return row ? toDomain(row) : null;
  }
}

export interface SqliteHistoricalSalesArchiveStoreHandle extends HistoricalSalesArchiveRepository {
  close(): void;
}

/** Open a SQLite-backed HistoricalSalesArchiveRepository. ":memory:" for tests, a path for real. */
export function createSqliteHistoricalSalesArchiveStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteHistoricalSalesArchiveStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ARCHIVE);
  return Object.assign(new SqliteHistoricalSalesArchiveStore(sqlite), { close: () => { if (owned) sqlite.close(); } });
}
