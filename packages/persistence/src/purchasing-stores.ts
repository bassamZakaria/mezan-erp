import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceLineKind,
  type PurchaseInvoiceRepository,
  type PurchaseInvoiceStatus,
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
  created_at             TEXT NOT NULL
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

class SqlitePurchaseOrderStore implements PurchaseOrderRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO purchase_order (id, number, supplier_id, date, expected_delivery_date, branch_id, warehouse_id, currency, notes, lines, status, created_by, created_at)
      VALUES (@id, @number, @supplier_id, @date, @expected_delivery_date, @branch_id, @warehouse_id, @currency, @notes, @lines, @status, @created_by, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        supplier_id = excluded.supplier_id, date = excluded.date,
        expected_delivery_date = excluded.expected_delivery_date, branch_id = excluded.branch_id,
        warehouse_id = excluded.warehouse_id, currency = excluded.currency, notes = excluded.notes,
        lines = excluded.lines, status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM purchase_order WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM purchase_order`);
  }

  async findById(id: string): Promise<PurchaseOrder | null> {
    const row = this.selectById.get(id) as PoRow | undefined;
    return row ? poToDomain(row) : null;
  }
  async list(): Promise<PurchaseOrder[]> {
    return (this.selectAll.all() as PoRow[]).map(poToDomain);
  }
  async create(order: PurchaseOrder): Promise<void> {
    this.write(order);
  }
  async update(order: PurchaseOrder): Promise<void> {
    this.write(order);
  }
  private write(o: PurchaseOrder): void {
    this.upsert.run({
      id: o.id,
      number: o.number,
      supplier_id: o.supplierId,
      date: o.date,
      expected_delivery_date: o.expectedDeliveryDate,
      branch_id: o.branchId,
      warehouse_id: o.warehouseId,
      currency: o.currency,
      notes: o.notes,
      lines: JSON.stringify(
        o.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
          receivedQty: l.receivedQty.toString(),
        })),
      ),
      status: o.status,
      created_by: o.createdBy,
      created_at: o.createdAt,
    });
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
  invoiced: number;
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
  }[]).map<GoodsReceiptLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    qty: Qty.fromMajor(l.qty),
    unitCost: Money.fromMajor(l.unitCost),
    batchNo: l.batchNo ?? null,
    expiryDate: l.expiryDate ?? null,
    costCategory: l.costCategory ?? null,
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
    invoiced: row.invoiced === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class SqliteGoodsReceiptStore implements GoodsReceiptRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByOrder: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO goods_receipt (id, number, purchase_order_id, supplier_id, warehouse_id, date, notes, project_id, lines, status, invoiced, created_by, created_at)
      VALUES (@id, @number, @purchase_order_id, @supplier_id, @warehouse_id, @date, @notes, @project_id, @lines, @status, @invoiced, @created_by, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        supplier_id = excluded.supplier_id, warehouse_id = excluded.warehouse_id, date = excluded.date,
        notes = excluded.notes, project_id = excluded.project_id, lines = excluded.lines, status = excluded.status, invoiced = excluded.invoiced
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM goods_receipt WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM goods_receipt`);
    this.selectByOrder = sqlite.prepare(`SELECT * FROM goods_receipt WHERE purchase_order_id = ?`);
  }

  async findById(id: string): Promise<GoodsReceipt | null> {
    const row = this.selectById.get(id) as GrRow | undefined;
    return row ? grToDomain(row) : null;
  }
  async list(): Promise<GoodsReceipt[]> {
    return (this.selectAll.all() as GrRow[]).map(grToDomain);
  }
  async listByOrder(purchaseOrderId: string): Promise<GoodsReceipt[]> {
    return (this.selectByOrder.all(purchaseOrderId) as GrRow[]).map(grToDomain);
  }
  async create(receipt: GoodsReceipt): Promise<void> {
    this.write(receipt);
  }
  async update(receipt: GoodsReceipt): Promise<void> {
    this.write(receipt);
  }
  private write(r: GoodsReceipt): void {
    this.upsert.run({
      id: r.id,
      number: r.number,
      purchase_order_id: r.purchaseOrderId,
      supplier_id: r.supplierId,
      warehouse_id: r.warehouseId,
      date: r.date,
      notes: r.notes,
      project_id: r.projectId ?? null,
      lines: JSON.stringify(
        r.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          qty: l.qty.toString(),
          unitCost: l.unitCost.toString(),
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
          costCategory: l.costCategory ?? null,
        })),
      ),
      status: r.status,
      invoiced: r.invoiced ? 1 : 0,
      created_by: r.createdBy,
      created_at: r.createdAt,
    });
  }
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
  created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pi_supplier ON purchase_invoice(supplier_id);
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
}

function piToDomain(row: PiRow): PurchaseInvoice {
  const lines = (JSON.parse(row.lines) as {
    itemId: string | null;
    description: string | null;
    kind: string;
    qty: string;
    unitCost: string;
    taxRatePercent: number;
    batchNo?: string | null;
    expiryDate?: string | null;
    costCategory?: PurchaseInvoiceLine["costCategory"];
  }[]).map<PurchaseInvoiceLine>((l) => ({
    itemId: l.itemId,
    description: l.description,
    kind: l.kind as PurchaseInvoiceLineKind,
    qty: Qty.fromMajor(l.qty),
    unitCost: Money.fromMajor(l.unitCost),
    taxRatePercent: l.taxRatePercent,
    batchNo: l.batchNo ?? null,
    expiryDate: l.expiryDate ?? null,
    costCategory: l.costCategory ?? null,
  }));
  return {
    id: row.id,
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

class SqlitePurchaseInvoiceStore implements PurchaseInvoiceRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO purchase_invoice (id, number, supplier_id, date, due_date, supplier_invoice_number, branch_id, warehouse_id, currency, notes, receipt_id, project_id, lines, status, fx_rate, created_by, created_at)
      VALUES (@id, @number, @supplier_id, @date, @due_date, @supplier_invoice_number, @branch_id, @warehouse_id, @currency, @notes, @receipt_id, @project_id, @lines, @status, @fx_rate, @created_by, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        supplier_id = excluded.supplier_id, date = excluded.date, due_date = excluded.due_date,
        supplier_invoice_number = excluded.supplier_invoice_number, branch_id = excluded.branch_id,
        warehouse_id = excluded.warehouse_id, currency = excluded.currency, notes = excluded.notes,
        receipt_id = excluded.receipt_id, project_id = excluded.project_id, lines = excluded.lines, status = excluded.status,
        fx_rate = excluded.fx_rate
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM purchase_invoice WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM purchase_invoice`);
  }

  async findById(id: string): Promise<PurchaseInvoice | null> {
    const row = this.selectById.get(id) as PiRow | undefined;
    return row ? piToDomain(row) : null;
  }
  async list(): Promise<PurchaseInvoice[]> {
    return (this.selectAll.all() as PiRow[]).map(piToDomain);
  }
  async create(invoice: PurchaseInvoice): Promise<void> {
    this.write(invoice);
  }
  async update(invoice: PurchaseInvoice): Promise<void> {
    this.write(invoice);
  }
  private write(inv: PurchaseInvoice): void {
    this.upsert.run({
      id: inv.id,
      number: inv.number,
      supplier_id: inv.supplierId,
      date: inv.date,
      due_date: inv.dueDate,
      supplier_invoice_number: inv.supplierInvoiceNumber,
      branch_id: inv.branchId,
      warehouse_id: inv.warehouseId,
      currency: inv.currency,
      notes: inv.notes,
      receipt_id: inv.receiptId,
      project_id: inv.projectId ?? null,
      lines: JSON.stringify(
        inv.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          kind: l.kind,
          qty: l.qty.toString(),
          unitCost: l.unitCost.toString(),
          taxRatePercent: l.taxRatePercent,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
          costCategory: l.costCategory ?? null,
        })),
      ),
      status: inv.status,
      fx_rate: inv.fxRate ?? null,
      created_by: inv.createdBy,
      created_at: inv.createdAt,
    });
  }
}

// --- Factories -------------------------------------------------------------

export interface SqlitePurchaseOrderStoreHandle extends PurchaseOrderRepository {
  close(): void;
}
export interface SqliteGoodsReceiptStoreHandle extends GoodsReceiptRepository {
  close(): void;
}
export interface SqlitePurchaseInvoiceStoreHandle extends PurchaseInvoiceRepository {
  close(): void;
}

/** Open a SQLite-backed PurchaseOrderRepository. ":memory:" for tests, a path for real. */
export function createSqlitePurchaseOrderStore(path: SqliteConnectionInput = ":memory:"): SqlitePurchaseOrderStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_PO);
  return Object.assign(new SqlitePurchaseOrderStore(sqlite), { close: () => { if (owned) sqlite.close(); } });
}

/** Add a column in place when an existing books file predates it — `CREATE TABLE IF NOT EXISTS` never widens an existing table. */
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
  return Object.assign(new SqliteGoodsReceiptStore(sqlite), { close: () => { if (owned) sqlite.close(); } });
}

/** Open a SQLite-backed PurchaseInvoiceRepository. */
export function createSqlitePurchaseInvoiceStore(path: SqliteConnectionInput = ":memory:"): SqlitePurchaseInvoiceStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_PI);
  // `fx_rate`/`project_id` arrived after the table shipped; add them in place.
  addColumnIfMissing(sqlite, "purchase_invoice", "fx_rate", "fx_rate TEXT");
  addColumnIfMissing(sqlite, "purchase_invoice", "project_id", "project_id TEXT");
  return Object.assign(new SqlitePurchaseInvoiceStore(sqlite), { close: () => { if (owned) sqlite.close(); } });
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
  sqlite.exec(CREATE_PO);
  sqlite.exec(CREATE_GR);
  sqlite.exec(CREATE_PI);
  addColumnIfMissing(sqlite, "goods_receipt", "project_id", "project_id TEXT");
  addColumnIfMissing(sqlite, "purchase_invoice", "fx_rate", "fx_rate TEXT");
  addColumnIfMissing(sqlite, "purchase_invoice", "project_id", "project_id TEXT");
  return {
    orders: new SqlitePurchaseOrderStore(sqlite),
    receipts: new SqliteGoodsReceiptStore(sqlite),
    invoices: new SqlitePurchaseInvoiceStore(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
