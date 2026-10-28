import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew, refuseUnlessInserted } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type PurchaseRfq,
  type PurchaseRfqLine,
  type PurchaseRfqRepository,
  type PurchaseRfqStatus,
  type RfqQuote,
  type RfqQuoteLine,
  type RfqQuoteRepository,
} from "@mezan/domain";

/**
 * SQLite stores for طلبات عروض الأسعار (RFQs, docs/archive/catalog/02) — an RFQ
 * header + its requested lines (JSON, document-owned) and the separate
 * supplier-quotes table (one row per submitted quote, also JSON lines),
 * following the same standalone-store pattern as purchasing-stores.ts.
 */

// --- RFQ ---------------------------------------------------------------

const CREATE_RFQ = `
CREATE TABLE IF NOT EXISTS purchase_rfq (
  id                TEXT PRIMARY KEY,
  number            TEXT NOT NULL UNIQUE,
  date              TEXT NOT NULL,
  required_by_date  TEXT,
  branch_id         TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  notes             TEXT,
  lines             TEXT NOT NULL,
  status            TEXT NOT NULL,
  purchase_order_id TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
`;

interface RfqRow {
  id: string;
  number: string;
  date: string;
  required_by_date: string | null;
  branch_id: string;
  warehouse_id: string;
  notes: string | null;
  lines: string;
  status: string;
  purchase_order_id: string | null;
  created_by: string;
  created_at: string;
}

function rfqToDomain(row: RfqRow): PurchaseRfq {
  const lines = (
    JSON.parse(row.lines) as { itemId: string; description: string | null; qty: string; notes: string | null }[]
  ).map<PurchaseRfqLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    qty: Qty.fromMajor(l.qty),
    notes: l.notes,
  }));
  return {
    id: row.id,
    number: row.number,
    date: row.date,
    requiredByDate: row.required_by_date,
    branchId: row.branch_id,
    warehouseId: row.warehouse_id,
    notes: row.notes,
    lines,
    status: row.status as PurchaseRfqStatus,
    purchaseOrderId: row.purchase_order_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const UPSERT_RFQ = `INSERT INTO purchase_rfq (id, number, date, required_by_date, branch_id, warehouse_id, notes, lines, status, purchase_order_id, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    date = excluded.date, required_by_date = excluded.required_by_date, branch_id = excluded.branch_id,
    warehouse_id = excluded.warehouse_id, notes = excluded.notes, lines = excluded.lines,
    status = excluded.status, purchase_order_id = excluded.purchase_order_id`;

function rfqParams(r: PurchaseRfq): SqlValue[] {
  return [
    r.id,
    r.number,
    r.date,
    r.requiredByDate,
    r.branchId,
    r.warehouseId,
    r.notes,
    JSON.stringify(
      r.lines.map((l) => ({
        itemId: l.itemId,
        description: l.description,
        qty: l.qty.toString(),
        notes: l.notes,
      })),
    ),
    r.status,
    r.purchaseOrderId,
    r.createdBy,
    r.createdAt,
  ];
}

class SqlPurchaseRfqStore implements PurchaseRfqRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<PurchaseRfq | null> {
    const row = await this.db.get<RfqRow>(`SELECT * FROM purchase_rfq WHERE id = ?`, [id]);
    return row ? rfqToDomain(row) : null;
  }
  async list(): Promise<PurchaseRfq[]> {
    return (await this.db.all<RfqRow>(`SELECT * FROM purchase_rfq`)).map(rfqToDomain);
  }
  async create(rfq: PurchaseRfq): Promise<void> {
    await insertNew(this.db, rfq.id, UPSERT_RFQ, rfqParams(rfq));
  }
  async update(rfq: PurchaseRfq): Promise<void> {
    await this.db.run(UPSERT_RFQ, rfqParams(rfq));
  }
}

// --- RFQ Quote -----------------------------------------------------------

const CREATE_RFQ_QUOTE = `
CREATE TABLE IF NOT EXISTS rfq_quote (
  id           TEXT PRIMARY KEY,
  rfq_id       TEXT NOT NULL,
  supplier_id  TEXT NOT NULL,
  lines        TEXT NOT NULL,
  notes        TEXT,
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfq_quote_rfq ON rfq_quote(rfq_id);
`;

interface RfqQuoteRow {
  id: string;
  rfq_id: string;
  supplier_id: string;
  lines: string;
  notes: string | null;
  submitted_at: string;
}

function quoteToDomain(row: RfqQuoteRow): RfqQuote {
  const lines = (
    JSON.parse(row.lines) as { itemId: string; unitPrice: string; notes: string | null }[]
  ).map<RfqQuoteLine>((l) => ({
    itemId: l.itemId,
    unitPrice: Money.fromMajor(l.unitPrice),
    notes: l.notes,
  }));
  return {
    id: row.id,
    rfqId: row.rfq_id,
    supplierId: row.supplier_id,
    lines,
    notes: row.notes,
    submittedAt: row.submitted_at,
  };
}

class SqlRfqQuoteStore implements RfqQuoteRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<RfqQuote | null> {
    const row = await this.db.get<RfqQuoteRow>(`SELECT * FROM rfq_quote WHERE id = ?`, [id]);
    return row ? quoteToDomain(row) : null;
  }
  async listByRfq(rfqId: string): Promise<RfqQuote[]> {
    return (await this.db.all<RfqQuoteRow>(`SELECT * FROM rfq_quote WHERE rfq_id = ?`, [rfqId])).map(quoteToDomain);
  }
  async create(quote: RfqQuote): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO rfq_quote (id, rfq_id, supplier_id, lines, notes, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        quote.id,
        quote.rfqId,
        quote.supplierId,
        JSON.stringify(quote.lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice.toString(), notes: l.notes }))),
        quote.notes,
        quote.submittedAt,
      ],
    );
    refuseUnlessInserted(quote.id, inserted.changes);
  }
}

// --- Factory ---------------------------------------------------------------

export interface RfqStores {
  readonly rfqs: PurchaseRfqRepository;
  readonly quotes: RfqQuoteRepository;
}

export interface SqliteRfqStores extends RfqStores {
  close(): void;
}

export async function ensureRfqSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_RFQ);
  await db.applySchema(CREATE_RFQ_QUOTE);
}

export function createRfqStores(db: SqlDb): RfqStores {
  return { rfqs: new SqlPurchaseRfqStore(db), quotes: new SqlRfqQuoteStore(db) };
}

/** Open the RFQ + RFQ-quote stores on ONE shared connection. */
export function createSqliteRfqStores(path: SqliteConnectionInput = ":memory:"): SqliteRfqStores {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_RFQ);
  sqlite.exec(CREATE_RFQ_QUOTE);
  return {
    ...createRfqStores(sqliteDb(sqlite)),
    close: () => { if (owned) sqlite.close(); },
  };
}
