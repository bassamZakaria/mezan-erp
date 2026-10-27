import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type Bom,
  type BomLine,
  type BomRepository,
  type ActivationStatus,
  type WorkOrder,
  type WorkOrderMaterial,
  type WorkOrderCostLogEntry,
  type WorkOrderWasteEntry,
  type WorkOrderShopFloorEntry,
  type WorkOrderRepository,
  type WorkStation,
  type WorkStationRepository,
  type WorkOrderStatus,
  type WorkOrderStage,
  type WorkOrderPriority,
  type ConfigurableProduct,
  type ConfigInput,
  type MaterialFormula,
  type ConfigurableProductRepository,
  type PricingMethod,
  type ItemPolicy,
  type ConfigInstance,
  type ConfigInstanceMaterial,
  type ConfigInstanceRepository,
  type ConfigInstanceStatus,
} from "@mezan/domain";

/**
 * Self-contained SQLite stores for the manufacturing module (docs/archive/catalog/07),
 * following the same standalone-store pattern as purchasing-stores.ts. Nested
 * collections (lines, materials, logs, spec) are document-owned with no
 * independent query need, so they are kept as JSON text columns — Money/Qty
 * serialised as EXACT decimal strings, round-tripped via fromMajor (never floats).
 */

// --- BOM -------------------------------------------------------------------

const CREATE_BOM = `
CREATE TABLE IF NOT EXISTS bom (
  id              TEXT PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,
  product_item_id TEXT NOT NULL,
  version         INTEGER NOT NULL,
  standard_qty    TEXT NOT NULL,
  unit            TEXT NOT NULL,
  labor_cost      TEXT NOT NULL,
  overhead_cost   TEXT NOT NULL,
  version_notes   TEXT,
  lines           TEXT NOT NULL,
  status          TEXT NOT NULL,
  custom          INTEGER NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bom_product ON bom(product_item_id);
`;

interface BomRow {
  id: string;
  number: string;
  product_item_id: string;
  version: bigint;
  standard_qty: string;
  unit: string;
  labor_cost: string;
  overhead_cost: string;
  version_notes: string | null;
  lines: string;
  status: string;
  custom: bigint;
  created_by: string;
  created_at: string;
}

function bomToDomain(row: BomRow): Bom {
  const lines = (JSON.parse(row.lines) as {
    itemId: string;
    qty: string;
    wastePercent: number;
    optional: boolean;
    notes: string | null;
  }[]).map<BomLine>((l) => ({
    itemId: l.itemId,
    qty: Qty.fromMajor(l.qty),
    wastePercent: l.wastePercent,
    optional: l.optional,
    notes: l.notes,
  }));
  return {
    id: row.id,
    number: row.number,
    productItemId: row.product_item_id,
    version: Number(row.version),
    standardQty: Qty.fromMajor(row.standard_qty),
    unit: row.unit,
    laborCost: Money.fromMajor(row.labor_cost),
    overheadCost: Money.fromMajor(row.overhead_cost),
    versionNotes: row.version_notes,
    lines,
    status: row.status as ActivationStatus,
    custom: Number(row.custom) === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const UPSERT_BOM = `
      INSERT INTO bom (id, number, product_item_id, version, standard_qty, unit, labor_cost, overhead_cost, version_notes, lines, status, custom, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        product_item_id = excluded.product_item_id, version = excluded.version,
        standard_qty = excluded.standard_qty, unit = excluded.unit, labor_cost = excluded.labor_cost,
        overhead_cost = excluded.overhead_cost, version_notes = excluded.version_notes,
        lines = excluded.lines, status = excluded.status, custom = excluded.custom
    `;

function bomParams(b: Bom): SqlValue[] {
  return [
    b.id,
    b.number,
    b.productItemId,
    b.version,
    b.standardQty.toString(),
    b.unit,
    b.laborCost.toString(),
    b.overheadCost.toString(),
    b.versionNotes,
    JSON.stringify(
        b.lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty.toString(),
          wastePercent: l.wastePercent,
          optional: l.optional,
          notes: l.notes,
        })),
      ),
    b.status,
    b.custom ? 1 : 0,
    b.createdBy,
    b.createdAt,
  ];
}

class SqlBomStore implements BomRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Bom | null> {
    const row = await this.db.get<BomRow>(`SELECT * FROM bom WHERE id = ?`, [id]);
    return row ? bomToDomain(row) : null;
  }
  async list(): Promise<Bom[]> {
    return (await this.db.all<BomRow>(`SELECT * FROM bom`)).map(bomToDomain);
  }
  async listByProduct(productItemId: string): Promise<Bom[]> {
    return (await this.db.all<BomRow>(`SELECT * FROM bom WHERE product_item_id = ?`, [productItemId])).map(bomToDomain);
  }
  async create(bom: Bom): Promise<void> {
    await insertNew(this.db, bom.id, UPSERT_BOM, bomParams(bom));
  }
  async update(bom: Bom): Promise<void> {
    await this.db.run(UPSERT_BOM, bomParams(bom));
  }
}

// --- Work Order ------------------------------------------------------------

const CREATE_WO = `
CREATE TABLE IF NOT EXISTS work_order (
  id                      TEXT PRIMARY KEY,
  number                  TEXT NOT NULL UNIQUE,
  bom_id                  TEXT NOT NULL,
  bom_version             INTEGER NOT NULL,
  product_item_id         TEXT NOT NULL,
  planned_qty             TEXT NOT NULL,
  produced_qty            TEXT NOT NULL,
  source_warehouse_id     TEXT NOT NULL,
  wip_warehouse_id        TEXT NOT NULL DEFAULT '',
  destination_warehouse_id TEXT NOT NULL,
  priority                TEXT NOT NULL,
  scheduled_start_date    TEXT NOT NULL,
  scheduled_end_date      TEXT,
  notes                   TEXT,
  status                  TEXT NOT NULL,
  stage                   TEXT NOT NULL,
  materials               TEXT NOT NULL,
  material_cost           TEXT NOT NULL,
  labor_cost              TEXT NOT NULL,
  overhead_cost           TEXT NOT NULL,
  extra_cost              TEXT NOT NULL,
  cost_log                TEXT NOT NULL,
  waste_log               TEXT NOT NULL,
  shop_floor_log          TEXT NOT NULL DEFAULT '[]',
  config_instance_id      TEXT,
  gl_posted               INTEGER NOT NULL,
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  started_at             TEXT,
  issued_at              TEXT,
  received_at            TEXT,
  completed_at           TEXT,
  project_id             TEXT
);
CREATE INDEX IF NOT EXISTS idx_wo_bom ON work_order(bom_id);
CREATE INDEX IF NOT EXISTS idx_wo_ci ON work_order(config_instance_id);
`;

interface WoRow {
  id: string;
  number: string;
  bom_id: string;
  bom_version: bigint;
  product_item_id: string;
  planned_qty: string;
  produced_qty: string;
  source_warehouse_id: string;
  wip_warehouse_id: string | null;
  destination_warehouse_id: string;
  priority: string;
  scheduled_start_date: string;
  scheduled_end_date: string | null;
  notes: string | null;
  status: string;
  stage: string;
  materials: string;
  material_cost: string;
  labor_cost: string;
  overhead_cost: string;
  extra_cost: string;
  cost_log: string;
  waste_log: string;
  shop_floor_log: string | null;
  config_instance_id: string | null;
  gl_posted: bigint;
  created_by: string;
  created_at: string;
  started_at: string | null;
  issued_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  project_id: string | null;
}

function woToDomain(row: WoRow): WorkOrder {
  const materials = (JSON.parse(row.materials) as {
    itemId: string;
    requiredQty: string;
    wastePercent: number;
    optional: boolean;
    issuedQty: string;
    returnedQty: string;
    issuedUnitCost: string;
  }[]).map<WorkOrderMaterial>((m) => ({
    itemId: m.itemId,
    requiredQty: Qty.fromMajor(m.requiredQty),
    wastePercent: m.wastePercent,
    optional: m.optional,
    issuedQty: Qty.fromMajor(m.issuedQty),
    returnedQty: Qty.fromMajor(m.returnedQty),
    issuedUnitCost: Money.fromMajor(m.issuedUnitCost),
  }));
  const costLog = (JSON.parse(row.cost_log) as {
    kind: WorkOrderCostLogEntry["kind"];
    amount: string;
    notes: string | null;
    at: string;
  }[]).map<WorkOrderCostLogEntry>((c) => ({
    kind: c.kind,
    amount: Money.fromMajor(c.amount),
    notes: c.notes,
    at: c.at,
  }));
  // Rows written before waste moved stock (D64) carry only itemId/qty/notes/at.
  // They stay legacy: `stockMoved` false, no split, no cost — their material is
  // still standing in مستودع التشغيل and is still consumed at receipt, exactly
  // as it was when they were written. Restating a closed run is not a migration.
  const wasteLog = (JSON.parse(row.waste_log) as {
    itemId: string;
    qty: string;
    notes: string | null;
    at: string;
    stockMoved?: boolean;
    normalQty?: string;
    abnormalQty?: string;
    normalCost?: string;
    abnormalCost?: string;
  }[]).map<WorkOrderWasteEntry>((w) => ({
    itemId: w.itemId,
    qty: Qty.fromMajor(w.qty),
    notes: w.notes,
    at: w.at,
    stockMoved: w.stockMoved ?? false,
    normalQty: w.normalQty === undefined ? Qty.zero() : Qty.fromMajor(w.normalQty),
    abnormalQty: w.abnormalQty === undefined ? Qty.zero() : Qty.fromMajor(w.abnormalQty),
    normalCost: w.normalCost === undefined ? Money.zero() : Money.fromMajor(w.normalCost),
    abnormalCost: w.abnormalCost === undefined ? Money.zero() : Money.fromMajor(w.abnormalCost),
  }));
  return {
    id: row.id,
    number: row.number,
    bomId: row.bom_id,
    bomVersion: Number(row.bom_version),
    productItemId: row.product_item_id,
    plannedQty: Qty.fromMajor(row.planned_qty),
    producedQty: Qty.fromMajor(row.produced_qty),
    sourceWarehouseId: row.source_warehouse_id,
    // Rows written before WIP had a location carry none; every stock-moving
    // stage refuses such an order rather than issuing into thin air.
    wipWarehouseId: row.wip_warehouse_id ?? "",
    destinationWarehouseId: row.destination_warehouse_id,
    priority: row.priority as WorkOrderPriority,
    scheduledStartDate: row.scheduled_start_date,
    scheduledEndDate: row.scheduled_end_date,
    notes: row.notes,
    status: row.status as WorkOrderStatus,
    stage: row.stage as WorkOrderStage,
    materials,
    materialCost: Money.fromMajor(row.material_cost),
    laborCost: Money.fromMajor(row.labor_cost),
    overheadCost: Money.fromMajor(row.overhead_cost),
    extraCost: Money.fromMajor(row.extra_cost),
    costLog,
    wasteLog,
    // Rows written before R9.1 carry no shop-floor log.
    shopFloorLog: JSON.parse(row.shop_floor_log ?? "[]") as WorkOrderShopFloorEntry[],
    configInstanceId: row.config_instance_id,
    glPosted: Number(row.gl_posted) === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    issuedAt: row.issued_at,
    receivedAt: row.received_at,
    completedAt: row.completed_at,
    projectId: row.project_id,
  };
}

const UPSERT_WORK_ORDER = `
      INSERT INTO work_order (id, number, bom_id, bom_version, product_item_id, planned_qty, produced_qty, source_warehouse_id, wip_warehouse_id, destination_warehouse_id, priority, scheduled_start_date, scheduled_end_date, notes, status, stage, materials, material_cost, labor_cost, overhead_cost, extra_cost, cost_log, waste_log, shop_floor_log, config_instance_id, gl_posted, created_by, created_at, started_at, issued_at, received_at, completed_at, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        planned_qty = excluded.planned_qty, produced_qty = excluded.produced_qty,
        source_warehouse_id = excluded.source_warehouse_id, wip_warehouse_id = excluded.wip_warehouse_id,
        destination_warehouse_id = excluded.destination_warehouse_id,
        priority = excluded.priority, scheduled_start_date = excluded.scheduled_start_date,
        scheduled_end_date = excluded.scheduled_end_date, notes = excluded.notes,
        status = excluded.status, stage = excluded.stage, materials = excluded.materials,
        material_cost = excluded.material_cost, labor_cost = excluded.labor_cost,
        overhead_cost = excluded.overhead_cost, extra_cost = excluded.extra_cost,
        cost_log = excluded.cost_log, waste_log = excluded.waste_log,
        shop_floor_log = excluded.shop_floor_log, gl_posted = excluded.gl_posted,
        started_at = excluded.started_at, issued_at = excluded.issued_at,
        received_at = excluded.received_at, completed_at = excluded.completed_at,
        project_id = excluded.project_id
    `;

function workOrderParams(o: WorkOrder): SqlValue[] {
  return [
    o.id,
    o.number,
    o.bomId,
    o.bomVersion,
    o.productItemId,
    o.plannedQty.toString(),
    o.producedQty.toString(),
    o.sourceWarehouseId,
    o.wipWarehouseId,
    o.destinationWarehouseId,
    o.priority,
    o.scheduledStartDate,
    o.scheduledEndDate,
    o.notes,
    o.status,
    o.stage,
    JSON.stringify(
        o.materials.map((m) => ({
          itemId: m.itemId,
          requiredQty: m.requiredQty.toString(),
          wastePercent: m.wastePercent,
          optional: m.optional,
          issuedQty: m.issuedQty.toString(),
          returnedQty: m.returnedQty.toString(),
          issuedUnitCost: m.issuedUnitCost.toString(),
        })),
      ),
    o.materialCost.toString(),
    o.laborCost.toString(),
    o.overheadCost.toString(),
    o.extraCost.toString(),
    JSON.stringify(
        o.costLog.map((c) => ({ kind: c.kind, amount: c.amount.toString(), notes: c.notes, at: c.at })),
      ),
    JSON.stringify(
        o.wasteLog.map((w) => ({
          itemId: w.itemId,
          qty: w.qty.toString(),
          notes: w.notes,
          at: w.at,
          stockMoved: w.stockMoved,
          normalQty: w.normalQty.toString(),
          abnormalQty: w.abnormalQty.toString(),
          normalCost: w.normalCost.toString(),
          abnormalCost: w.abnormalCost.toString(),
        })),
      ),
    JSON.stringify(o.shopFloorLog),
    o.configInstanceId,
    o.glPosted ? 1 : 0,
    o.createdBy,
    o.createdAt,
    o.startedAt,
    o.issuedAt,
    o.receivedAt,
    o.completedAt,
    o.projectId,
  ];
}

class SqlWorkOrderStore implements WorkOrderRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<WorkOrder | null> {
    const row = await this.db.get<WoRow>(`SELECT * FROM work_order WHERE id = ?`, [id]);
    return row ? woToDomain(row) : null;
  }
  async list(): Promise<WorkOrder[]> {
    return (await this.db.all<WoRow>(`SELECT * FROM work_order`)).map(woToDomain);
  }
  async create(order: WorkOrder): Promise<void> {
    await insertNew(this.db, order.id, UPSERT_WORK_ORDER, workOrderParams(order));
  }
  async update(order: WorkOrder): Promise<void> {
    await this.db.run(UPSERT_WORK_ORDER, workOrderParams(order));
  }
}

// --- Configurable Product --------------------------------------------------

const CREATE_CP = `
CREATE TABLE IF NOT EXISTS configurable_product (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  output_item_id  TEXT NOT NULL,
  unit            TEXT NOT NULL,
  description     TEXT,
  inputs          TEXT NOT NULL,
  materials       TEXT NOT NULL,
  pricing_method  TEXT NOT NULL,
  price_formula   TEXT,
  labor_formula   TEXT,
  overhead_formula TEXT,
  item_policy     TEXT NOT NULL,
  status          TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
`;

interface CpRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  output_item_id: string;
  unit: string;
  description: string | null;
  inputs: string;
  materials: string;
  pricing_method: string;
  price_formula: string | null;
  labor_formula: string | null;
  overhead_formula: string | null;
  item_policy: string;
  status: string;
  created_by: string;
  created_at: string;
}

function cpToDomain(row: CpRow): ConfigurableProduct {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    outputItemId: row.output_item_id,
    unit: row.unit,
    description: row.description,
    inputs: JSON.parse(row.inputs) as ConfigInput[],
    materials: JSON.parse(row.materials) as MaterialFormula[],
    pricingMethod: row.pricing_method as PricingMethod,
    priceFormula: row.price_formula,
    laborFormula: row.labor_formula,
    overheadFormula: row.overhead_formula,
    itemPolicy: row.item_policy as ItemPolicy,
    status: row.status as ActivationStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const UPSERT_CONFIGURABLE_PRODUCT = `
      INSERT INTO configurable_product (id, code, name_ar, name_en, output_item_id, unit, description, inputs, materials, pricing_method, price_formula, labor_formula, overhead_formula, item_policy, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en,
        output_item_id = excluded.output_item_id, unit = excluded.unit, description = excluded.description,
        inputs = excluded.inputs, materials = excluded.materials, pricing_method = excluded.pricing_method,
        price_formula = excluded.price_formula, labor_formula = excluded.labor_formula,
        overhead_formula = excluded.overhead_formula, item_policy = excluded.item_policy, status = excluded.status
    `;

function configurableProductParams(p: ConfigurableProduct): SqlValue[] {
  return [
    p.id,
    p.code,
    p.nameAr,
    p.nameEn,
    p.outputItemId,
    p.unit,
    p.description,
    JSON.stringify(p.inputs),
    JSON.stringify(p.materials),
    p.pricingMethod,
    p.priceFormula,
    p.laborFormula,
    p.overheadFormula,
    p.itemPolicy,
    p.status,
    p.createdBy,
    p.createdAt,
  ];
}

class SqlConfigurableProductStore implements ConfigurableProductRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<ConfigurableProduct | null> {
    const row = await this.db.get<CpRow>(`SELECT * FROM configurable_product WHERE id = ?`, [id]);
    return row ? cpToDomain(row) : null;
  }
  async findByCode(code: string): Promise<ConfigurableProduct | null> {
    const row = await this.db.get<CpRow>(`SELECT * FROM configurable_product WHERE code = ?`, [code]);
    return row ? cpToDomain(row) : null;
  }
  async list(): Promise<ConfigurableProduct[]> {
    return (await this.db.all<CpRow>(`SELECT * FROM configurable_product`)).map(cpToDomain);
  }
  async create(product: ConfigurableProduct): Promise<void> {
    await insertNew(this.db, product.id, UPSERT_CONFIGURABLE_PRODUCT, configurableProductParams(product));
  }
  async update(product: ConfigurableProduct): Promise<void> {
    await this.db.run(UPSERT_CONFIGURABLE_PRODUCT, configurableProductParams(product));
  }
}

// --- Config Instance -------------------------------------------------------

const CREATE_CI = `
CREATE TABLE IF NOT EXISTS config_instance (
  id                      TEXT PRIMARY KEY,
  number                  TEXT NOT NULL UNIQUE,
  configurable_product_id TEXT NOT NULL,
  product_name_ar         TEXT NOT NULL,
  output_item_id          TEXT NOT NULL,
  spec                    TEXT NOT NULL,
  qty                     TEXT NOT NULL,
  customer_id             TEXT,
  sell_unit_price         TEXT,
  notes                   TEXT,
  status                  TEXT NOT NULL,
  bom_id                  TEXT NOT NULL,
  work_order_id           TEXT NOT NULL,
  materials               TEXT NOT NULL,
  material_cost_per_unit  TEXT NOT NULL,
  labor_cost_per_unit     TEXT NOT NULL,
  overhead_cost_per_unit  TEXT NOT NULL,
  estimated_unit_cost     TEXT NOT NULL,
  actual_cost             TEXT,
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ci_product ON config_instance(configurable_product_id);
`;

interface CiRow {
  id: string;
  number: string;
  configurable_product_id: string;
  product_name_ar: string;
  output_item_id: string;
  spec: string;
  qty: string;
  customer_id: string | null;
  sell_unit_price: string | null;
  notes: string | null;
  status: string;
  bom_id: string;
  work_order_id: string;
  materials: string;
  material_cost_per_unit: string;
  labor_cost_per_unit: string;
  overhead_cost_per_unit: string;
  estimated_unit_cost: string;
  actual_cost: string | null;
  created_by: string;
  created_at: string;
}

function ciToDomain(row: CiRow): ConfigInstance {
  const materials = (JSON.parse(row.materials) as {
    itemId: string;
    qtyPerUnit: string;
    wastePercent: number;
    lineCost: string;
  }[]).map<ConfigInstanceMaterial>((m) => ({
    itemId: m.itemId,
    qtyPerUnit: Qty.fromMajor(m.qtyPerUnit),
    wastePercent: m.wastePercent,
    lineCost: Money.fromMajor(m.lineCost),
  }));
  return {
    id: row.id,
    number: row.number,
    configurableProductId: row.configurable_product_id,
    productNameAr: row.product_name_ar,
    outputItemId: row.output_item_id,
    spec: JSON.parse(row.spec) as Record<string, string>,
    qty: Qty.fromMajor(row.qty),
    customerId: row.customer_id,
    sellUnitPrice: row.sell_unit_price === null ? null : Money.fromMajor(row.sell_unit_price),
    notes: row.notes,
    status: row.status as ConfigInstanceStatus,
    bomId: row.bom_id,
    workOrderId: row.work_order_id,
    materials,
    materialCostPerUnit: Money.fromMajor(row.material_cost_per_unit),
    laborCostPerUnit: Money.fromMajor(row.labor_cost_per_unit),
    overheadCostPerUnit: Money.fromMajor(row.overhead_cost_per_unit),
    estimatedUnitCost: Money.fromMajor(row.estimated_unit_cost),
    actualCost: row.actual_cost === null ? null : Money.fromMajor(row.actual_cost),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const UPSERT_CONFIG_INSTANCE = `
      INSERT INTO config_instance (id, number, configurable_product_id, product_name_ar, output_item_id, spec, qty, customer_id, sell_unit_price, notes, status, bom_id, work_order_id, materials, material_cost_per_unit, labor_cost_per_unit, overhead_cost_per_unit, estimated_unit_cost, actual_cost, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id, sell_unit_price = excluded.sell_unit_price,
        notes = excluded.notes, status = excluded.status, materials = excluded.materials,
        material_cost_per_unit = excluded.material_cost_per_unit, labor_cost_per_unit = excluded.labor_cost_per_unit,
        overhead_cost_per_unit = excluded.overhead_cost_per_unit, estimated_unit_cost = excluded.estimated_unit_cost,
        actual_cost = excluded.actual_cost
    `;

function configInstanceParams(i: ConfigInstance): SqlValue[] {
  return [
    i.id,
    i.number,
    i.configurableProductId,
    i.productNameAr,
    i.outputItemId,
    JSON.stringify(i.spec),
    i.qty.toString(),
    i.customerId,
    i.sellUnitPrice === null ? null : i.sellUnitPrice.toString(),
    i.notes,
    i.status,
    i.bomId,
    i.workOrderId,
    JSON.stringify(
        i.materials.map((m) => ({
          itemId: m.itemId,
          qtyPerUnit: m.qtyPerUnit.toString(),
          wastePercent: m.wastePercent,
          lineCost: m.lineCost.toString(),
        })),
      ),
    i.materialCostPerUnit.toString(),
    i.laborCostPerUnit.toString(),
    i.overheadCostPerUnit.toString(),
    i.estimatedUnitCost.toString(),
    i.actualCost === null ? null : i.actualCost.toString(),
    i.createdBy,
    i.createdAt,
  ];
}

class SqlConfigInstanceStore implements ConfigInstanceRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<ConfigInstance | null> {
    const row = await this.db.get<CiRow>(`SELECT * FROM config_instance WHERE id = ?`, [id]);
    return row ? ciToDomain(row) : null;
  }
  async list(): Promise<ConfigInstance[]> {
    return (await this.db.all<CiRow>(`SELECT * FROM config_instance`)).map(ciToDomain);
  }
  async create(instance: ConfigInstance): Promise<void> {
    await insertNew(this.db, instance.id, UPSERT_CONFIG_INSTANCE, configInstanceParams(instance));
  }
  async update(instance: ConfigInstance): Promise<void> {
    await this.db.run(UPSERT_CONFIG_INSTANCE, configInstanceParams(instance));
  }
}

// --- Work Station ----------------------------------------------------------

const CREATE_WS = `
CREATE TABLE IF NOT EXISTS work_station (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  notes      TEXT,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

interface WsRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

function wsToDomain(row: WsRow): WorkStation {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    notes: row.notes,
    status: row.status as WorkStation["status"],
    createdAt: row.created_at,
  };
}

const UPSERT_WORK_STATION = `
      INSERT INTO work_station (id, code, name_ar, name_en, notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en,
        notes = excluded.notes, status = excluded.status
    `;

function workStationParams(w: WorkStation): SqlValue[] {
  return [
    w.id,
    w.code,
    w.nameAr,
    w.nameEn,
    w.notes,
    w.status,
    w.createdAt,
  ];
}

class SqlWorkStationStore implements WorkStationRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<WorkStation | null> {
    const row = await this.db.get<WsRow>(`SELECT * FROM work_station WHERE id = ?`, [id]);
    return row ? wsToDomain(row) : null;
  }
  async findByCode(code: string): Promise<WorkStation | null> {
    const row = await this.db.get<WsRow>(`SELECT * FROM work_station WHERE code = ?`, [code]);
    return row ? wsToDomain(row) : null;
  }
  async list(): Promise<WorkStation[]> {
    return (await this.db.all<WsRow>(`SELECT * FROM work_station ORDER BY code`)).map(wsToDomain);
  }
  async create(station: WorkStation): Promise<void> {
    await insertNew(this.db, station.id, UPSERT_WORK_STATION, workStationParams(station));
  }
  async update(station: WorkStation): Promise<void> {
    await this.db.run(UPSERT_WORK_STATION, workStationParams(station));
  }
}

// --- Factories -------------------------------------------------------------

/**
 * Open all four manufacturing stores on ONE shared connection — the shape the
 * API mounts, so the whole module lives in a single database file.
 */
export interface ManufacturingStores {
  readonly boms: BomRepository;
  readonly workOrders: WorkOrderRepository;
  readonly configurableProducts: ConfigurableProductRepository;
  readonly configInstances: ConfigInstanceRepository;
  readonly workStations: WorkStationRepository;
}

export interface SqliteManufacturingStores extends ManufacturingStores {
  close(): void;
}

export async function ensureManufacturingSchema(db: SqlDb): Promise<void> {
  await db.applySchema(`${CREATE_BOM}${CREATE_WO}${CREATE_CP}${CREATE_CI}${CREATE_WS}`);
}

export function createManufacturingStores(db: SqlDb): ManufacturingStores {
  return {
    boms: new SqlBomStore(db),
    workOrders: new SqlWorkOrderStore(db),
    configurableProducts: new SqlConfigurableProductStore(db),
    configInstances: new SqlConfigInstanceStore(db),
    workStations: new SqlWorkStationStore(db),
  };
}

export function createSqliteManufacturingStores(path: SqliteConnectionInput = ":memory:"): SqliteManufacturingStores {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_BOM);
  sqlite.exec(CREATE_WO);
  sqlite.exec(CREATE_CP);
  sqlite.exec(CREATE_CI);
  sqlite.exec(CREATE_WS);
  // `shop_floor_log` arrived after the table shipped; CREATE TABLE IF NOT EXISTS
  // will not widen an existing database, so add it in place.
  const woColumns = sqlite.prepare(`PRAGMA table_info(work_order)`).all() as { name: string }[];
  if (!woColumns.some((c) => c.name === "shop_floor_log")) {
    sqlite.exec(`ALTER TABLE work_order ADD COLUMN shop_floor_log TEXT NOT NULL DEFAULT '[]'`);
  }
  // `wip_warehouse_id` likewise. It is deliberately NOT backfilled from
  // source_warehouse_id: issuing into the warehouse the goods came from is the
  // same non-move as having no WIP location at all, and it would pass the
  // "is it set?" check while leaving the floor count exactly as unreconcilable.
  if (!woColumns.some((c) => c.name === "wip_warehouse_id")) {
    sqlite.exec(`ALTER TABLE work_order ADD COLUMN wip_warehouse_id TEXT NOT NULL DEFAULT ''`);
  }
  // بُعد المشروع (D-01) arrived later still.
  if (!woColumns.some((c) => c.name === "project_id")) {
    sqlite.exec(`ALTER TABLE work_order ADD COLUMN project_id TEXT`);
  }
  return { ...createManufacturingStores(sqliteDb(sqlite)), close: () => { if (owned) sqlite.close(); } };
}
