import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  Qty,
  type SalesInvoice,
  type SalesInvoiceDiscount,
  type SalesInvoiceLine,
  type SalesInvoiceListFilter,
  type SalesInvoiceRepository,
  type SalesInvoiceStatus,
} from "@mezan/domain";

/**
 * SQLite-backed {@link SalesInvoiceRepository} — header + child-lines pattern
 * (like {@link import("./ledger-store.js").createSqliteLedgerStore}). Money and
 * Qty columns are INTEGER at each value object's fixed 1e-6 scale, never REAL.
 * `update()` mirrors a confirm/mutate cycle: it replaces the header row and
 * fully re-inserts the lines, since a confirming invoice can rewrite `unitCost`
 * on every line.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS sales_invoice (
  id                     TEXT PRIMARY KEY,
  doc_type               TEXT NOT NULL,
  doc_no                 TEXT,
  status                 TEXT NOT NULL,
  date                   TEXT NOT NULL,
  due_date               TEXT NOT NULL,
  customer_id            TEXT NOT NULL,
  customer_name_ar       TEXT NOT NULL,
  customer_tax_exempt    INTEGER NOT NULL,
  warehouse_id           TEXT NOT NULL,
  branch_id              TEXT NOT NULL,
  currency               TEXT NOT NULL,
  notes                  TEXT,
  internal_notes         TEXT,
  discount_type          TEXT NOT NULL,
  discount_percent       REAL,
  discount_amount        INTEGER,
  ar_account_id          TEXT NOT NULL,
  tax_account_id         TEXT NOT NULL,
  amount_paid            INTEGER NOT NULL,
  created_at             TEXT NOT NULL,
  confirmed_at           TEXT,
  journal_entry_id       TEXT,
  workflow_request_id    TEXT,
  reverses_invoice_id    TEXT REFERENCES sales_invoice(id),
  reversed_by_invoice_id TEXT REFERENCES sales_invoice(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoice_doc_no ON sales_invoice(doc_no) WHERE doc_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoice_status ON sales_invoice(status);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_customer ON sales_invoice(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_date ON sales_invoice(date);
CREATE TABLE IF NOT EXISTS sales_invoice_line (
  invoice_id           TEXT NOT NULL REFERENCES sales_invoice(id),
  line_no              INTEGER NOT NULL,
  line_id              TEXT NOT NULL,
  item_id              TEXT NOT NULL,
  item_name_ar         TEXT NOT NULL,
  is_stock             INTEGER NOT NULL,
  qty                  INTEGER NOT NULL,
  unit_price           INTEGER NOT NULL,
  discount_percent     REAL NOT NULL,
  tax_rate_percent     REAL NOT NULL,
  revenue_account_id   TEXT NOT NULL,
  cogs_account_id      TEXT,
  inventory_account_id TEXT,
  unit_cost            INTEGER,
  PRIMARY KEY (invoice_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_line_invoice ON sales_invoice_line(invoice_id);
`;

interface InvoiceRow {
  id: string;
  doc_type: string;
  doc_no: string | null;
  status: string;
  date: string;
  due_date: string;
  customer_id: string;
  customer_name_ar: string;
  customer_tax_exempt: number;
  warehouse_id: string;
  branch_id: string;
  currency: string;
  notes: string | null;
  internal_notes: string | null;
  discount_type: string;
  discount_percent: number | null;
  discount_amount: number | null;
  ar_account_id: string;
  tax_account_id: string;
  amount_paid: number;
  created_at: string;
  confirmed_at: string | null;
  journal_entry_id: string | null;
  workflow_request_id: string | null;
  reverses_invoice_id: string | null;
  reversed_by_invoice_id: string | null;
}

interface LineRow {
  line_id: string;
  item_id: string;
  item_name_ar: string;
  is_stock: number;
  qty: bigint;
  unit_price: bigint;
  discount_percent: number;
  tax_rate_percent: number;
  revenue_account_id: string;
  cogs_account_id: string | null;
  inventory_account_id: string | null;
  unit_cost: bigint | null;
}

function toDiscount(row: InvoiceRow): SalesInvoiceDiscount {
  if (row.discount_type === "percent") {
    return { type: "percent", percent: row.discount_percent ?? 0 };
  }
  return { type: "amount", amount: Money.fromScaled(row.discount_amount ?? 0) };
}

function toLine(row: LineRow): SalesInvoiceLine {
  return {
    lineId: row.line_id,
    itemId: row.item_id,
    itemNameAr: row.item_name_ar,
    // The line SELECT uses .safeIntegers(), so INTEGER columns arrive as bigint.
    isStock: Number(row.is_stock) === 1,
    qty: Qty.fromScaled(row.qty),
    unitPrice: Money.fromScaled(row.unit_price),
    discountPercent: row.discount_percent,
    taxRatePercent: row.tax_rate_percent,
    revenueAccountId: row.revenue_account_id,
    cogsAccountId: row.cogs_account_id,
    inventoryAccountId: row.inventory_account_id,
    unitCost: row.unit_cost === null ? null : Money.fromScaled(row.unit_cost),
  };
}

function invoiceParams(invoice: SalesInvoice) {
  const isPercent = invoice.discount.type === "percent";
  return {
    id: invoice.id,
    doc_type: invoice.docType,
    doc_no: invoice.docNo,
    status: invoice.status,
    date: invoice.date,
    due_date: invoice.dueDate,
    customer_id: invoice.customerId,
    customer_name_ar: invoice.customerNameAr,
    customer_tax_exempt: invoice.customerTaxExempt ? 1 : 0,
    warehouse_id: invoice.warehouseId,
    branch_id: invoice.branchId,
    currency: invoice.currency,
    notes: invoice.notes,
    internal_notes: invoice.internalNotes,
    discount_type: invoice.discount.type,
    discount_percent: isPercent ? invoice.discount.percent : null,
    discount_amount: isPercent ? null : invoice.discount.amount.toScaledNumber(),
    ar_account_id: invoice.arAccountId,
    tax_account_id: invoice.taxAccountId,
    amount_paid: invoice.amountPaid.toScaledNumber(),
    created_at: invoice.createdAt,
    confirmed_at: invoice.confirmedAt,
    journal_entry_id: invoice.journalEntryId,
    workflow_request_id: invoice.workflowRequestId,
    reverses_invoice_id: invoice.reversesInvoiceId,
    reversed_by_invoice_id: invoice.reversedByInvoiceId,
  };
}

class SqliteSalesInvoiceRepository implements SalesInvoiceRepository {
  private readonly insertInvoice: Database.Statement;
  private readonly updateInvoice: Database.Statement;
  private readonly deleteLines: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly selectInvoiceById: Database.Statement;
  private readonly selectLines: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertInvoice = sqlite.prepare(`
      INSERT INTO sales_invoice (
        id, doc_type, doc_no, status, date, due_date, customer_id, customer_name_ar,
        customer_tax_exempt, warehouse_id, branch_id, currency, notes, internal_notes,
        discount_type, discount_percent, discount_amount, ar_account_id, tax_account_id,
        amount_paid, created_at, confirmed_at, journal_entry_id, workflow_request_id,
        reverses_invoice_id, reversed_by_invoice_id
      ) VALUES (
        @id, @doc_type, @doc_no, @status, @date, @due_date, @customer_id, @customer_name_ar,
        @customer_tax_exempt, @warehouse_id, @branch_id, @currency, @notes, @internal_notes,
        @discount_type, @discount_percent, @discount_amount, @ar_account_id, @tax_account_id,
        @amount_paid, @created_at, @confirmed_at, @journal_entry_id, @workflow_request_id,
        @reverses_invoice_id, @reversed_by_invoice_id
      )
    `);
    this.updateInvoice = sqlite.prepare(`
      UPDATE sales_invoice SET
        doc_type = @doc_type,
        doc_no = @doc_no,
        status = @status,
        date = @date,
        due_date = @due_date,
        customer_id = @customer_id,
        customer_name_ar = @customer_name_ar,
        customer_tax_exempt = @customer_tax_exempt,
        warehouse_id = @warehouse_id,
        branch_id = @branch_id,
        currency = @currency,
        notes = @notes,
        internal_notes = @internal_notes,
        discount_type = @discount_type,
        discount_percent = @discount_percent,
        discount_amount = @discount_amount,
        ar_account_id = @ar_account_id,
        tax_account_id = @tax_account_id,
        amount_paid = @amount_paid,
        created_at = @created_at,
        confirmed_at = @confirmed_at,
        journal_entry_id = @journal_entry_id,
        workflow_request_id = @workflow_request_id,
        reverses_invoice_id = @reverses_invoice_id,
        reversed_by_invoice_id = @reversed_by_invoice_id
      WHERE id = @id
    `);
    this.deleteLines = sqlite.prepare(`DELETE FROM sales_invoice_line WHERE invoice_id = ?`);
    this.insertLine = sqlite.prepare(`
      INSERT INTO sales_invoice_line (
        invoice_id, line_no, line_id, item_id, item_name_ar, is_stock, qty, unit_price,
        discount_percent, tax_rate_percent, revenue_account_id, cogs_account_id,
        inventory_account_id, unit_cost
      ) VALUES (
        @invoice_id, @line_no, @line_id, @item_id, @item_name_ar, @is_stock, @qty, @unit_price,
        @discount_percent, @tax_rate_percent, @revenue_account_id, @cogs_account_id,
        @inventory_account_id, @unit_cost
      )
    `);
    this.selectInvoiceById = sqlite.prepare(`SELECT * FROM sales_invoice WHERE id = ?`);
    this.selectLines = sqlite
      .prepare(
        `SELECT line_id, item_id, item_name_ar, is_stock, qty, unit_price, discount_percent,
                tax_rate_percent, revenue_account_id, cogs_account_id, inventory_account_id, unit_cost
           FROM sales_invoice_line WHERE invoice_id = ? ORDER BY line_no`,
      )
      .safeIntegers();
  }

  async save(invoice: SalesInvoice): Promise<void> {
    this.insertInvoice.run(invoiceParams(invoice));
    this.insertLines(invoice);
  }

  async update(invoice: SalesInvoice): Promise<void> {
    this.updateInvoice.run(invoiceParams(invoice));
    this.deleteLines.run(invoice.id);
    this.insertLines(invoice);
  }

  async findById(id: string): Promise<SalesInvoice | null> {
    const row = this.selectInvoiceById.get(id) as InvoiceRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async list(filter: SalesInvoiceListFilter = {}): Promise<readonly SalesInvoice[]> {
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
      .prepare(`SELECT * FROM sales_invoice ${where} ORDER BY date, created_at`)
      .all(...params) as InvoiceRow[];
    return rows.map((row) => this.hydrate(row));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }

  private insertLines(invoice: SalesInvoice): void {
    invoice.lines.forEach((line, index) => {
      this.insertLine.run({
        invoice_id: invoice.id,
        line_no: index,
        line_id: line.lineId,
        item_id: line.itemId,
        item_name_ar: line.itemNameAr,
        is_stock: line.isStock ? 1 : 0,
        qty: line.qty.toScaledNumber(),
        unit_price: line.unitPrice.toScaledNumber(),
        discount_percent: line.discountPercent,
        tax_rate_percent: line.taxRatePercent,
        revenue_account_id: line.revenueAccountId,
        cogs_account_id: line.cogsAccountId,
        inventory_account_id: line.inventoryAccountId,
        unit_cost: line.unitCost === null ? null : line.unitCost.toScaledNumber(),
      });
    });
  }

  private hydrate(row: InvoiceRow): SalesInvoice {
    const lineRows = this.selectLines.all(row.id) as LineRow[];
    return {
      id: row.id,
      docType: row.doc_type as SalesInvoice["docType"],
      docNo: row.doc_no,
      status: row.status as SalesInvoiceStatus,
      date: row.date,
      dueDate: row.due_date,
      customerId: row.customer_id,
      customerNameAr: row.customer_name_ar,
      customerTaxExempt: row.customer_tax_exempt === 1,
      warehouseId: row.warehouse_id,
      branchId: row.branch_id,
      currency: row.currency,
      notes: row.notes,
      internalNotes: row.internal_notes,
      discount: toDiscount(row),
      arAccountId: row.ar_account_id,
      taxAccountId: row.tax_account_id,
      lines: lineRows.map(toLine),
      amountPaid: Money.fromScaled(row.amount_paid),
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      journalEntryId: row.journal_entry_id,
      workflowRequestId: row.workflow_request_id,
      reversesInvoiceId: row.reverses_invoice_id,
      reversedByInvoiceId: row.reversed_by_invoice_id,
    };
  }
}

export interface SqliteSalesInvoiceStoreHandle extends SalesInvoiceRepository {
  close(): void;
}

/** Open a SQLite-backed SalesInvoiceRepository. ":memory:" for tests, a path for real. */
export function createSqliteSalesInvoiceStore(path: SqliteConnectionInput = ":memory:"): SqliteSalesInvoiceStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  const repo = new SqliteSalesInvoiceRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSalesInvoiceStoreHandle;
}
