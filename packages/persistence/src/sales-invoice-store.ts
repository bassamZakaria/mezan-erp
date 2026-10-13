import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertingNew } from "./insert-new.js";
import { addVersionColumns, createDocumentVersionStore, type DocumentVersionStore } from "./document-version.js";
import { columnsOf, writeRowColumnsWhere } from "./document-field-write.js";
import { markInvoicesNamedByRegister } from "./document-kind-backfill.js";
import { childRowsByParent, countMatching, FilterClauses, selectPage } from "./list-query.js";
import {
  InvoiceDocumentKind,
  Money,
  Qty,
  SALES_INVOICE_ACTIVE_STATUSES,
  SalesInvoiceField,
  type SalesInvoiceWritePrecondition,
  type AppliedSalesInvoicePromotion,
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
  salesperson_id         TEXT,
  salesperson_name_ar    TEXT,
  project_id             TEXT,
  coupon_code            TEXT,
  promotion_id           TEXT,
  promotion_code         TEXT,
  promotion_name_ar      TEXT,
  promotion_coupon_code  TEXT,
  promotion_discount_total INTEGER,
  promotion_line_discounts_json TEXT,
  promotion_applied_at   TEXT,
  currency               TEXT NOT NULL,
  fx_rate                TEXT,
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
  reversed_by_invoice_id TEXT REFERENCES sales_invoice(id),
  document_kind          TEXT NOT NULL DEFAULT 'standard',
  void_reason            TEXT,
  source_quote_id        TEXT
);
CREATE TABLE IF NOT EXISTS sales_invoice_line (
  invoice_id           TEXT NOT NULL REFERENCES sales_invoice(id),
  line_no              INTEGER NOT NULL,
  line_id              TEXT NOT NULL,
  item_id              TEXT NOT NULL,
  item_name_ar         TEXT NOT NULL,
  is_stock             INTEGER NOT NULL,
  qty                  INTEGER NOT NULL,
  unit_code            TEXT,
  unit_factor          REAL,
  base_qty             INTEGER,
  unit_price           INTEGER NOT NULL,
  line_discount_type   TEXT,
  line_discount_amount INTEGER,
  discount_percent     REAL NOT NULL,
  tax_rate_percent     REAL NOT NULL,
  tax_rate_id          TEXT,
  revenue_account_id   TEXT NOT NULL,
  cogs_account_id      TEXT,
  inventory_account_id TEXT,
  unit_cost            INTEGER,
  cost_center_id       TEXT,
  PRIMARY KEY (invoice_id, line_no)
);
`;

/**
 * Runs only AFTER {@link addMissingColumns} has widened an older `sales_invoice`
 * — indexing `salesperson_id` / `promotion_id` on a database created before
 * those columns existed would otherwise fail with "no such column".
 */
const CREATE_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoice_doc_no ON sales_invoice(doc_no) WHERE doc_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoice_status ON sales_invoice(status);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_customer ON sales_invoice(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_date ON sales_invoice(date);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_salesperson ON sales_invoice(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_promotion ON sales_invoice(promotion_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_line_invoice ON sales_invoice_line(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_line_tax_rate ON sales_invoice_line(tax_rate_id) WHERE tax_rate_id IS NOT NULL;
`;

/**
 * The salesperson and applied-promotion columns were added after the table
 * shipped; CREATE TABLE IF NOT EXISTS will not add them to an existing
 * database, so widen it in place. Every one is nullable — an invoice raised
 * before the columns existed genuinely has no rep and no promotion, and must
 * read back that way rather than being back-filled with an invented value.
 */
const ADDED_COLUMNS: readonly (readonly [string, string])[] = [
  ["salesperson_id", "TEXT"],
  ["salesperson_name_ar", "TEXT"],
  ["coupon_code", "TEXT"],
  ["promotion_id", "TEXT"],
  ["promotion_code", "TEXT"],
  ["promotion_name_ar", "TEXT"],
  ["promotion_coupon_code", "TEXT"],
  ["promotion_discount_total", "INTEGER"],
  ["promotion_line_discounts_json", "TEXT"],
  ["promotion_applied_at", "TEXT"],
  ["tax_inclusive", "INTEGER"],
  ["fx_rate", "TEXT"],
  ["project_id", "TEXT"],
  ["document_kind", `TEXT NOT NULL DEFAULT '${InvoiceDocumentKind.Standard}'`],
  ["void_reason", "TEXT"],
  ["source_quote_id", "TEXT"],
];

/** Line columns added after the table shipped — see {@link ADDED_COLUMNS}. */
const ADDED_LINE_COLUMNS: readonly [string, string][] = [
  ["unit_code", "TEXT"],
  ["unit_factor", "REAL"],
  ["base_qty", "INTEGER"],
  ["line_discount_type", "TEXT"],
  ["line_discount_amount", "INTEGER"],
  ["cost_center_id", "TEXT"],
  ["tax_rate_id", "TEXT"],
];

function lacksColumn(sqlite: Database.Database, table: string, column: string): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.length > 0 && !columns.some((c) => c.name === column);
}

function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(sales_invoice)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of ADDED_COLUMNS) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE sales_invoice ADD COLUMN ${name} ${type}`);
  }
  const existingLine = new Set(
    (sqlite.prepare(`PRAGMA table_info(sales_invoice_line)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of ADDED_LINE_COLUMNS) {
    if (!existingLine.has(name)) sqlite.exec(`ALTER TABLE sales_invoice_line ADD COLUMN ${name} ${type}`);
  }
}

interface InvoiceRow {
  id: string;
  doc_type: string;
  doc_no: string | null;
  status: string;
  date: string;
  due_date: string;
  customer_id: string;
  customer_name_ar: string;
  document_kind: string | null;
  void_reason: string | null;
  source_quote_id: string | null;
  customer_tax_exempt: number;
  tax_inclusive: number | null;
  warehouse_id: string;
  branch_id: string;
  salesperson_id: string | null;
  salesperson_name_ar: string | null;
  project_id: string | null;
  coupon_code: string | null;
  promotion_id: string | null;
  promotion_code: string | null;
  promotion_name_ar: string | null;
  promotion_coupon_code: string | null;
  promotion_discount_total: number | null;
  promotion_line_discounts_json: string | null;
  promotion_applied_at: string | null;
  currency: string;
  fx_rate: string | null;
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
  unit_code: string | null;
  unit_factor: number | null;
  base_qty: bigint | null;
  unit_price: bigint;
  line_discount_type: string | null;
  line_discount_amount: bigint | null;
  discount_percent: number;
  tax_rate_percent: number;
  tax_rate_id: string | null;
  revenue_account_id: string;
  cogs_account_id: string | null;
  inventory_account_id: string | null;
  unit_cost: bigint | null;
  cost_center_id: string | null;
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
    unitCode: row.unit_code ?? "",
    // A line written before per-line units existed is a base-unit line, so its
    // base quantity is its quantity — never null, or the stock plan would
    // silently move nothing.
    unitFactor: row.unit_factor ?? 1,
    baseQty: row.base_qty === null ? Qty.fromScaled(row.qty) : Qty.fromScaled(row.base_qty),
    unitPrice: Money.fromScaled(row.unit_price),
    discountType: row.line_discount_type === "amount" ? "amount" : "percent",
    discountAmount: Money.fromScaled(row.line_discount_amount ?? 0n),
    discountPercent: row.discount_percent,
    taxRatePercent: row.tax_rate_percent,
    taxRateId: row.tax_rate_id ?? null,
    revenueAccountId: row.revenue_account_id,
    cogsAccountId: row.cogs_account_id,
    inventoryAccountId: row.inventory_account_id,
    unitCost: row.unit_cost === null ? null : Money.fromScaled(row.unit_cost),
    costCenterId: row.cost_center_id,
  };
}

/**
 * The promotion snapshot's per-line split. Amounts are the Money value's own
 * SCALED INTEGER rendered as a decimal string — never a JSON number, which
 * would round-trip through an IEEE-754 double and lose exactness.
 */
interface PromotionLineDiscountWire {
  readonly lineId: string;
  readonly itemId: string;
  readonly amountScaled: string;
}

function toAppliedPromotion(row: InvoiceRow): AppliedSalesInvoicePromotion | null {
  if (row.promotion_id === null) return null;
  const wire = row.promotion_line_discounts_json
    ? (JSON.parse(row.promotion_line_discounts_json) as PromotionLineDiscountWire[])
    : [];
  return {
    promotionId: row.promotion_id,
    code: row.promotion_code ?? row.promotion_id,
    nameAr: row.promotion_name_ar ?? row.promotion_id,
    couponCode: row.promotion_coupon_code,
    discountTotal: Money.fromScaled(row.promotion_discount_total ?? 0),
    lineDiscounts: wire.map((d) => ({
      lineId: d.lineId,
      itemId: d.itemId,
      amount: Money.fromScaled(BigInt(d.amountScaled)),
    })),
    appliedAt: row.promotion_applied_at ?? "",
  };
}

function invoiceParams(invoice: SalesInvoice) {
  const isPercent = invoice.discount.type === "percent";
  const promotion = invoice.appliedPromotion;
  return {
    id: invoice.id,
    doc_type: invoice.docType,
    doc_no: invoice.docNo,
    status: invoice.status,
    date: invoice.date,
    due_date: invoice.dueDate,
    customer_id: invoice.customerId,
    customer_name_ar: invoice.customerNameAr,
    document_kind: invoice.documentKind ?? InvoiceDocumentKind.Standard,
    void_reason: invoice.voidReason ?? null,
    source_quote_id: invoice.sourceQuoteId ?? null,
    customer_tax_exempt: invoice.customerTaxExempt ? 1 : 0,
    tax_inclusive: invoice.taxInclusive ? 1 : 0,
    warehouse_id: invoice.warehouseId,
    branch_id: invoice.branchId,
    salesperson_id: invoice.salespersonId,
    salesperson_name_ar: invoice.salespersonNameAr,
    project_id: invoice.projectId,
    coupon_code: invoice.couponCode,
    promotion_id: promotion?.promotionId ?? null,
    promotion_code: promotion?.code ?? null,
    promotion_name_ar: promotion?.nameAr ?? null,
    promotion_coupon_code: promotion?.couponCode ?? null,
    promotion_discount_total: promotion ? promotion.discountTotal.toScaledNumber() : null,
    promotion_line_discounts_json: promotion
      ? JSON.stringify(
          promotion.lineDiscounts.map(
            (d): PromotionLineDiscountWire => ({
              lineId: d.lineId,
              itemId: d.itemId,
              amountScaled: d.amount.scaled.toString(),
            }),
          ),
        )
      : null,
    promotion_applied_at: promotion?.appliedAt ?? null,
    currency: invoice.currency,
    fx_rate: invoice.fxRate ?? null,
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

const UNPOSTED_STATUSES: readonly SalesInvoiceStatus[] = ["draft", "pending"];

const SALES_INVOICE_COLUMNS: Readonly<Record<SalesInvoiceField, readonly string[]>> = {
  [SalesInvoiceField.Status]: ["status"],
  [SalesInvoiceField.AmountPaid]: ["amount_paid"],
  [SalesInvoiceField.WorkflowRequestId]: ["workflow_request_id"],
  [SalesInvoiceField.VoidReason]: ["void_reason"],
};

class SqliteSalesInvoiceRepository implements SalesInvoiceRepository {
  private readonly insertInvoice: Database.Statement;
  private readonly updateInvoice: Database.Statement;
  private readonly deleteLines: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly selectInvoiceById: Database.Statement;
  private readonly selectInvoiceByDocNo: Database.Statement;
  private readonly selectLines: Database.Statement;

  constructor(private readonly sqlite: Database.Database, private readonly versions?: DocumentVersionStore) {
    this.insertInvoice = sqlite.prepare(`
      INSERT INTO sales_invoice (
        id, doc_type, doc_no, status, date, due_date, customer_id, customer_name_ar,
        customer_tax_exempt, tax_inclusive, warehouse_id, branch_id, salesperson_id, salesperson_name_ar,
        project_id,
        coupon_code, promotion_id, promotion_code, promotion_name_ar, promotion_coupon_code,
        promotion_discount_total, promotion_line_discounts_json, promotion_applied_at,
        currency, fx_rate, notes, internal_notes,
        discount_type, discount_percent, discount_amount, ar_account_id, tax_account_id,
        amount_paid, created_at, confirmed_at, journal_entry_id, workflow_request_id,
        reverses_invoice_id, reversed_by_invoice_id, document_kind, void_reason, source_quote_id
      ) VALUES (
        @id, @doc_type, @doc_no, @status, @date, @due_date, @customer_id, @customer_name_ar,
        @customer_tax_exempt, @tax_inclusive, @warehouse_id, @branch_id, @salesperson_id, @salesperson_name_ar,
        @project_id,
        @coupon_code, @promotion_id, @promotion_code, @promotion_name_ar, @promotion_coupon_code,
        @promotion_discount_total, @promotion_line_discounts_json, @promotion_applied_at,
        @currency, @fx_rate, @notes, @internal_notes,
        @discount_type, @discount_percent, @discount_amount, @ar_account_id, @tax_account_id,
        @amount_paid, @created_at, @confirmed_at, @journal_entry_id, @workflow_request_id,
        @reverses_invoice_id, @reversed_by_invoice_id, @document_kind, @void_reason, @source_quote_id
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
        tax_inclusive = @tax_inclusive,
        warehouse_id = @warehouse_id,
        branch_id = @branch_id,
        salesperson_id = @salesperson_id,
        salesperson_name_ar = @salesperson_name_ar,
        project_id = @project_id,
        coupon_code = @coupon_code,
        promotion_id = @promotion_id,
        promotion_code = @promotion_code,
        promotion_name_ar = @promotion_name_ar,
        promotion_coupon_code = @promotion_coupon_code,
        promotion_discount_total = @promotion_discount_total,
        promotion_line_discounts_json = @promotion_line_discounts_json,
        promotion_applied_at = @promotion_applied_at,
        currency = @currency,
        fx_rate = @fx_rate,
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
        reversed_by_invoice_id = @reversed_by_invoice_id,
        document_kind = @document_kind,
        void_reason = @void_reason,
        source_quote_id = @source_quote_id
      WHERE id = @id
    `);
    this.deleteLines = sqlite.prepare(`DELETE FROM sales_invoice_line WHERE invoice_id = ?`);
    this.insertLine = sqlite.prepare(`
      INSERT INTO sales_invoice_line (
        invoice_id, line_no, line_id, item_id, item_name_ar, is_stock, qty,
        unit_code, unit_factor, base_qty, unit_price,
        line_discount_type, line_discount_amount,
        discount_percent, tax_rate_percent, tax_rate_id, revenue_account_id, cogs_account_id,
        inventory_account_id, unit_cost, cost_center_id
      ) VALUES (
        @invoice_id, @line_no, @line_id, @item_id, @item_name_ar, @is_stock, @qty,
        @unit_code, @unit_factor, @base_qty, @unit_price,
        @line_discount_type, @line_discount_amount,
        @discount_percent, @tax_rate_percent, @tax_rate_id, @revenue_account_id, @cogs_account_id,
        @inventory_account_id, @unit_cost, @cost_center_id
      )
    `);
    this.selectInvoiceById = sqlite.prepare(`SELECT * FROM sales_invoice WHERE id = ?`);
    this.selectInvoiceByDocNo = sqlite.prepare(`SELECT * FROM sales_invoice WHERE doc_no = ?`);
    this.selectLines = sqlite
      .prepare(
        `SELECT line_id, item_id, item_name_ar, is_stock, qty, unit_code, unit_factor, base_qty,
                unit_price, line_discount_type, line_discount_amount, discount_percent,
                tax_rate_percent, tax_rate_id, revenue_account_id, cogs_account_id, inventory_account_id, unit_cost,
                cost_center_id
           FROM sales_invoice_line WHERE invoice_id = ? ORDER BY line_no`,
      )
      .safeIntegers();
  }

  async save(invoice: SalesInvoice): Promise<void> {
    insertingNew(invoice.id, () => this.insertInvoice.run(invoiceParams(invoice)));
    this.insertLines(invoice);
  }

  async update(invoice: SalesInvoice): Promise<void> {
    this.updateInvoice.run(invoiceParams(invoice));
    this.deleteLines.run(invoice.id);
    this.insertLines(invoice);
    // N-9: EVERY write moves the version, so a caller holding an older one is
    // detectable whichever path made the change.
    this.versions?.bump(invoice.id);
  }

  async writeFields(next: SalesInvoice, fields: readonly SalesInvoiceField[], expected: SalesInvoiceWritePrecondition): Promise<boolean> {
    const written = writeRowColumnsWhere(this.sqlite, {
      table: "sales_invoice",
      row: invoiceParams(next),
      columns: columnsOf(SALES_INVOICE_COLUMNS, fields),
      id: next.id,
      expectedStatuses: expected.status,
    });
    if (written) this.versions?.bump(next.id);
    return written;
  }

  async replaceUnposted(next: SalesInvoice, expected: SalesInvoiceWritePrecondition): Promise<boolean> {
    const unposted = expected.status.filter((status) => UNPOSTED_STATUSES.includes(status));
    if (unposted.length === 0) return false;
    const changes = this.sqlite
      .prepare(`SELECT 1 FROM sales_invoice WHERE id = ? AND status IN (${unposted.map(() => "?").join(",")})`)
      .get(next.id, ...unposted);
    if (!changes) return false;
    await this.update(next);
    return true;
  }

  async nameLineTaxRate(invoiceId: string, lineIds: readonly string[], taxRatePercent: number, taxRateId: string): Promise<number> {
    if (lineIds.length === 0) return 0;
    const named = this.sqlite
      .prepare(
        `UPDATE sales_invoice_line SET tax_rate_id = ?
          WHERE invoice_id = ? AND tax_rate_id IS NULL AND tax_rate_percent = ?
            AND line_id IN (${lineIds.map(() => "?").join(",")})
            AND invoice_id IN (SELECT id FROM sales_invoice WHERE status IN (${[...SALES_INVOICE_ACTIVE_STATUSES].map(() => "?").join(",")}))`,
      )
      .run(taxRateId, invoiceId, taxRatePercent, ...lineIds, ...SALES_INVOICE_ACTIVE_STATUSES).changes;
    if (named > 0) this.versions?.bump(invoiceId);
    return named;
  }

  async findById(id: string): Promise<SalesInvoice | null> {
    const row = this.selectInvoiceById.get(id) as InvoiceRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async findByDocNo(docNo: string): Promise<SalesInvoice | null> {
    const row = this.selectInvoiceByDocNo.get(docNo) as InvoiceRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  /**
   * Filters become SQL, and a page becomes `LIMIT`/`OFFSET`. Everything the
   * route can express as a column lives here: loading the whole filtered table
   * and slicing it in the browser is what this replaces.
   */
  private clausesFor(filter: SalesInvoiceListFilter): FilterClauses {
    const where = new FilterClauses()
      .eq("status", filter.status)
      .eq("customer_id", filter.customerId)
      .gte("date", filter.fromDate)
      .lte("date", filter.toDate)
      .eq("branch_id", filter.branchId)
      .eq("warehouse_id", filter.warehouseId)
      .eq("salesperson_id", filter.salespersonId)
      .eq("source_quote_id", filter.sourceQuoteId);
    if (filter.statusIn) {
      // An empty set matches nothing, exactly as the caller asked — falling
      // through to "no clause" would widen it to every status.
      if (filter.statusIn.length === 0) where.raw("0 = 1");
      else where.raw(`status IN (${filter.statusIn.map(() => "?").join(",")})`, ...filter.statusIn);
    }
    // SCOPE, not a filter. An empty array means the caller may see nothing, so
    // it must narrow to the unattributable rows rather than fall through to
    // "no clause" — treating an empty scope as unfiltered is how a scope stops
    // scoping. `IS NULL` survives either way, because a row with no branch is
    // not attributable to one.
    for (const [column, ids] of [
      ["branch_id", filter.branchScope],
      ["warehouse_id", filter.warehouseScope],
    ] as const) {
      if (!ids) continue;
      const marks = (values: readonly string[]) => values.map(() => "?").join(",");
      const standsOn = column === "branch_id" ? filter.branchScopeWarehouses : undefined;
      if (standsOn) {
        const own = ids.length > 0 ? `branch_id IN (${marks(ids)})` : "0 = 1";
        const byWarehouse = standsOn.length > 0 ? `(COALESCE(branch_id, '') = '' AND warehouse_id IN (${marks(standsOn)}))` : "0 = 1";
        where.raw(`(${own} OR ${byWarehouse})`, ...ids, ...standsOn);
      } else if (ids.length === 0) where.raw(`${column} IS NULL`);
      else where.raw(`(${column} IN (${marks(ids)}) OR ${column} IS NULL)`, ...ids);
    }
    const term = filter.search?.trim();
    if (term) {
      const like = `%${term.toLowerCase()}%`;
      where.raw("(LOWER(doc_no) LIKE ? OR LOWER(customer_name_ar) LIKE ?)", like, like);
    }
    return where;
  }

  async list(filter: SalesInvoiceListFilter = {}): Promise<readonly SalesInvoice[]> {
    const rows = selectPage<InvoiceRow>(this.sqlite, {
      table: "sales_invoice",
      where: this.clausesFor(filter),
      orderBy:
        filter.sort?.key === "docNo"
          ? `doc_no IS NULL, doc_no ${filter.sort.direction === "desc" ? "DESC" : "ASC"}, created_at`
          : "date, created_at",
      page: { limit: filter.limit, offset: filter.offset },
    });
    // One query for the whole page's lines, not one per invoice.
    const linesByInvoice = childRowsByParent<LineRow & { invoice_id: string }>(this.sqlite, {
      table: "sales_invoice_line",
      parentColumn: "invoice_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "invoice_id, line_no",
      columns:
        "invoice_id, line_id, item_id, item_name_ar, is_stock, qty, unit_code, unit_factor, base_qty, " +
        "unit_price, line_discount_type, line_discount_amount, discount_percent, tax_rate_percent, tax_rate_id, " +
        "revenue_account_id, cogs_account_id, inventory_account_id, unit_cost, cost_center_id",
      safeIntegers: true,
    });
    return rows.map((row) => this.hydrate(row, linesByInvoice.get(row.id) ?? []));
  }

  async count(filter: SalesInvoiceListFilter = {}): Promise<number> {
    return countMatching(this.sqlite, "sales_invoice", this.clausesFor(filter));
  }

  /**
   * One `GROUP BY` for every status chip. The status filters are stripped
   * first: a chip has to report how many rows it WOULD show, so counting the
   * already status-filtered set would render every chip but the active one as
   * zero.
   */
  async countByStatus(filter: SalesInvoiceListFilter = {}): Promise<ReadonlyMap<SalesInvoiceStatus, number>> {
    const { status: _status, statusIn: _statusIn, limit: _limit, offset: _offset, ...rest } = filter;
    const where = this.clausesFor(rest);
    const rows = this.sqlite
      .prepare(`SELECT status, COUNT(*) AS n FROM sales_invoice ${where.sql} GROUP BY status`)
      .all(...where.values) as { status: string; n: number | bigint }[];
    return new Map(rows.map((row) => [row.status as SalesInvoiceStatus, Number(row.n)]));
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
        unit_code: line.unitCode === "" ? null : line.unitCode,
        unit_factor: line.unitFactor,
        base_qty: line.baseQty.toScaledNumber(),
        unit_price: line.unitPrice.toScaledNumber(),
        line_discount_type: line.discountType,
        line_discount_amount: line.discountAmount.toScaledNumber(),
        discount_percent: line.discountPercent,
        tax_rate_percent: line.taxRatePercent,
        tax_rate_id: line.taxRateId,
        revenue_account_id: line.revenueAccountId,
        cogs_account_id: line.cogsAccountId,
        inventory_account_id: line.inventoryAccountId,
        unit_cost: line.unitCost === null ? null : line.unitCost.toScaledNumber(),
        cost_center_id: line.costCenterId,
      });
    });
  }

  private hydrate(row: InvoiceRow, preloadedLines?: readonly LineRow[]): SalesInvoice {
    const lineRows = preloadedLines ?? (this.selectLines.all(row.id) as LineRow[]);
    return {
      id: row.id,
      docType: row.doc_type as SalesInvoice["docType"],
      docNo: row.doc_no,
      status: row.status as SalesInvoiceStatus,
      date: row.date,
      dueDate: row.due_date,
      customerId: row.customer_id,
      customerNameAr: row.customer_name_ar,
      documentKind: row.document_kind === InvoiceDocumentKind.RetentionRelease ? InvoiceDocumentKind.RetentionRelease : InvoiceDocumentKind.Standard,
      voidReason: row.void_reason ?? null,
      sourceQuoteId: row.source_quote_id ?? null,
      customerTaxExempt: row.customer_tax_exempt === 1,
      taxInclusive: row.tax_inclusive === 1,
      warehouseId: row.warehouse_id,
      branchId: row.branch_id,
      salespersonId: row.salesperson_id,
      salespersonNameAr: row.salesperson_name_ar,
      projectId: row.project_id,
      currency: row.currency,
      fxRate: row.fx_rate,
      couponCode: row.coupon_code,
      appliedPromotion: toAppliedPromotion(row),
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
  /** N-9 — the row version an optimistic update compares against. */
  readonly versions: DocumentVersionStore;
  close(): void;
}

/** Open a SQLite-backed SalesInvoiceRepository. ":memory:" for tests, a path for real. */
export function createSqliteSalesInvoiceStore(path: SqliteConnectionInput = ":memory:"): SqliteSalesInvoiceStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  // ORDER MATTERS: read before CREATE_TABLES — running it brings an older
  // table up to the declared shape, after which the column always exists.
  const kindUnrecorded = lacksColumn(sqlite, "sales_invoice", "document_kind");
  sqlite.exec(CREATE_TABLES);
  addMissingColumns(sqlite);
  if (kindUnrecorded) {
    markInvoicesNamedByRegister(sqlite, { table: "sales_invoice", register: "contracting_retention_release", kind: InvoiceDocumentKind.RetentionRelease });
  }
  sqlite.exec(CREATE_INDEXES);
  addVersionColumns(sqlite, "sales_invoice");
  const versions = createDocumentVersionStore(sqlite, "sales_invoice");
  const repo = new SqliteSalesInvoiceRepository(sqlite, versions);
  return Object.assign(repo, {
    versions,
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSalesInvoiceStoreHandle;
}
