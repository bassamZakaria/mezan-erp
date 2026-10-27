import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { countMatchingAsync, FilterClauses, selectPageAsync } from "./list-query.js";
import { columnsOf, writeRowColumnsWhereAsync } from "./document-field-write.js";
import { markInvoicesNamedByRegister } from "./document-kind-backfill.js";
import { addVersionColumns, createSqlDocumentVersionStore, type DocumentVersionStore } from "./document-version.js";
import { insertNew } from "./insert-new.js";
import { escapeLike, placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderRepository,
  type PurchaseOrderStatus,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type GoodsReceiptRepository,
  type GoodsReceiptStatus,
  GoodsReceiptField,
  PurchaseInvoiceField,
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceLineKind,
  type PurchaseInvoiceListFilter,
  type PurchaseInvoiceRepository,
  type PurchaseInvoiceStatus,
  InvoiceDocumentKind,
  PurchaseInvoiceStatusCode,
} from "@mezan/domain";

/**
 * Self-contained SQLite stores for the purchase chain (docs/archive/catalog/02),
 * following the same standalone-store pattern as item-store.ts. Document lines
 * are small, document-owned collections with no independent query need, so they
 * are kept as JSON text columns (Money/Qty serialized as EXACT decimal strings,
 * round-tripped via fromMajor — never floats) rather than child tables.
 */

// --- Purchase Order --------------------------------------------------------

const CREATE_PO = `
CREATE TABLE IF NOT EXISTS purchase_order (
  id                     TEXT PRIMARY KEY,
  number                 TEXT NOT NULL UNIQUE,
  supplier_id            TEXT NOT NULL,
  date                   TEXT NOT NULL,
  expected_delivery_date TEXT,
  branch_id              TEXT NOT NULL,
  warehouse_id           TEXT NOT NULL,
  currency               TEXT NOT NULL,
  notes                  TEXT,
  lines                  TEXT NOT NULL,
  status                 TEXT NOT NULL,
  created_by             TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  version                INTEGER NOT NULL DEFAULT 1,
  last_modified_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_order(supplier_id);
`;

interface PoRow {
  id: string;
  number: string;
  supplier_id: string;
  date: string;
  expected_delivery_date: string | null;
  branch_id: string;
  warehouse_id: string;
  currency: string;
  notes: string | null;
  lines: string;
  status: string;
  created_by: string;
  created_at: string;
}

function poToDomain(row: PoRow): PurchaseOrder {
  const lines = (JSON.parse(row.lines) as {
    itemId: string;
    description: string | null;
    qty: string;
    unitPrice: string;
    receivedQty: string;
  }[]).map<PurchaseOrderLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    qty: Qty.fromMajor(l.qty),
    unitPrice: Money.fromMajor(l.unitPrice),
    receivedQty: Qty.fromMajor(l.receivedQty),
  }));
  return {
    id: row.id,
    number: row.number,
    supplierId: row.supplier_id,
    date: row.date,
    expectedDeliveryDate: row.expected_delivery_date,
    branchId: row.branch_id,
    warehouseId: row.warehouse_id,
    currency: row.currency,
    notes: row.notes,
    lines,
    status: row.status as PurchaseOrderStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const UPSERT_PO = `INSERT INTO purchase_order (id, number, supplier_id, date, expected_delivery_date, branch_id, warehouse_id, currency, notes, lines, status, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    supplier_id = excluded.supplier_id, date = excluded.date,
    expected_delivery_date = excluded.expected_delivery_date, branch_id = excluded.branch_id,
    warehouse_id = excluded.warehouse_id, currency = excluded.currency, notes = excluded.notes,
    lines = excluded.lines, status = excluded.status`;

function poParams(o: PurchaseOrder): SqlValue[] {
  return [
    o.id,
    o.number,
    o.supplierId,
    o.date,
    o.expectedDeliveryDate,
    o.branchId,
    o.warehouseId,
    o.currency,
    o.notes,
    JSON.stringify(
      o.lines.map((l) => ({
        itemId: l.itemId,
        description: l.description,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
        receivedQty: l.receivedQty.toString(),
      })),
    ),
    o.status,
    o.createdBy,
    o.createdAt,
  ];
}

class SqlPurchaseOrderStore implements PurchaseOrderRepository {
  constructor(private readonly db: SqlDb, private readonly versions?: DocumentVersionStore) {}

  async findById(id: string): Promise<PurchaseOrder | null> {
    const row = await this.db.get<PoRow>(`SELECT * FROM purchase_order WHERE id = ?`, [id]);
    return row ? poToDomain(row) : null;
  }
  async list(): Promise<PurchaseOrder[]> {
    return (await this.db.all<PoRow>(`SELECT * FROM purchase_order`)).map(poToDomain);
  }
  async create(order: PurchaseOrder): Promise<void> {
    await insertNew(this.db, order.id, UPSERT_PO, poParams(order));
  }
  async update(order: PurchaseOrder): Promise<void> {
    await this.db.run(UPSERT_PO, poParams(order));
    // N-9: any write moves the version, whichever path made the change.
    await this.versions?.bump(order.id);
  }
}

// --- Goods Receipt ---------------------------------------------------------

const CREATE_GR = `
CREATE TABLE IF NOT EXISTS goods_receipt (
  id                TEXT PRIMARY KEY,
  number            TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT,
  supplier_id       TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  date              TEXT NOT NULL,
  notes             TEXT,
  project_id        TEXT,
  lines             TEXT NOT NULL,
  status            TEXT NOT NULL,
  invoiced          INTEGER NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gr_order ON goods_receipt(purchase_order_id);
`;

interface GrRow {
  id: string;
  number: string;
  purchase_order_id: string | null;
  supplier_id: string;
  warehouse_id: string;
  date: string;
  notes: string | null;
  project_id: string | null;
  lines: string;
  status: string;
  invoiced: bigint;
  created_by: string;
  created_at: string;
}

function grToDomain(row: GrRow): GoodsReceipt {
  const lines = (JSON.parse(row.lines) as {
    itemId: string;
    description: string | null;
    qty: string;
    unitCost: string;
    batchNo?: string | null;
    expiryDate?: string | null;
    costCategory?: GoodsReceiptLine["costCategory"];
    invoicedQty?: string;
  }[]).map<GoodsReceiptLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    qty: Qty.fromMajor(l.qty),
    unitCost: Money.fromMajor(l.unitCost),
    batchNo: l.batchNo ?? null,
    expiryDate: l.expiryDate ?? null,
    costCategory: l.costCategory ?? null,
    ...(l.invoicedQty === undefined ? {} : { invoicedQty: Qty.fromMajor(l.invoicedQty) }),
  }));
  return {
    id: row.id,
    number: row.number,
    purchaseOrderId: row.purchase_order_id,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    date: row.date,
    notes: row.notes,
    projectId: row.project_id,
    lines,
    status: row.status as GoodsReceiptStatus,
    invoiced: Number(row.invoiced) === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const UPSERT_GR = `INSERT INTO goods_receipt (id, number, purchase_order_id, supplier_id, warehouse_id, date, notes, project_id, lines, status, invoiced, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    supplier_id = excluded.supplier_id, warehouse_id = excluded.warehouse_id, date = excluded.date,
    notes = excluded.notes, project_id = excluded.project_id, lines = excluded.lines, status = excluded.status, invoiced = excluded.invoiced`;

function grParams(r: GoodsReceipt): SqlValue[] {
  return [
    r.id,
    r.number,
    r.purchaseOrderId,
    r.supplierId,
    r.warehouseId,
    r.date,
    r.notes,
    r.projectId ?? null,
    goodsReceiptLinesJson(r),
    r.status,
    r.invoiced ? 1 : 0,
    r.createdBy,
    r.createdAt,
  ];
}

class SqlGoodsReceiptStore implements GoodsReceiptRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<GoodsReceipt | null> {
    const row = await this.db.get<GrRow>(`SELECT * FROM goods_receipt WHERE id = ?`, [id]);
    return row ? grToDomain(row) : null;
  }
  async list(): Promise<GoodsReceipt[]> {
    return (await this.db.all<GrRow>(`SELECT * FROM goods_receipt`)).map(grToDomain);
  }
  async listByOrder(purchaseOrderId: string): Promise<GoodsReceipt[]> {
    return (await this.db.all<GrRow>(`SELECT * FROM goods_receipt WHERE purchase_order_id = ?`, [purchaseOrderId])).map(grToDomain);
  }
  async create(receipt: GoodsReceipt): Promise<void> {
    await insertNew(this.db, receipt.id, UPSERT_GR, grParams(receipt));
  }
  async update(receipt: GoodsReceipt): Promise<void> {
    await this.db.run(UPSERT_GR, grParams(receipt));
  }
  async writeFields(next: GoodsReceipt, fields: readonly GoodsReceiptField[], expected: { readonly status: GoodsReceipt["status"] }): Promise<boolean> {
    return writeRowColumnsWhereAsync(this.db, {
      table: "goods_receipt",
      row: { status: next.status, invoiced: next.invoiced ? 1 : 0, lines: goodsReceiptLinesJson(next) },
      columns: columnsOf(GOODS_RECEIPT_COLUMNS, fields),
      id: next.id,
      expectedStatuses: [expected.status],
    });
  }
}

const GOODS_RECEIPT_COLUMNS: Readonly<Record<GoodsReceiptField, readonly string[]>> = {
  [GoodsReceiptField.Status]: ["status"],
  [GoodsReceiptField.Billing]: ["invoiced", "lines"],
  [GoodsReceiptField.Lots]: ["lines"],
};

function goodsReceiptLinesJson(receipt: GoodsReceipt): string {
  return JSON.stringify(
    receipt.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: l.qty.toString(),
      unitCost: l.unitCost.toString(),
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      costCategory: l.costCategory ?? null,
      ...(l.invoicedQty === undefined ? {} : { invoicedQty: l.invoicedQty.toString() }),
    })),
  );
}

const PURCHASE_INVOICE_COLUMNS: Readonly<Record<PurchaseInvoiceField, readonly string[]>> = {
  [PurchaseInvoiceField.Status]: ["status"],
  [PurchaseInvoiceField.FxRate]: ["fx_rate"],
  [PurchaseInvoiceField.Lines]: ["lines"],
};

function purchaseInvoiceLinesJson(invoice: PurchaseInvoice): string {
  return JSON.stringify(
    invoice.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      kind: l.kind,
      qty: l.qty.toString(),
      unitCost: l.unitCost.toString(),
      taxRatePercent: l.taxRatePercent,
      taxRateId: l.taxRateId ?? null,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      costCategory: l.costCategory ?? null,
      ...(l.receiptBillings === undefined ? {} : { receiptBillings: l.receiptBillings.map((b) => ({ lineIndex: b.lineIndex, qty: b.qty.toString() })) }),
    })),
  );
}

// --- Purchase Invoice ------------------------------------------------------

const CREATE_PI = `
CREATE TABLE IF NOT EXISTS purchase_invoice (
  id                      TEXT PRIMARY KEY,
  number                  TEXT NOT NULL UNIQUE,
  supplier_id             TEXT NOT NULL,
  date                    TEXT NOT NULL,
  due_date                TEXT,
  supplier_invoice_number TEXT,
  branch_id               TEXT NOT NULL,
  warehouse_id            TEXT NOT NULL,
  currency                TEXT NOT NULL,
  notes                   TEXT,
  receipt_id              TEXT,
  project_id              TEXT,
  lines                   TEXT NOT NULL,
  status                  TEXT NOT NULL,
  fx_rate                 TEXT,
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  document_kind           TEXT NOT NULL DEFAULT 'standard',
  version                 INTEGER NOT NULL DEFAULT 1,
  last_modified_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pi_supplier ON purchase_invoice(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pi_status ON purchase_invoice(status);
-- The list and every aging/report read order by date; without this the only
-- plan was a full scan and a sort of the table (Q-8).
CREATE INDEX IF NOT EXISTS idx_pi_date ON purchase_invoice(date);
`;

interface PiRow {
  id: string;
  number: string;
  supplier_id: string;
  date: string;
  due_date: string | null;
  supplier_invoice_number: string | null;
  branch_id: string;
  warehouse_id: string;
  currency: string;
  notes: string | null;
  receipt_id: string | null;
  project_id: string | null;
  fx_rate: string | null;
  lines: string;
  status: string;
  created_by: string;
  created_at: string;
  document_kind: string | null;
}

function piToDomain(row: PiRow): PurchaseInvoice {
  const lines = (JSON.parse(row.lines) as {
    itemId: string | null;
    description: string | null;
    kind: string;
    qty: string;
    unitCost: string;
    taxRatePercent: number;
    taxRateId?: string | null;
    batchNo?: string | null;
    expiryDate?: string | null;
    costCategory?: PurchaseInvoiceLine["costCategory"];
    receiptBillings?: { lineIndex: number; qty: string }[];
  }[]).map<PurchaseInvoiceLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    kind: l.kind as PurchaseInvoiceLineKind,
    qty: Qty.fromMajor(l.qty),
    unitCost: Money.fromMajor(l.unitCost),
    taxRatePercent: l.taxRatePercent,
    taxRateId: l.taxRateId ?? null,
    batchNo: l.batchNo ?? null,
    expiryDate: l.expiryDate ?? null,
    costCategory: l.costCategory ?? null,
    ...(l.receiptBillings === undefined ? {} : { receiptBillings: l.receiptBillings.map((b) => ({ lineIndex: b.lineIndex, qty: Qty.fromMajor(b.qty) })) }),
  }));
  return {
    id: row.id,
    documentKind: row.document_kind === InvoiceDocumentKind.RetentionRelease ? InvoiceDocumentKind.RetentionRelease : InvoiceDocumentKind.Standard,
    number: row.number,
    supplierId: row.supplier_id,
    date: row.date,
    dueDate: row.due_date,
    supplierInvoiceNumber: row.supplier_invoice_number,
    branchId: row.branch_id,
    warehouseId: row.warehouse_id,
    currency: row.currency,
    notes: row.notes,
    receiptId: row.receipt_id,
    projectId: row.project_id,
    fxRate: row.fx_rate,
    lines,
    status: row.status as PurchaseInvoiceStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const UPSERT_PI = `INSERT INTO purchase_invoice (id, number, supplier_id, date, due_date, supplier_invoice_number, branch_id, warehouse_id, currency, notes, receipt_id, project_id, lines, status, fx_rate, created_by, created_at, document_kind)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    supplier_id = excluded.supplier_id, date = excluded.date, due_date = excluded.due_date,
    supplier_invoice_number = excluded.supplier_invoice_number, branch_id = excluded.branch_id,
    warehouse_id = excluded.warehouse_id, currency = excluded.currency, notes = excluded.notes,
    receipt_id = excluded.receipt_id, project_id = excluded.project_id, lines = excluded.lines, status = excluded.status,
    fx_rate = excluded.fx_rate`;

function piParams(inv: PurchaseInvoice): SqlValue[] {
  return [
    inv.id,
    inv.number,
    inv.supplierId,
    inv.date,
    inv.dueDate,
    inv.supplierInvoiceNumber,
    inv.branchId,
    inv.warehouseId,
    inv.currency,
    inv.notes,
    inv.receiptId,
    inv.projectId ?? null,
    purchaseInvoiceLinesJson(inv),
    inv.status,
    inv.fxRate ?? null,
    inv.createdBy,
    inv.createdAt,
    inv.documentKind ?? InvoiceDocumentKind.Standard,
  ];
}

class SqlPurchaseInvoiceStore implements PurchaseInvoiceRepository {
  constructor(private readonly db: SqlDb, private readonly versions?: DocumentVersionStore) {}

  async findById(id: string): Promise<PurchaseInvoice | null> {
    const row = await this.db.get<PiRow>(`SELECT * FROM purchase_invoice WHERE id = ?`, [id]);
    return row ? piToDomain(row) : null;
  }

  private clausesFor(filter: PurchaseInvoiceListFilter): FilterClauses {
    const where = new FilterClauses()
      .eq("status", filter.status)
      .eq("supplier_id", filter.supplierId)
      .gte("date", filter.fromDate)
      .lte("date", filter.toDate)
      .eq("branch_id", filter.branchId)
      .eq("warehouse_id", filter.warehouseId)
      .eq("receipt_id", filter.receiptId);
    if (filter.statusIn) {
      // An empty set matches nothing, exactly as asked — dropping the clause
      // would widen it to every status.
      if (filter.statusIn.length === 0) where.raw("0 = 1");
      else where.raw(`status IN (${placeholders(filter.statusIn.length)})`, ...filter.statusIn);
    }
    const term = filter.search?.trim();
    if (term) {
      const like = `%${escapeLike(term.toLowerCase())}%`;
      const named = filter.searchSupplierIds ?? [];
      const byName = named.length > 0 ? ` OR supplier_id IN (${placeholders(named.length)})` : "";
      where.raw(`(LOWER(number) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(supplier_invoice_number, '')) LIKE ? ESCAPE '\\'${byName})`, like, like, ...named);
    }
    return where;
  }

  async list(filter: PurchaseInvoiceListFilter = {}): Promise<PurchaseInvoice[]> {
    const rows = await selectPageAsync<PiRow>(this.db, {
      table: "purchase_invoice",
      where: this.clausesFor(filter),
      orderBy: "date, id",
      page: { limit: filter.limit, offset: filter.offset },
    });
    return rows.map(piToDomain);
  }

  async count(filter: PurchaseInvoiceListFilter = {}): Promise<number> {
    return countMatchingAsync(this.db, "purchase_invoice", this.clausesFor(filter));
  }
  async create(invoice: PurchaseInvoice): Promise<void> {
    await insertNew(this.db, invoice.id, UPSERT_PI, piParams(invoice));
  }
  async update(invoice: PurchaseInvoice): Promise<void> {
    await this.db.run(UPSERT_PI, piParams(invoice));
    // N-9: any write moves the version, whichever path made the change.
    await this.versions?.bump(invoice.id);
  }
  async writeFields(next: PurchaseInvoice, fields: readonly PurchaseInvoiceField[], expected: { readonly status: PurchaseInvoice["status"] }): Promise<boolean> {
    const written = await writeRowColumnsWhereAsync(this.db, {
      table: "purchase_invoice",
      row: { status: next.status, fx_rate: next.fxRate ?? null, lines: purchaseInvoiceLinesJson(next) },
      columns: columnsOf(PURCHASE_INVOICE_COLUMNS, fields),
      id: next.id,
      expectedStatuses: [expected.status],
    });
    if (written) await this.versions?.bump(next.id);
    return written;
  }
  async nameLineTaxRate(invoiceId: string, lineIndexes: readonly number[], taxRatePercent: number, taxRateId: string): Promise<number> {
    const row = await this.db.get<PiRow>(`SELECT * FROM purchase_invoice WHERE id = ?`, [invoiceId]);
    if (!row || row.status !== PurchaseInvoiceStatusCode.Confirmed) return 0;
    const lines = JSON.parse(row.lines) as { taxRatePercent: number; taxRateId?: string | null }[];
    let named = 0;
    for (const index of new Set(lineIndexes)) {
      const line = lines[index];
      if (!line || (line.taxRateId ?? null) !== null || line.taxRatePercent !== taxRatePercent) continue;
      line.taxRateId = taxRateId;
      named += 1;
    }
    if (named === 0) return 0;
    const { changes: written } = await this.db.run(
      `UPDATE purchase_invoice SET lines = ? WHERE id = ? AND status = ? AND lines = ?`,
      [JSON.stringify(lines), invoiceId, PurchaseInvoiceStatusCode.Confirmed, row.lines],
    );
    if (written === 0) return 0;
    await this.versions?.bump(invoiceId);
    return named;
  }
}

// --- Factories -------------------------------------------------------------

export interface SqlitePurchaseOrderStoreHandle extends PurchaseOrderRepository {
  /** N-9 — the row version an optimistic update compares against. */
  readonly versions: DocumentVersionStore;
  close(): void;
}
export interface SqliteGoodsReceiptStoreHandle extends GoodsReceiptRepository {
  close(): void;
}
export interface SqlitePurchaseInvoiceStoreHandle extends PurchaseInvoiceRepository {
  /** N-9 — the row version an optimistic update compares against. */
  readonly versions: DocumentVersionStore;
  close(): void;
}

export async function ensurePurchasingSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_PO);
  await db.applySchema(CREATE_GR);
  await db.applySchema(CREATE_PI);
}

export function createPurchaseOrderStore(db: SqlDb): PurchaseOrderRepository & { readonly versions: DocumentVersionStore } {
  const versions = createSqlDocumentVersionStore(db, "purchase_order");
  return Object.assign(new SqlPurchaseOrderStore(db, versions), { versions });
}

export function createGoodsReceiptStore(db: SqlDb): GoodsReceiptRepository {
  return new SqlGoodsReceiptStore(db);
}

export function createPurchaseInvoiceStore(db: SqlDb): PurchaseInvoiceRepository & { readonly versions: DocumentVersionStore } {
  const versions = createSqlDocumentVersionStore(db, "purchase_invoice");
  return Object.assign(new SqlPurchaseInvoiceStore(db, versions), { versions });
}

/** Open a SQLite-backed PurchaseOrderRepository. ":memory:" for tests, a path for real. */
export function createSqlitePurchaseOrderStore(path: SqliteConnectionInput = ":memory:"): SqlitePurchaseOrderStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_PO);
  addVersionColumns(sqlite, "purchase_order");
  return Object.assign(createPurchaseOrderStore(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}

/** Add a column in place when an existing books file predates it — `CREATE TABLE IF NOT EXISTS` never widens an existing table. */
// ORDER MATTERS: `pending` is read before CREATE_PI runs — running it brings an
// older table up to the declared shape, after which the column always exists.
function purchaseInvoiceKindUnrecorded(sqlite: Database.Database): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(purchase_invoice)`).all() as { name: string }[];
  return columns.length > 0 && !columns.some((c) => c.name === "document_kind");
}

function markPurchaseRetentionReleases(sqlite: Database.Database, pending: boolean): void {
  if (!pending) return;
  markInvoicesNamedByRegister(sqlite, { table: "purchase_invoice", register: "subcontract_retention_release", kind: InvoiceDocumentKind.RetentionRelease });
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, ddl: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/** Open a SQLite-backed GoodsReceiptRepository. */
export function createSqliteGoodsReceiptStore(path: SqliteConnectionInput = ":memory:"): SqliteGoodsReceiptStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_GR);
  // `project_id` arrived after the table shipped (D-01).
  addColumnIfMissing(sqlite, "goods_receipt", "project_id", "project_id TEXT");
  return Object.assign(createGoodsReceiptStore(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}

/** Open a SQLite-backed PurchaseInvoiceRepository. */
export function createSqlitePurchaseInvoiceStore(path: SqliteConnectionInput = ":memory:"): SqlitePurchaseInvoiceStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  const kindUnrecorded = purchaseInvoiceKindUnrecorded(sqlite);
  sqlite.exec(CREATE_PI);
  // `fx_rate`/`project_id` arrived after the table shipped; add them in place.
  addColumnIfMissing(sqlite, "purchase_invoice", "fx_rate", "fx_rate TEXT");
  addColumnIfMissing(sqlite, "purchase_invoice", "project_id", "project_id TEXT");
  markPurchaseRetentionReleases(sqlite, kindUnrecorded);
  addVersionColumns(sqlite, "purchase_invoice");
  return Object.assign(createPurchaseInvoiceStore(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } });
}

/**
 * Open all three purchase-chain stores on ONE shared connection — the shape the
 * API mounts, so the whole chain lives in a single database file.
 */
export interface SqlitePurchasingStores {
  readonly orders: PurchaseOrderRepository;
  readonly receipts: GoodsReceiptRepository;
  readonly invoices: PurchaseInvoiceRepository;
  close(): void;
}

export function createSqlitePurchasingStores(path: SqliteConnectionInput = ":memory:"): SqlitePurchasingStores {
  const { sqlite, owned } = openSqliteConnection(path);
  const kindUnrecorded = purchaseInvoiceKindUnrecorded(sqlite);
  sqlite.exec(CREATE_PO);
  sqlite.exec(CREATE_GR);
  sqlite.exec(CREATE_PI);
  addColumnIfMissing(sqlite, "goods_receipt", "project_id", "project_id TEXT");
  addColumnIfMissing(sqlite, "purchase_invoice", "fx_rate", "fx_rate TEXT");
  addColumnIfMissing(sqlite, "purchase_invoice", "project_id", "project_id TEXT");
  markPurchaseRetentionReleases(sqlite, kindUnrecorded);
  const db = sqliteDb(sqlite);
  return {
    orders: new SqlPurchaseOrderStore(db),
    receipts: new SqlGoodsReceiptStore(db),
    invoices: new SqlPurchaseInvoiceStore(db),
    close: () => { if (owned) sqlite.close(); },
  };
}
