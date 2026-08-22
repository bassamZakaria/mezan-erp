import Database from "better-sqlite3";
import {
  Money,
  Qty,
  type HistoricalPurchaseArchive,
  type HistoricalPurchaseArchiveLine,
  type HistoricalPurchaseArchiveRepository,
  type HistoricalPurchaseDocType,
} from "@mezan/domain";

/**
 * SQLite store for the historical purchase-document archive (docs/catalog/02
 * §"استيراد فواتير سابقة" / §"استيراد مرتجعات سابقة") — one row per archived
 * document (lines as JSON, document-owned), following the same
 * standalone-store pattern as purchasing-stores.ts.
 */

const CREATE_ARCHIVE = `
CREATE TABLE IF NOT EXISTS historical_purchase_archive (
  id                TEXT PRIMARY KEY,
  doc_type          TEXT NOT NULL,
  original_number   TEXT NOT NULL,
  supplier_id       TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_hpa_original ON historical_purchase_archive(doc_type, original_number);
CREATE INDEX IF NOT EXISTS idx_hpa_batch ON historical_purchase_archive(import_batch_id);
`;

interface ArchiveRow {
  id: string;
  doc_type: string;
  original_number: string;
  supplier_id: string;
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

function toDomain(row: ArchiveRow): HistoricalPurchaseArchive {
  const lines = (
    JSON.parse(row.lines) as { itemId: string | null; description: string | null; qty: string; unitCost: string }[]
  ).map<HistoricalPurchaseArchiveLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    qty: Qty.fromMajor(l.qty),
    unitCost: Money.fromMajor(l.unitCost),
  }));
  return {
    id: row.id,
    docType: row.doc_type as HistoricalPurchaseDocType,
    originalNumber: row.original_number,
    supplierId: row.supplier_id,
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

class SqliteHistoricalPurchaseArchiveStore implements HistoricalPurchaseArchiveRepository {
  private readonly insert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByOriginal: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO historical_purchase_archive
        (id, doc_type, original_number, supplier_id, date, due_date, lines, total, amount_paid, remaining_balance, settled, import_batch_id, created_by, created_at)
      VALUES
        (@id, @doc_type, @original_number, @supplier_id, @date, @due_date, @lines, @total, @amount_paid, @remaining_balance, @settled, @import_batch_id, @created_by, @created_at)
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM historical_purchase_archive WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM historical_purchase_archive`);
    this.selectByOriginal = sqlite.prepare(
      `SELECT * FROM historical_purchase_archive WHERE doc_type = ? AND original_number = ?`,
    );
  }

  async create(archive: HistoricalPurchaseArchive): Promise<void> {
    this.insert.run({
      id: archive.id,
      doc_type: archive.docType,
      original_number: archive.originalNumber,
      supplier_id: archive.supplierId,
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
  async list(): Promise<HistoricalPurchaseArchive[]> {
    return (this.selectAll.all() as ArchiveRow[]).map(toDomain);
  }
  async findById(id: string): Promise<HistoricalPurchaseArchive | null> {
    const row = this.selectById.get(id) as ArchiveRow | undefined;
    return row ? toDomain(row) : null;
  }
  async findByOriginalNumber(
    docType: HistoricalPurchaseDocType,
    originalNumber: string,
  ): Promise<HistoricalPurchaseArchive | null> {
    const row = this.selectByOriginal.get(docType, originalNumber) as ArchiveRow | undefined;
    return row ? toDomain(row) : null;
  }
}

export interface SqliteHistoricalPurchaseArchiveStoreHandle extends HistoricalPurchaseArchiveRepository {
  close(): void;
}

/** Open a SQLite-backed HistoricalPurchaseArchiveRepository. ":memory:" for tests, a path for real. */
export function createSqliteHistoricalPurchaseArchiveStore(
  path = ":memory:",
): SqliteHistoricalPurchaseArchiveStoreHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(CREATE_ARCHIVE);
  return Object.assign(new SqliteHistoricalPurchaseArchiveStore(sqlite), { close: () => sqlite.close() });
}
