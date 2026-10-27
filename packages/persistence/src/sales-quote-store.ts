import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import { childRowsByParentAsync } from "./list-query.js";
import { addVersionColumns, createSqlDocumentVersionStore, type DocumentVersionStore } from "./document-version.js";
import { TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type SalesQuote,
  type SalesQuoteDiscount,
  type SalesQuoteLine,
  type SalesQuoteListFilter,
  type SalesQuoteRepository,
  type SalesQuoteStatus,
} from "@mezan/domain";

/**
 * SQLite-backed {@link SalesQuoteRepository} — header + child-lines pattern
 * (mirrors {@link import("./sales-invoice-store.js").createSqliteSalesInvoiceStore},
 * simplified: no warehouse/GL-account columns, no journal-entry/workflow
 * columns — a quote never posts). Money and Qty columns are INTEGER at each
 * value object's fixed 1e-6 scale, never REAL. `update()` mirrors a
 * send/accept/reject/cancel/convert cycle: it replaces the header row and
 * fully re-inserts the lines.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS sales_quote (
  id                     TEXT PRIMARY KEY,
  doc_type               TEXT NOT NULL,
  doc_no                 TEXT,
  status                 TEXT NOT NULL,
  date                   TEXT NOT NULL,
  expiry_date            TEXT NOT NULL,
  customer_id            TEXT NOT NULL,
  customer_name_ar       TEXT NOT NULL,
  customer_tax_exempt    INTEGER NOT NULL,
  branch_id              TEXT NOT NULL,
  opportunity_id         TEXT,
  currency               TEXT NOT NULL,
  notes                  TEXT,
  internal_notes         TEXT,
  discount_type          TEXT NOT NULL,
  discount_percent       REAL,
  discount_amount        INTEGER,
  price_list_id          TEXT,
  coupon_code            TEXT,
  created_at             TEXT NOT NULL,
  sent_at                TEXT,
  responded_at           TEXT,
  converted_at           TEXT,
  converted_invoice_id   TEXT,
  version                INTEGER NOT NULL DEFAULT 1,
  last_modified_by       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_quote_doc_no ON sales_quote(doc_no) WHERE doc_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_quote_status ON sales_quote(status);
CREATE INDEX IF NOT EXISTS idx_sales_quote_customer ON sales_quote(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_quote_date ON sales_quote(date);
CREATE TABLE IF NOT EXISTS sales_quote_line (
  quote_id             TEXT NOT NULL REFERENCES sales_quote(id),
  line_no              INTEGER NOT NULL,
  line_id              TEXT NOT NULL,
  item_id              TEXT NOT NULL,
  item_name_ar         TEXT NOT NULL,
  qty                  INTEGER NOT NULL,
  unit_price           INTEGER NOT NULL,
  discount_percent     REAL NOT NULL,
  tax_rate_percent     REAL NOT NULL,
  tax_rate_id          TEXT,
  PRIMARY KEY (quote_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_sales_quote_line_quote ON sales_quote_line(quote_id);
`;

const CREATE_LATE_INDEXES = `CREATE INDEX IF NOT EXISTS idx_sales_quote_opportunity ON sales_quote(opportunity_id)`;

interface QuoteRow {
  id: string;
  doc_type: string;
  doc_no: string | null;
  status: string;
  date: string;
  expiry_date: string;
  customer_id: string;
  customer_name_ar: string;
  customer_tax_exempt: bigint;
  branch_id: string;
  opportunity_id: string | null;
  currency: string;
  notes: string | null;
  internal_notes: string | null;
  discount_type: string;
  discount_percent: number | null;
  discount_amount: bigint | null;
  price_list_id: string | null;
  coupon_code: string | null;
  created_at: string;
  sent_at: string | null;
  responded_at: string | null;
  converted_at: string | null;
  converted_invoice_id: string | null;
}

interface LineRow {
  line_id: string;
  item_id: string;
  item_name_ar: string;
  qty: bigint;
  unit_price: bigint;
  discount_percent: number;
  tax_rate_percent: number;
  tax_rate_id: string | null;
}

function toDiscount(row: QuoteRow): SalesQuoteDiscount {
  if (row.discount_type === "percent") {
    return { type: "percent", percent: row.discount_percent ?? 0 };
  }
  return { type: "amount", amount: Money.fromScaled(row.discount_amount ?? 0n) };
}

function toLine(row: LineRow): SalesQuoteLine {
  return {
    lineId: row.line_id,
    itemId: row.item_id,
    itemNameAr: row.item_name_ar,
    qty: Qty.fromScaled(row.qty),
    unitPrice: Money.fromScaled(row.unit_price),
    discountPercent: row.discount_percent,
    taxRatePercent: row.tax_rate_percent,
    taxRateId: row.tax_rate_id ?? null,
  };
}

const QUOTE_COLUMNS = [
  "doc_type", "doc_no", "status", "date", "expiry_date", "customer_id", "customer_name_ar",
  "customer_tax_exempt", "branch_id", "opportunity_id", "currency", "notes", "internal_notes",
  "discount_type", "discount_percent", "discount_amount", "price_list_id", "coupon_code",
  "created_at", "sent_at", "responded_at", "converted_at", "converted_invoice_id",
] as const;

function quoteParams(quote: SalesQuote): SqlValue[] {
  return [
    quote.docType,
    quote.docNo,
    quote.status,
    quote.date,
    quote.expiryDate,
    quote.customerId,
    quote.customerNameAr,
    quote.customerTaxExempt ? 1 : 0,
    quote.branchId,
    quote.opportunityId,
    quote.currency,
    quote.notes,
    quote.internalNotes,
    quote.discount.type,
    quote.discount.type === "percent" ? quote.discount.percent : null,
    quote.discount.type === "percent" ? null : quote.discount.amount.scaled,
    quote.priceListId,
    quote.couponCode,
    quote.createdAt,
    quote.sentAt,
    quote.respondedAt,
    quote.convertedAt,
    quote.convertedInvoiceId,
    quote.id,
  ];
}

const INSERT_QUOTE = `INSERT INTO sales_quote (${QUOTE_COLUMNS.join(", ")}, id)
  VALUES (${QUOTE_COLUMNS.map(() => "?").join(", ")}, ?)
  ON CONFLICT (id) DO NOTHING`;
const UPDATE_QUOTE = `UPDATE sales_quote SET ${QUOTE_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`;

class SqlSalesQuoteRepository implements SalesQuoteRepository {
  constructor(private readonly db: SqlDb, private readonly versions?: DocumentVersionStore) {}

  async save(quote: SalesQuote): Promise<void> {
    refuseUnlessInserted(quote.id, (await this.db.run(INSERT_QUOTE, quoteParams(quote))).changes);
    await this.insertLines(quote);
  }

  async update(quote: SalesQuote): Promise<void> {
    await this.db.run(UPDATE_QUOTE, quoteParams(quote));
    await this.db.run(`DELETE FROM sales_quote_line WHERE quote_id = ?`, [quote.id]);
    await this.insertLines(quote);
    // N-9: any write moves the version, whichever path made the change.
    await this.versions?.bump(quote.id);
  }

  async findById(id: string): Promise<SalesQuote | null> {
    const row = await this.db.get<QuoteRow>(`SELECT * FROM sales_quote WHERE id = ?`, [id]);
    return row ? this.hydrate(row) : null;
  }

  async list(filter: SalesQuoteListFilter = {}): Promise<readonly SalesQuote[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.customerId) {
      clauses.push("customer_id = ?");
      params.push(filter.customerId);
    }
    if (filter.opportunityId) {
      clauses.push("opportunity_id = ?");
      params.push(filter.opportunityId);
    }
    if (filter.fromDate) {
      clauses.push("date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("date <= ?");
      params.push(filter.toDate);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<QuoteRow>(`SELECT * FROM sales_quote ${where} ORDER BY date, created_at`, params);
    const linesByQuote = await childRowsByParentAsync<LineRow & { quote_id: string }>(this.db, {
      table: "sales_quote_line",
      parentColumn: "quote_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "quote_id, line_no",
      columns: "quote_id, line_id, item_id, item_name_ar, qty, unit_price, discount_percent, tax_rate_percent, tax_rate_id",
    });
    return Promise.all(rows.map((row) => this.hydrate(row, linesByQuote.get(row.id) ?? [])));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn, TransactionMode.Immediate);
  }

  private async insertLines(quote: SalesQuote): Promise<void> {
    for (const [index, line] of quote.lines.entries()) {
      await this.db.run(
        `INSERT INTO sales_quote_line (
          quote_id, line_no, line_id, item_id, item_name_ar, qty, unit_price,
          discount_percent, tax_rate_percent, tax_rate_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quote.id,
          index,
          line.lineId,
          line.itemId,
          line.itemNameAr,
          line.qty.scaled,
          line.unitPrice.scaled,
          line.discountPercent,
          line.taxRatePercent,
          line.taxRateId,
        ],
      );
    }
  }

  private async hydrate(row: QuoteRow, preloadedLines?: readonly LineRow[]): Promise<SalesQuote> {
    const lineRows =
      preloadedLines ??
      (await this.db.all<LineRow>(
        `SELECT line_id, item_id, item_name_ar, qty, unit_price, discount_percent, tax_rate_percent, tax_rate_id
           FROM sales_quote_line WHERE quote_id = ? ORDER BY line_no`,
        [row.id],
      ));
    return {
      id: row.id,
      docType: row.doc_type as SalesQuote["docType"],
      docNo: row.doc_no,
      status: row.status as SalesQuoteStatus,
      date: row.date,
      expiryDate: row.expiry_date,
      customerId: row.customer_id,
      customerNameAr: row.customer_name_ar,
      customerTaxExempt: Number(row.customer_tax_exempt) === 1,
      branchId: row.branch_id,
      opportunityId: row.opportunity_id,
      currency: row.currency,
      notes: row.notes,
      internalNotes: row.internal_notes,
      discount: toDiscount(row),
      priceListId: row.price_list_id,
      couponCode: row.coupon_code,
      lines: lineRows.map(toLine),
      createdAt: row.created_at,
      sentAt: row.sent_at,
      respondedAt: row.responded_at,
      convertedAt: row.converted_at,
      convertedInvoiceId: row.converted_invoice_id,
    };
  }
}

export interface SalesQuoteStoreHandle extends SalesQuoteRepository {
  /** N-9 — the row version an optimistic update compares against. */
  readonly versions: DocumentVersionStore;
}

export interface SqliteSalesQuoteStoreHandle extends SalesQuoteStoreHandle {
  close(): void;
}

export async function ensureSalesQuoteSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
  await db.applySchema(CREATE_LATE_INDEXES);
}

export function createSalesQuoteStore(db: SqlDb): SalesQuoteStoreHandle {
  const versions = createSqlDocumentVersionStore(db, "sales_quote");
  return Object.assign(new SqlSalesQuoteRepository(db, versions), { versions });
}

/** Open a SQLite-backed SalesQuoteRepository. ":memory:" for tests, a path for real. */
export function createSqliteSalesQuoteStore(path: SqliteConnectionInput = ":memory:"): SqliteSalesQuoteStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  const lineColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(sales_quote_line)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!lineColumns.has("tax_rate_id")) sqlite.exec(`ALTER TABLE sales_quote_line ADD COLUMN tax_rate_id TEXT`);
  const quoteColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(sales_quote)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!quoteColumns.has("opportunity_id")) sqlite.exec(`ALTER TABLE sales_quote ADD COLUMN opportunity_id TEXT`);
  sqlite.exec(CREATE_LATE_INDEXES);
  addVersionColumns(sqlite, "sales_quote");
  return Object.assign(createSalesQuoteStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  });
}
