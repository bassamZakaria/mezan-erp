import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  version: number;
  standard_qty: string;
  unit: string;
  labor_cost: string;
  overhead_cost: string;
  version_notes: string | null;
  lines: string;
  status: string;
  custom: number;
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
    version: row.version,
    standardQty: Qty.fromMajor(row.standard_qty),
    unit: row.unit,
    laborCost: Money.fromMajor(row.labor_cost),
    overheadCost: Money.fromMajor(row.overhead_cost),
    versionNotes: row.version_notes,
    lines,
    status: row.status as ActivationStatus,
    custom: row.custom === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class SqliteBomStore implements BomRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByProduct: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO bom (id, number, product_item_id, version, standard_qty, unit, labor_cost, overhead_cost, version_notes, lines, status, custom, created_by, created_at)
      VALUES (@id, @number, @product_item_id, @version, @standard_qty, @unit, @labor_cost, @overhead_cost, @version_notes, @lines, @status, @custom, @created_by, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        product_item_id = excluded.product_item_id, version = excluded.version,
        standard_qty = excluded.standard_qty, unit = excluded.unit, labor_cost = excluded.labor_cost,
        overhead_cost = excluded.overhead_cost, version_notes = excluded.version_notes,
        lines = excluded.lines, status = excluded.status, custom = excluded.custom
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM bom WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM bom`);
    this.selectByProduct = sqlite.prepare(`SELECT * FROM bom WHERE product_item_id = ?`);
  }

  async findById(id: string): Promise<Bom | null> {
    const row = this.selectById.get(id) as BomRow | undefined;
    return row ? bomToDomain(row) : null;
  }
  async list(): Promise<Bom[]> {
    return (this.selectAll.all() as BomRow[]).map(bomToDomain);
  }
  async listByProduct(productItemId: string): Promise<Bom[]> {
    return (this.selectByProduct.all(productItemId) as BomRow[]).map(bomToDomain);
  }
  async create(bom: Bom): Promise<void> {
    this.write(bom);
  }
  async update(bom: Bom): Promise<void> {
    this.write(bom);
  }
  private write(b: Bom): void {
    this.upsert.run({
      id: b.id,
      number: b.number,
      product_item_id: b.productItemId,
      version: b.version,
      standard_qty: b.standardQty.toString(),
      unit: b.unit,
      labor_cost: b.laborCost.toString(),
      overhead_cost: b.overheadCost.toString(),
      version_notes: b.versionNotes,
      lines: JSON.stringify(
        b.lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty.toString(),
          wastePercent: l.wastePercent,
          optional: l.optional,
          notes: l.notes,
        })),
      ),
      status: b.status,
      custom: b.custom ? 1 : 0,
      created_by: b.createdBy,
      created_at: b.createdAt,
    });
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
  completed_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_wo_bom ON work_order(bom_id);
CREATE INDEX IF NOT EXISTS idx_wo_ci ON work_order(config_instance_id);
`;

interface WoRow {
  id: string;
  number: string;
  bom_id: string;
  bom_version: number;
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
  gl_posted: number;
  created_by: string;
  created_at: string;
  started_at: string | null;
  issued_at: string | null;
  received_at: string | null;
  completed_at: string | null;
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
    bomVersion: row.bom_version,
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
    glPosted: row.gl_posted === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    issuedAt: row.issued_at,
    receivedAt: row.received_at,
    completedAt: row.completed_at,
  };
}

class SqliteWorkOrderStore implements WorkOrderRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO work_order (id, number, bom_id, bom_version, product_item_id, planned_qty, produced_qty, source_warehouse_id, wip_warehouse_id, destination_warehouse_id, priority, scheduled_start_date, scheduled_end_date, notes, status, stage, materials, material_cost, labor_cost, overhead_cost, extra_cost, cost_log, waste_log, shop_floor_log, config_instance_id, gl_posted, created_by, created_at, started_at, issued_at, received_at, completed_at)
      VALUES (@id, @number, @bom_id, @bom_version, @product_item_id, @planned_qty, @produced_qty, @source_warehouse_id, @wip_warehouse_id, @destination_warehouse_id, @priority, @scheduled_start_date, @scheduled_end_date, @notes, @status, @stage, @materials, @material_cost, @labor_cost, @overhead_cost, @extra_cost, @cost_log, @waste_log, @shop_floor_log, @config_instance_id, @gl_posted, @created_by, @created_at, @started_at, @issued_at, @received_at, @completed_at)
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
        received_at = excluded.received_at, completed_at = excluded.completed_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM work_order WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM work_order`);
  }

  async findById(id: string): Promise<WorkOrder | null> {
    const row = this.selectById.get(id) as WoRow | undefined;
    return row ? woToDomain(row) : null;
  }
  async list(): Promise<WorkOrder[]> {
    return (this.selectAll.all() as WoRow[]).map(woToDomain);
  }
  async create(order: WorkOrder): Promise<void> {
    this.write(order);
  }
  async update(order: WorkOrder): Promise<void> {
    this.write(order);
  }
  private write(o: WorkOrder): void {
    this.upsert.run({
      id: o.id,
      number: o.number,
      bom_id: o.bomId,
      bom_version: o.bomVersion,
      product_item_id: o.productItemId,
      planned_qty: o.plannedQty.toString(),
      produced_qty: o.producedQty.toString(),
      source_warehouse_id: o.sourceWarehouseId,
      wip_warehouse_id: o.wipWarehouseId,
      destination_warehouse_id: o.destinationWarehouseId,
      priority: o.priority,
      scheduled_start_date: o.scheduledStartDate,
      scheduled_end_date: o.scheduledEndDate,
      notes: o.notes,
      status: o.status,
      stage: o.stage,
      materials: JSON.stringify(
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
      material_cost: o.materialCost.toString(),
      labor_cost: o.laborCost.toString(),
      overhead_cost: o.overheadCost.toString(),
      extra_cost: o.extraCost.toString(),
      cost_log: JSON.stringify(
        o.costLog.map((c) => ({ kind: c.kind, amount: c.amount.toString(), notes: c.notes, at: c.at })),
      ),
      waste_log: JSON.stringify(
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
      shop_floor_log: JSON.stringify(o.shopFloorLog),
      config_instance_id: o.configInstanceId,
      gl_posted: o.glPosted ? 1 : 0,
      created_by: o.createdBy,
      created_at: o.createdAt,
      started_at: o.startedAt,
      issued_at: o.issuedAt,
      received_at: o.receivedAt,
      completed_at: o.completedAt,
    });
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

class SqliteConfigurableProductStore implements ConfigurableProductRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO configurable_product (id, code, name_ar, name_en, output_item_id, unit, description, inputs, materials, pricing_method, price_formula, labor_formula, overhead_formula, item_policy, status, created_by, created_at)
      VALUES (@id, @code, @name_ar, @name_en, @output_item_id, @unit, @description, @inputs, @materials, @pricing_method, @price_formula, @labor_formula, @overhead_formula, @item_policy, @status, @created_by, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en,
        output_item_id = excluded.output_item_id, unit = excluded.unit, description = excluded.description,
        inputs = excluded.inputs, materials = excluded.materials, pricing_method = excluded.pricing_method,
        price_formula = excluded.price_formula, labor_formula = excluded.labor_formula,
        overhead_formula = excluded.overhead_formula, item_policy = excluded.item_policy, status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM configurable_product WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM configurable_product WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM configurable_product`);
  }

  async findById(id: string): Promise<ConfigurableProduct | null> {
    const row = this.selectById.get(id) as CpRow | undefined;
    return row ? cpToDomain(row) : null;
  }
  async findByCode(code: string): Promise<ConfigurableProduct | null> {
    const row = this.selectByCode.get(code) as CpRow | undefined;
    return row ? cpToDomain(row) : null;
  }
  async list(): Promise<ConfigurableProduct[]> {
    return (this.selectAll.all() as CpRow[]).map(cpToDomain);
  }
  async create(product: ConfigurableProduct): Promise<void> {
    this.write(product);
  }
  async update(product: ConfigurableProduct): Promise<void> {
    this.write(product);
  }
  private write(p: ConfigurableProduct): void {
    this.upsert.run({
      id: p.id,
      code: p.code,
      name_ar: p.nameAr,
      name_en: p.nameEn,
      output_item_id: p.outputItemId,
      unit: p.unit,
      description: p.description,
      inputs: JSON.stringify(p.inputs),
      materials: JSON.stringify(p.materials),
      pricing_method: p.pricingMethod,
      price_formula: p.priceFormula,
      labor_formula: p.laborFormula,
      overhead_formula: p.overheadFormula,
      item_policy: p.itemPolicy,
      status: p.status,
      created_by: p.createdBy,
      created_at: p.createdAt,
    });
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

class SqliteConfigInstanceStore implements ConfigInstanceRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO config_instance (id, number, configurable_product_id, product_name_ar, output_item_id, spec, qty, customer_id, sell_unit_price, notes, status, bom_id, work_order_id, materials, material_cost_per_unit, labor_cost_per_unit, overhead_cost_per_unit, estimated_unit_cost, actual_cost, created_by, created_at)
      VALUES (@id, @number, @configurable_product_id, @product_name_ar, @output_item_id, @spec, @qty, @customer_id, @sell_unit_price, @notes, @status, @bom_id, @work_order_id, @materials, @material_cost_per_unit, @labor_cost_per_unit, @overhead_cost_per_unit, @estimated_unit_cost, @actual_cost, @created_by, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id, sell_unit_price = excluded.sell_unit_price,
        notes = excluded.notes, status = excluded.status, materials = excluded.materials,
        material_cost_per_unit = excluded.material_cost_per_unit, labor_cost_per_unit = excluded.labor_cost_per_unit,
        overhead_cost_per_unit = excluded.overhead_cost_per_unit, estimated_unit_cost = excluded.estimated_unit_cost,
        actual_cost = excluded.actual_cost
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM config_instance WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM config_instance`);
  }

  async findById(id: string): Promise<ConfigInstance | null> {
    const row = this.selectById.get(id) as CiRow | undefined;
    return row ? ciToDomain(row) : null;
  }
  async list(): Promise<ConfigInstance[]> {
    return (this.selectAll.all() as CiRow[]).map(ciToDomain);
  }
  async create(instance: ConfigInstance): Promise<void> {
    this.write(instance);
  }
  async update(instance: ConfigInstance): Promise<void> {
    this.write(instance);
  }
  private write(i: ConfigInstance): void {
    this.upsert.run({
      id: i.id,
      number: i.number,
      configurable_product_id: i.configurableProductId,
      product_name_ar: i.productNameAr,
      output_item_id: i.outputItemId,
      spec: JSON.stringify(i.spec),
      qty: i.qty.toString(),
      customer_id: i.customerId,
      sell_unit_price: i.sellUnitPrice === null ? null : i.sellUnitPrice.toString(),
      notes: i.notes,
      status: i.status,
      bom_id: i.bomId,
      work_order_id: i.workOrderId,
      materials: JSON.stringify(
        i.materials.map((m) => ({
          itemId: m.itemId,
          qtyPerUnit: m.qtyPerUnit.toString(),
          wastePercent: m.wastePercent,
          lineCost: m.lineCost.toString(),
        })),
      ),
      material_cost_per_unit: i.materialCostPerUnit.toString(),
      labor_cost_per_unit: i.laborCostPerUnit.toString(),
      overhead_cost_per_unit: i.overheadCostPerUnit.toString(),
      estimated_unit_cost: i.estimatedUnitCost.toString(),
      actual_cost: i.actualCost === null ? null : i.actualCost.toString(),
      created_by: i.createdBy,
      created_at: i.createdAt,
    });
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

class SqliteWorkStationStore implements WorkStationRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO work_station (id, code, name_ar, name_en, notes, status, created_at)
      VALUES (@id, @code, @name_ar, @name_en, @notes, @status, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en,
        notes = excluded.notes, status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM work_station WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM work_station WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM work_station ORDER BY code`);
  }

  async findById(id: string): Promise<WorkStation | null> {
    const row = this.selectById.get(id) as WsRow | undefined;
    return row ? wsToDomain(row) : null;
  }
  async findByCode(code: string): Promise<WorkStation | null> {
    const row = this.selectByCode.get(code) as WsRow | undefined;
    return row ? wsToDomain(row) : null;
  }
  async list(): Promise<WorkStation[]> {
    return (this.selectAll.all() as WsRow[]).map(wsToDomain);
  }
  async create(station: WorkStation): Promise<void> {
    this.write(station);
  }
  async update(station: WorkStation): Promise<void> {
    this.write(station);
  }
  private write(w: WorkStation): void {
    this.upsert.run({
      id: w.id,
      code: w.code,
      name_ar: w.nameAr,
      name_en: w.nameEn,
      notes: w.notes,
      status: w.status,
      created_at: w.createdAt,
    });
  }
}

// --- Factories -------------------------------------------------------------

/**
 * Open all four manufacturing stores on ONE shared connection — the shape the
 * API mounts, so the whole module lives in a single database file.
 */
export interface SqliteManufacturingStores {
  readonly boms: BomRepository;
  readonly workOrders: WorkOrderRepository;
  readonly configurableProducts: ConfigurableProductRepository;
  readonly configInstances: ConfigInstanceRepository;
  readonly workStations: WorkStationRepository;
  close(): void;
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
  return {
    boms: new SqliteBomStore(sqlite),
    workOrders: new SqliteWorkOrderStore(sqlite),
    configurableProducts: new SqliteConfigurableProductStore(sqlite),
    configInstances: new SqliteConfigInstanceStore(sqlite),
    workStations: new SqliteWorkStationStore(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
