import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type HistoricalPurchaseArchive,
  type HistoricalPurchaseArchiveLine,
  type HistoricalPurchaseArchiveRepository,
  type HistoricalPurchaseDocType,
} from "@mezan/domain";

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
  settled: bigint;
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
    settled: Number(row.settled) === 1,
    importBatchId: row.import_batch_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class SqlHistoricalPurchaseArchiveStore implements HistoricalPurchaseArchiveRepository {
  constructor(private readonly db: SqlDb) {}

  async create(archive: HistoricalPurchaseArchive): Promise<void> {
    await this.db.run(
      `INSERT INTO historical_purchase_archive
         (id, doc_type, original_number, supplier_id, date, due_date, lines, total, amount_paid, remaining_balance, settled, import_batch_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        archive.id,
        archive.docType,
        archive.originalNumber,
        archive.supplierId,
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
  async list(): Promise<HistoricalPurchaseArchive[]> {
    return (await this.db.all<ArchiveRow>(`SELECT * FROM historical_purchase_archive`)).map(toDomain);
  }
  async findById(id: string): Promise<HistoricalPurchaseArchive | null> {
    const row = await this.db.get<ArchiveRow>(`SELECT * FROM historical_purchase_archive WHERE id = ?`, [id]);
    return row ? toDomain(row) : null;
  }
  async findByOriginalNumber(
    docType: HistoricalPurchaseDocType,
    originalNumber: string,
  ): Promise<HistoricalPurchaseArchive | null> {
    const row = await this.db.get<ArchiveRow>(`SELECT * FROM historical_purchase_archive WHERE doc_type = ? AND original_number = ?`, [docType, originalNumber]);
    return row ? toDomain(row) : null;
  }
}

export interface SqliteHistoricalPurchaseArchiveStoreHandle extends HistoricalPurchaseArchiveRepository {
  close(): void;
}

export async function ensureHistoricalPurchaseArchiveSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_ARCHIVE);
}

export function createHistoricalPurchaseArchiveStore(db: SqlDb): HistoricalPurchaseArchiveRepository {
  return new SqlHistoricalPurchaseArchiveStore(db);
}

export function createSqliteHistoricalPurchaseArchiveStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteHistoricalPurchaseArchiveStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ARCHIVE);
  return Object.assign(createHistoricalPurchaseArchiveStore(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}
