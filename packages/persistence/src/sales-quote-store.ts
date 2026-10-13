import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { childRowsByParent } from "./list-query.js";
import { addVersionColumns, createDocumentVersionStore, type DocumentVersionStore } from "./document-version.js";
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
  converted_invoice_id   TEXT
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

interface QuoteRow {
  id: string;
  doc_type: string;
  doc_no: string | null;
  status: string;
  date: string;
  expiry_date: string;
  customer_id: string;
  customer_name_ar: string;
  customer_tax_exempt: number;
  branch_id: string;
  currency: string;
  notes: string | null;
  internal_notes: string | null;
  discount_type: string;
  discount_percent: number | null;
  discount_amount: number | null;
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
  return { type: "amount", amount: Money.fromScaled(row.discount_amount ?? 0) };
}

function toLine(row: LineRow): SalesQuoteLine {
  return {
    lineId: row.line_id,
    itemId: row.item_id,
    itemNameAr: row.item_name_ar,
    // The line SELECT uses .safeIntegers(), so INTEGER columns arrive as bigint.
    qty: Qty.fromScaled(row.qty),
    unitPrice: Money.fromScaled(row.unit_price),
    discountPercent: row.discount_percent,
    taxRatePercent: row.tax_rate_percent,
    taxRateId: row.tax_rate_id ?? null,
  };
}

function quoteParams(quote: SalesQuote) {
  const isPercent = quote.discount.type === "percent";
  return {
    id: quote.id,
    doc_type: quote.docType,
    doc_no: quote.docNo,
    status: quote.status,
    date: quote.date,
    expiry_date: quote.expiryDate,
    customer_id: quote.customerId,
    customer_name_ar: quote.customerNameAr,
    customer_tax_exempt: quote.customerTaxExempt ? 1 : 0,
    branch_id: quote.branchId,
    currency: quote.currency,
    notes: quote.notes,
    internal_notes: quote.internalNotes,
    discount_type: quote.discount.type,
    discount_percent: isPercent ? quote.discount.percent : null,
    discount_amount: isPercent ? null : quote.discount.amount.toScaledNumber(),
    price_list_id: quote.priceListId,
    coupon_code: quote.couponCode,
    created_at: quote.createdAt,
    sent_at: quote.sentAt,
    responded_at: quote.respondedAt,
    converted_at: quote.convertedAt,
    converted_invoice_id: quote.convertedInvoiceId,
  };
}

class SqliteSalesQuoteRepository implements SalesQuoteRepository {
  private readonly insertQuote: Database.Statement;
  private readonly updateQuote: Database.Statement;
  private readonly deleteLines: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly selectQuoteById: Database.Statement;
  private readonly selectLines: Database.Statement;

  constructor(private readonly sqlite: Database.Database, private readonly versions?: DocumentVersionStore) {
    this.insertQuote = sqlite.prepare(`
      INSERT INTO sales_quote (
        id, doc_type, doc_no, status, date, expiry_date, customer_id, customer_name_ar,
        customer_tax_exempt, branch_id, currency, notes, internal_notes,
        discount_type, discount_percent, discount_amount, price_list_id, coupon_code,
        created_at, sent_at, responded_at, converted_at, converted_invoice_id
      ) VALUES (
        @id, @doc_type, @doc_no, @status, @date, @expiry_date, @customer_id, @customer_name_ar,
        @customer_tax_exempt, @branch_id, @currency, @notes, @internal_notes,
        @discount_type, @discount_percent, @discount_amount, @price_list_id, @coupon_code,
        @created_at, @sent_at, @responded_at, @converted_at, @converted_invoice_id
      )
    `);
    this.updateQuote = sqlite.prepare(`
      UPDATE sales_quote SET
        doc_type = @doc_type,
        doc_no = @doc_no,
        status = @status,
        date = @date,
        expiry_date = @expiry_date,
        customer_id = @customer_id,
        customer_name_ar = @customer_name_ar,
        customer_tax_exempt = @customer_tax_exempt,
        branch_id = @branch_id,
        currency = @currency,
        notes = @notes,
        internal_notes = @internal_notes,
        discount_type = @discount_type,
        discount_percent = @discount_percent,
        discount_amount = @discount_amount,
        price_list_id = @price_list_id,
        coupon_code = @coupon_code,
        created_at = @created_at,
        sent_at = @sent_at,
        responded_at = @responded_at,
        converted_at = @converted_at,
        converted_invoice_id = @converted_invoice_id
      WHERE id = @id
    `);
    this.deleteLines = sqlite.prepare(`DELETE FROM sales_quote_line WHERE quote_id = ?`);
    this.insertLine = sqlite.prepare(`
      INSERT INTO sales_quote_line (
        quote_id, line_no, line_id, item_id, item_name_ar, qty, unit_price,
        discount_percent, tax_rate_percent, tax_rate_id
      ) VALUES (
        @quote_id, @line_no, @line_id, @item_id, @item_name_ar, @qty, @unit_price,
        @discount_percent, @tax_rate_percent, @tax_rate_id
      )
    `);
    this.selectQuoteById = sqlite.prepare(`SELECT * FROM sales_quote WHERE id = ?`);
    this.selectLines = sqlite
      .prepare(
        `SELECT line_id, item_id, item_name_ar, qty, unit_price, discount_percent, tax_rate_percent, tax_rate_id
           FROM sales_quote_line WHERE quote_id = ? ORDER BY line_no`,
      )
      .safeIntegers();
  }

  async save(quote: SalesQuote): Promise<void> {
    this.insertQuote.run(quoteParams(quote));
    this.insertLines(quote);
  }

  async update(quote: SalesQuote): Promise<void> {
    this.updateQuote.run(quoteParams(quote));
    this.deleteLines.run(quote.id);
    this.insertLines(quote);
    // N-9: any write moves the version, whichever path made the change.
    this.versions?.bump(quote.id);
  }

  async findById(id: string): Promise<SalesQuote | null> {
    const row = this.selectQuoteById.get(id) as QuoteRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async list(filter: SalesQuoteListFilter = {}): Promise<readonly SalesQuote[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.customerId) {
      clauses.push("customer_id = ?");
      params.push(filter.customerId);
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
    const rows = this.sqlite
      .prepare(`SELECT * FROM sales_quote ${where} ORDER BY date, created_at`)
      .all(...params) as QuoteRow[];
    // One query for the whole page's children, not one per parent row.
    const linesByQuote = childRowsByParent<LineRow & { quote_id: string }>(this.sqlite, {
      table: "sales_quote_line",
      parentColumn: "quote_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "quote_id, line_no",
      columns: "quote_id, line_id, item_id, item_name_ar, qty, unit_price, discount_percent, tax_rate_percent, tax_rate_id",
      safeIntegers: true,
    });
    return rows.map((row) => this.hydrate(row, linesByQuote.get(row.id) ?? []));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }

  private insertLines(quote: SalesQuote): void {
    quote.lines.forEach((line, index) => {
      this.insertLine.run({
        quote_id: quote.id,
        line_no: index,
        line_id: line.lineId,
        item_id: line.itemId,
        item_name_ar: line.itemNameAr,
        qty: line.qty.toScaledNumber(),
        unit_price: line.unitPrice.toScaledNumber(),
        discount_percent: line.discountPercent,
        tax_rate_percent: line.taxRatePercent,
        tax_rate_id: line.taxRateId,
      });
    });
  }

  private hydrate(row: QuoteRow, preloadedLines?: readonly LineRow[]): SalesQuote {
    const lineRows = preloadedLines ?? (this.selectLines.all(row.id) as LineRow[]);
    return {
      id: row.id,
      docType: row.doc_type as SalesQuote["docType"],
      docNo: row.doc_no,
      status: row.status as SalesQuoteStatus,
      date: row.date,
      expiryDate: row.expiry_date,
      customerId: row.customer_id,
      customerNameAr: row.customer_name_ar,
      customerTaxExempt: row.customer_tax_exempt === 1,
      branchId: row.branch_id,
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

export interface SqliteSalesQuoteStoreHandle extends SalesQuoteRepository {
  /** N-9 — the row version an optimistic update compares against. */
  readonly versions: DocumentVersionStore;
  close(): void;
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
  addVersionColumns(sqlite, "sales_quote");
  const versions = createDocumentVersionStore(sqlite, "sales_quote");
  const repo = new SqliteSalesQuoteRepository(sqlite, versions);
  return Object.assign(repo, {
    versions,
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSalesQuoteStoreHandle;
}
