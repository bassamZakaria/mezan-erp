import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  NextNumberService,
  createBom,
  createBomVersion,
  deactivateBom,
  bomCostEstimate,
  createWorkOrder,
  startWorkOrder,
  issueWorkOrderMaterials,
  extraIssueWorkOrderMaterials,
  returnWorkOrderMaterials,
  logWorkOrderWaste,
  logWorkOrderCost,
  receiveWorkOrderProduct,
  completeWorkOrder,
  cancelWorkOrder,
  workOrderWipTotal,
  workOrderProgress,
  createConfigurableProduct,
  updateConfigurableProduct,
  deactivateConfigurableProduct,
  evaluateConfigurableProduct,
  createConfigInstance,
  closeConfigInstance,
  cancelConfigInstance,
  configInstanceSellTotal,
  BomNotFoundError,
  WorkOrderNotFoundError,
  ConfigurableProductNotFoundError,
  ConfigInstanceNotFoundError,
  DuplicateManufacturingDocumentError,
  InvalidManufacturingDocumentError,
  WorkOrderStageError,
  FormulaError,
  type Bom,
  type BomRepository,
  type WorkOrder,
  type WorkOrderRepository,
  type WorkOrderStage,
  type ConfigurableProduct,
  type ConfigurableProductRepository,
  type ConfigInstance,
  type ConfigInstanceRepository,
  type ManufacturingGlPostingPort,
  type ManufacturingStockPort,
  type WorkOrderGlAccounts,
} from "@mezan/domain";
import {
  createBomSchema,
  createBomVersionSchema,
  createWorkOrderSchema,
  workOrderLineActionSchema,
  receiveProductSchema,
  logCostSchema,
  logWasteSchema,
  upsertConfigurableProductSchema,
  createConfigInstanceSchema,
  previewConfigInstanceSchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

/**
 * Permission-gated routes for the manufacturing module (docs/catalog/07),
 * mounted under `/manufacturing`. Reuses the documented `manufacturing.*`
 * permission codes (permissions/catalog.ts): bom.view/manage for BOMs +
 * configurable products, wo.view/create/execute for work orders + custom
 * manufacturing. Money/Qty serialize as exact decimal strings.
 */
export interface WorkOrderMovementView {
  readonly id: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly direction: string;
  readonly qty: string;
  readonly unitCost: string;
  readonly occurredAt: string;
}

export interface WorkOrderJournalView {
  readonly id: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly memo: string | null;
  readonly status: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

export interface WorkOrderAuditView {
  readonly action: string;
  readonly actor: string;
  readonly timestamp: string;
  readonly severity: string;
}

export interface ManufacturingRoutesDeps {
  readonly boms: BomRepository;
  readonly workOrders: WorkOrderRepository;
  readonly configurableProducts: ConfigurableProductRepository;
  readonly configInstances: ConfigInstanceRepository;
  readonly numbering: NextNumberService;
  readonly stock: ManufacturingStockPort;
  /**
   * On-hand quantities per (item, warehouse), for the materials tab's
   * available and shortage columns (R9.2). Optional: without it those two
   * columns report null rather than a zero that would read as "nothing in
   * stock" on a full warehouse.
   */
  readonly positions?: () => Promise<readonly { itemId: string; warehouseId: string; onHand: number }[]>;
  /**
   * The three activity feeds behind a work order's movements, journal-entries
   * and audit tabs (R9.2). All optional: without one the tab reports an empty
   * feed rather than the route 500-ing, which is what an installation with no
   * ledger wired would otherwise do.
   *
   * Every one of them SELECTS by the work order's id rather than reading a list
   * stored on the order — a stored list cannot survive a reversal.
   */
  readonly movementsOfDocument?: (sourceDocId: string) => Promise<readonly WorkOrderMovementView[]>;
  readonly journalEntriesOfDocument?: (sourceDocId: string) => Promise<readonly WorkOrderJournalView[]>;
  readonly auditOfDocument?: (entityId: string) => Promise<readonly WorkOrderAuditView[]>;
  readonly gl: ManufacturingGlPostingPort;
  readonly accounts: WorkOrderGlAccounts;
  /** Item → moving-average unit cost (for BOM/config cost estimates). Defaults to 0. */
  readonly resolveUnitCost?: (itemId: string) => Promise<Money>;
  readonly now?: () => string;
}

const num = (m: { toString(): string }) => m.toString();

// --- serialization ----------------------------------------------------------

function serializeBom(b: Bom, estimate?: { materialCost: Money; laborCost: Money; overheadCost: Money; totalCost: Money; unitCost: Money }) {
  return {
    id: b.id,
    number: b.number,
    productItemId: b.productItemId,
    version: b.version,
    standardQty: num(b.standardQty),
    unit: b.unit,
    laborCost: num(b.laborCost),
    overheadCost: num(b.overheadCost),
    versionNotes: b.versionNotes,
    lines: b.lines.map((l) => ({
      itemId: l.itemId,
      qty: num(l.qty),
      wastePercent: l.wastePercent,
      optional: l.optional,
      notes: l.notes,
    })),
    status: b.status,
    custom: b.custom,
    createdBy: b.createdBy,
    createdAt: b.createdAt,
    estimate: estimate
      ? {
          materialCost: num(estimate.materialCost),
          laborCost: num(estimate.laborCost),
          overheadCost: num(estimate.overheadCost),
          totalCost: num(estimate.totalCost),
          unitCost: num(estimate.unitCost),
        }
      : undefined,
  };
}

/**
 * A work order's materials, with what the source warehouse can actually
 * supply. Shortage is required minus what is issued AND available — the number
 * a supervisor needs before starting a run, not after it stalls.
 */
function serializeWorkOrder(o: WorkOrder, onHand?: ReadonlyMap<string, number>) {
  const wip = workOrderWipTotal(o);
  const producedOrPlanned = o.producedQty.scaled > 0n ? o.producedQty : o.plannedQty;
  const unitCost =
    producedOrPlanned.scaled > 0n
      ? Money.fromScaled((wip.scaled * 1_000_000n) / producedOrPlanned.scaled)
      : Money.zero();
  return {
    id: o.id,
    number: o.number,
    bomId: o.bomId,
    bomVersion: o.bomVersion,
    productItemId: o.productItemId,
    plannedQty: num(o.plannedQty),
    producedQty: num(o.producedQty),
    sourceWarehouseId: o.sourceWarehouseId,
    destinationWarehouseId: o.destinationWarehouseId,
    priority: o.priority,
    scheduledStartDate: o.scheduledStartDate,
    scheduledEndDate: o.scheduledEndDate,
    notes: o.notes,
    status: o.status,
    stage: o.stage,
    materials: o.materials.map((m) => ({
      itemId: m.itemId,
      requiredQty: num(m.requiredQty),
      wastePercent: m.wastePercent,
      optional: m.optional,
      issuedQty: num(m.issuedQty),
      returnedQty: num(m.returnedQty),
      netQty: num(m.issuedQty.subtract(m.returnedQty)),
      availableQty: onHand ? String(onHand.get(`${m.itemId} ${o.sourceWarehouseId}`) ?? 0) : null,
      shortageQty: onHand
        ? String(
            Math.max(
              0,
              Number(num(m.requiredQty)) -
                Number(num(m.issuedQty.subtract(m.returnedQty))) -
                (onHand.get(`${m.itemId} ${o.sourceWarehouseId}`) ?? 0),
            ),
          )
        : null,
      issuedUnitCost: num(m.issuedUnitCost),
    })),
    materialCost: num(o.materialCost),
    laborCost: num(o.laborCost),
    overheadCost: num(o.overheadCost),
    extraCost: num(o.extraCost),
    wipTotal: num(wip),
    unitCost: num(unitCost),
    progress: workOrderProgress(o),
    costLog: o.costLog.map((c) => ({ kind: c.kind, amount: num(c.amount), notes: c.notes, at: c.at })),
    wasteLog: o.wasteLog.map((w) => ({ itemId: w.itemId, qty: num(w.qty), notes: w.notes, at: w.at })),
    configInstanceId: o.configInstanceId,
    glPosted: o.glPosted,
    createdBy: o.createdBy,
    createdAt: o.createdAt,
    startedAt: o.startedAt,
    issuedAt: o.issuedAt,
    receivedAt: o.receivedAt,
    completedAt: o.completedAt,
  };
}

function serializeConfigurableProduct(p: ConfigurableProduct) {
  return {
    id: p.id,
    code: p.code,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    outputItemId: p.outputItemId,
    unit: p.unit,
    description: p.description,
    inputs: p.inputs,
    materials: p.materials,
    pricingMethod: p.pricingMethod,
    priceFormula: p.priceFormula,
    laborFormula: p.laborFormula,
    overheadFormula: p.overheadFormula,
    itemPolicy: p.itemPolicy,
    status: p.status,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
  };
}

function serializeConfigInstance(i: ConfigInstance) {
  return {
    id: i.id,
    number: i.number,
    configurableProductId: i.configurableProductId,
    productNameAr: i.productNameAr,
    outputItemId: i.outputItemId,
    spec: i.spec,
    qty: num(i.qty),
    customerId: i.customerId,
    sellUnitPrice: i.sellUnitPrice === null ? null : num(i.sellUnitPrice),
    sellTotal: num(configInstanceSellTotal(i)),
    notes: i.notes,
    status: i.status,
    bomId: i.bomId,
    workOrderId: i.workOrderId,
    materials: i.materials.map((m) => ({
      itemId: m.itemId,
      qtyPerUnit: num(m.qtyPerUnit),
      wastePercent: m.wastePercent,
      lineCost: num(m.lineCost),
    })),
    materialCostPerUnit: num(i.materialCostPerUnit),
    laborCostPerUnit: num(i.laborCostPerUnit),
    overheadCostPerUnit: num(i.overheadCostPerUnit),
    estimatedUnitCost: num(i.estimatedUnitCost),
    actualCost: i.actualCost === null ? null : num(i.actualCost),
    createdBy: i.createdBy,
    createdAt: i.createdAt,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (
    err instanceof BomNotFoundError ||
    err instanceof WorkOrderNotFoundError ||
    err instanceof ConfigurableProductNotFoundError ||
    err instanceof ConfigInstanceNotFoundError
  ) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateManufacturingDocumentError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof WorkOrderStageError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidManufacturingDocumentError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof FormulaError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

export function createManufacturingRoutes(
  deps: ManufacturingRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const actor = (c: Context) => getAuthContext(c)?.userId ?? "system";
  const resolveUnitCost = deps.resolveUnitCost ?? (async () => Money.zero());
  const bomDeps = { boms: deps.boms, numbering: deps.numbering, now: deps.now };

  async function costMap(itemIds: readonly string[]): Promise<Map<string, Money>> {
    const map = new Map<string, Money>();
    for (const id of new Set(itemIds)) map.set(id, await resolveUnitCost(id));
    return map;
  }

  // --- BOMs ----------------------------------------------------------------

  app.get("/boms", gate("manufacturing.bom.view"), async (c) => {
    const boms = await deps.boms.list();
    const out = [];
    for (const b of boms) {
      const map = await costMap(b.lines.map((l) => l.itemId));
      out.push(serializeBom(b, bomCostEstimate(b, (id) => map.get(id) ?? Money.zero())));
    }
    return c.json(out);
  });

  app.get("/boms/:id", gate("manufacturing.bom.view"), async (c) => {
    const bom = await deps.boms.findById(c.req.param("id"));
    if (!bom) return c.json({ error: "NOT_FOUND" }, 404);
    const map = await costMap(bom.lines.map((l) => l.itemId));
    return c.json(serializeBom(bom, bomCostEstimate(bom, (id) => map.get(id) ?? Money.zero())));
  });

  app.get("/boms/:id/cost-estimate", gate("manufacturing.bom.view"), async (c) => {
    const bom = await deps.boms.findById(c.req.param("id"));
    if (!bom) return c.json({ error: "NOT_FOUND" }, 404);
    const map = await costMap(bom.lines.map((l) => l.itemId));
    const est = bomCostEstimate(bom, (id) => map.get(id) ?? Money.zero());
    return c.json({
      materialCost: num(est.materialCost),
      laborCost: num(est.laborCost),
      overheadCost: num(est.overheadCost),
      totalCost: num(est.totalCost),
      unitCost: num(est.unitCost),
    });
  });

  app.post("/boms", gate("manufacturing.bom.manage"), async (c) => {
    const parsed = createBomSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const bom = await createBom(
        {
          id: parsed.data.id,
          productItemId: parsed.data.productItemId,
          standardQty: Qty.fromMajor(parsed.data.standardQty),
          unit: parsed.data.unit,
          laborCost: parsed.data.laborCost ? Money.fromMajor(parsed.data.laborCost) : undefined,
          overheadCost: parsed.data.overheadCost ? Money.fromMajor(parsed.data.overheadCost) : undefined,
          versionNotes: parsed.data.versionNotes,
          lines: parsed.data.lines.map((l) => ({
            itemId: l.itemId,
            qty: Qty.fromMajor(l.qty),
            wastePercent: l.wastePercent,
            optional: l.optional,
            notes: l.notes,
          })),
          createdBy: actor(c),
        },
        bomDeps,
      );
      return c.json(serializeBom(bom), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/boms/:id/version", gate("manufacturing.bom.manage"), async (c) => {
    const parsed = createBomVersionSchema.safeParse({ ...(await c.req.json()), sourceBomId: c.req.param("id") });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const bom = await createBomVersion(
        {
          id: parsed.data.id,
          sourceBomId: parsed.data.sourceBomId,
          standardQty: parsed.data.standardQty ? Qty.fromMajor(parsed.data.standardQty) : undefined,
          unit: parsed.data.unit,
          laborCost: parsed.data.laborCost ? Money.fromMajor(parsed.data.laborCost) : undefined,
          overheadCost: parsed.data.overheadCost ? Money.fromMajor(parsed.data.overheadCost) : undefined,
          versionNotes: parsed.data.versionNotes,
          lines: parsed.data.lines?.map((l) => ({
            itemId: l.itemId,
            qty: Qty.fromMajor(l.qty),
            wastePercent: l.wastePercent,
            optional: l.optional,
            notes: l.notes,
          })),
          createdBy: actor(c),
        },
        bomDeps,
      );
      return c.json(serializeBom(bom), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/boms/:id/deactivate", gate("manufacturing.bom.manage"), async (c) => {
    try {
      return c.json(serializeBom(await deactivateBom(c.req.param("id"), { boms: deps.boms })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Work Orders ---------------------------------------------------------

  /**
   * One positions read per request, not one per material: the per-material
   * version is an N+1 that gets slower with every work order on the board.
   */
  async function onHandByPosition(): Promise<ReadonlyMap<string, number> | undefined> {
    if (!deps.positions) return undefined;
    const map = new Map<string, number>();
    for (const position of await deps.positions()) {
      map.set(`${position.itemId} ${position.warehouseId}`, position.onHand);
    }
    return map;
  }

  app.get("/work-orders", gate("manufacturing.wo.view"), async (c) => {
    const onHand = await onHandByPosition();
    return c.json((await deps.workOrders.list()).map((order) => serializeWorkOrder(order, onHand)));
  });

  app.get("/work-orders/:id", gate("manufacturing.wo.view"), async (c) => {
    const order = await deps.workOrders.findById(c.req.param("id"));
    if (!order) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeWorkOrder(order));
  });

  /**
   * Everything that happened to one work order, in the three shapes its detail
   * tabs read: the stock it moved, the entries it posted, and who touched it.
   *
   * Material movements and finished-goods receipts come out of the SAME ledger
   * query and are split here rather than by two round trips: a movement of the
   * order's own product INTO stock is a receipt, everything else is material.
   * Splitting on the item rather than on the direction matters because a
   * material RETURN is also an inbound movement, and filing it as a receipt
   * would report goods produced that never were.
   */
  app.get("/work-orders/:id/activity", gate("manufacturing.wo.view"), async (c) => {
    const order = await deps.workOrders.findById(c.req.param("id"));
    if (!order) return c.json({ error: "NOT_FOUND" }, 404);

    const movements = deps.movementsOfDocument ? await deps.movementsOfDocument(order.id) : [];
    // The ledger writes the direction uppercase ("IN"/"OUT"); compare case-
    // insensitively so a receipt is not silently filed as a material movement.
    const isReceipt = (m: WorkOrderMovementView) =>
      m.itemId === order.productItemId && m.direction.toUpperCase() === "IN";
    return c.json({
      movements: movements.filter((m) => !isReceipt(m)),
      receipts: movements.filter(isReceipt),
      journalEntries: deps.journalEntriesOfDocument ? await deps.journalEntriesOfDocument(order.id) : [],
      auditEvents: deps.auditOfDocument ? await deps.auditOfDocument(order.id) : [],
    });
  });

  app.post("/work-orders", gate("manufacturing.wo.create"), async (c) => {
    const parsed = createWorkOrderSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const order = await createWorkOrder(
        {
          id: parsed.data.id,
          bomId: parsed.data.bomId,
          plannedQty: Qty.fromMajor(parsed.data.plannedQty),
          sourceWarehouseId: parsed.data.sourceWarehouseId,
          destinationWarehouseId: parsed.data.destinationWarehouseId,
          priority: parsed.data.priority,
          scheduledStartDate: parsed.data.scheduledStartDate,
          scheduledEndDate: parsed.data.scheduledEndDate,
          notes: parsed.data.notes,
          createdBy: actor(c),
        },
        { workOrders: deps.workOrders, boms: deps.boms, numbering: deps.numbering, now: deps.now },
      );
      return c.json(serializeWorkOrder(order), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  const stockDeps = () => ({ workOrders: deps.workOrders, stock: deps.stock, now: deps.now });

  app.post("/work-orders/:id/start", gate("manufacturing.wo.execute"), async (c) => {
    try {
      return c.json(serializeWorkOrder(await startWorkOrder(c.req.param("id"), { workOrders: deps.workOrders, now: deps.now })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/issue", gate("manufacturing.wo.execute"), async (c) => {
    try {
      return c.json(serializeWorkOrder(await issueWorkOrderMaterials(c.req.param("id"), stockDeps())));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/extra-issue", gate("manufacturing.wo.execute"), async (c) => {
    const parsed = workOrderLineActionSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const order = await extraIssueWorkOrderMaterials(
        c.req.param("id"),
        parsed.data.lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
        stockDeps(),
      );
      return c.json(serializeWorkOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/return", gate("manufacturing.wo.execute"), async (c) => {
    const parsed = workOrderLineActionSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const order = await returnWorkOrderMaterials(
        c.req.param("id"),
        parsed.data.lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
        stockDeps(),
      );
      return c.json(serializeWorkOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/log-waste", gate("manufacturing.wo.execute"), async (c) => {
    const parsed = logWasteSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const order = await logWorkOrderWaste(
        c.req.param("id"),
        parsed.data.lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty), notes: l.notes })),
        { workOrders: deps.workOrders, now: deps.now },
      );
      return c.json(serializeWorkOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/log-cost", gate("manufacturing.wo.execute"), async (c) => {
    const parsed = logCostSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const order = await logWorkOrderCost(
        c.req.param("id"),
        { kind: parsed.data.kind, amount: Money.fromMajor(parsed.data.amount), notes: parsed.data.notes },
        { workOrders: deps.workOrders, now: deps.now },
      );
      return c.json(serializeWorkOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/receive", gate("manufacturing.wo.execute"), async (c) => {
    const parsed = receiveProductSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const order = await receiveWorkOrderProduct(c.req.param("id"), Qty.fromMajor(parsed.data.producedQty), stockDeps());
      return c.json(serializeWorkOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/complete", gate("manufacturing.wo.execute"), async (c) => {
    try {
      const { order } = await completeWorkOrder(c.req.param("id"), {
        workOrders: deps.workOrders,
        gl: deps.gl,
        accounts: deps.accounts,
        now: deps.now,
      });
      return c.json(serializeWorkOrder(order));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/work-orders/:id/cancel", gate("manufacturing.wo.execute"), async (c) => {
    try {
      return c.json(serializeWorkOrder(await cancelWorkOrder(c.req.param("id"), { workOrders: deps.workOrders })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Configurable Products -----------------------------------------------

  app.get("/configurable-products", gate("manufacturing.bom.view"), async (c) => {
    return c.json((await deps.configurableProducts.list()).map(serializeConfigurableProduct));
  });

  app.get("/configurable-products/:id", gate("manufacturing.bom.view"), async (c) => {
    const p = await deps.configurableProducts.findById(c.req.param("id"));
    if (!p) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeConfigurableProduct(p));
  });

  app.post("/configurable-products", gate("manufacturing.bom.manage"), async (c) => {
    const parsed = upsertConfigurableProductSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const p = await createConfigurableProduct({ ...parsed.data, createdBy: actor(c) }, { products: deps.configurableProducts, now: deps.now });
      return c.json(serializeConfigurableProduct(p), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/configurable-products/:id", gate("manufacturing.bom.manage"), async (c) => {
    const parsed = upsertConfigurableProductSchema.safeParse({ ...(await c.req.json()), id: c.req.param("id") });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const p = await updateConfigurableProduct(parsed.data, { products: deps.configurableProducts, now: deps.now });
      return c.json(serializeConfigurableProduct(p));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/configurable-products/:id/deactivate", gate("manufacturing.bom.manage"), async (c) => {
    try {
      return c.json(serializeConfigurableProduct(await deactivateConfigurableProduct(c.req.param("id"), { products: deps.configurableProducts, now: deps.now })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Config Instances (Custom Manufacturing) -----------------------------

  app.get("/config-instances", gate("manufacturing.wo.view"), async (c) => {
    return c.json((await deps.configInstances.list()).map(serializeConfigInstance));
  });

  app.get("/config-instances/:id", gate("manufacturing.wo.view"), async (c) => {
    const i = await deps.configInstances.findById(c.req.param("id"));
    if (!i) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeConfigInstance(i));
  });

  app.post("/config-instances/preview", gate("manufacturing.wo.view"), async (c) => {
    const parsed = previewConfigInstanceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const product = await deps.configurableProducts.findById(parsed.data.configurableProductId);
      if (!product) throw new ConfigurableProductNotFoundError(parsed.data.configurableProductId);
      const map = await costMap(product.materials.map((m) => m.itemId));
      const r = evaluateConfigurableProduct(product, parsed.data.spec, (id) => map.get(id) ?? Money.zero());
      return c.json({
        materials: r.materials.map((m) => ({
          itemId: m.itemId,
          qtyPerUnit: num(m.qtyPerUnit),
          effectiveQtyPerUnit: num(m.effectiveQtyPerUnit),
          wastePercent: m.wastePercent,
          unitCost: num(m.unitCost),
          lineCost: num(m.lineCost),
        })),
        materialCostPerUnit: num(r.materialCostPerUnit),
        laborCostPerUnit: num(r.laborCostPerUnit),
        overheadCostPerUnit: num(r.overheadCostPerUnit),
        unitPrice: r.unitPrice === null ? null : num(r.unitPrice),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/config-instances", gate("manufacturing.wo.create"), async (c) => {
    const parsed = createConfigInstanceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const product = await deps.configurableProducts.findById(parsed.data.configurableProductId);
      if (!product) throw new ConfigurableProductNotFoundError(parsed.data.configurableProductId);
      const map = await costMap(product.materials.map((m) => m.itemId));
      const { instance } = await createConfigInstance(
        {
          id: parsed.data.id,
          configurableProductId: parsed.data.configurableProductId,
          spec: parsed.data.spec,
          qty: Qty.fromMajor(parsed.data.qty),
          customerId: parsed.data.customerId,
          sellUnitPrice: parsed.data.sellUnitPrice ? Money.fromMajor(parsed.data.sellUnitPrice) : undefined,
          notes: parsed.data.notes,
          sourceWarehouseId: parsed.data.sourceWarehouseId,
          destinationWarehouseId: parsed.data.destinationWarehouseId,
          scheduledStartDate: parsed.data.scheduledStartDate,
          scheduledEndDate: parsed.data.scheduledEndDate,
          createdBy: actor(c),
        },
        {
          instances: deps.configInstances,
          boms: deps.boms,
          workOrders: deps.workOrders,
          products: deps.configurableProducts,
          numbering: deps.numbering,
          resolveUnitCost: (id) => map.get(id) ?? Money.zero(),
          now: deps.now,
        },
      );
      return c.json(serializeConfigInstance(instance), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/config-instances/:id/close", gate("manufacturing.wo.execute"), async (c) => {
    try {
      return c.json(serializeConfigInstance(await closeConfigInstance(c.req.param("id"), { instances: deps.configInstances, workOrders: deps.workOrders })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/config-instances/:id/cancel", gate("manufacturing.wo.execute"), async (c) => {
    try {
      return c.json(serializeConfigInstance(await cancelConfigInstance(c.req.param("id"), { instances: deps.configInstances })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- Production Dashboard (docs/catalog/07 §لوحة الإنتاج) -----------------

  app.get("/dashboard", gate("manufacturing.wo.view"), async (c) => {
    const orders = await deps.workOrders.list();
    const today = (deps.now ? deps.now() : new Date().toISOString()).slice(0, 10);
    const month = today.slice(0, 7);

    const active = orders.filter((o) => o.status === "in_progress" || o.status === "planned");
    const isOverdue = (o: WorkOrder) =>
      (o.status === "in_progress" || o.status === "planned") &&
      o.scheduledEndDate !== null &&
      o.scheduledEndDate < today;

    const nextActionFor = (stage: WorkOrderStage): string | null => {
      switch (stage) {
        case "not_started":
          return "start";
        case "started":
          return "issue";
        case "materials_issued":
          return "receive";
        case "product_received":
          return "complete";
        default:
          return null;
      }
    };

    const wipValue = active
      .filter((o) => o.status === "in_progress")
      .reduce((sum, o) => sum.add(workOrderWipTotal(o)), Money.zero());

    const completedThisMonth = orders.filter(
      (o) => o.status === "completed" && (o.completedAt ?? "").slice(0, 7) === month,
    );
    const unitsProduced = completedThisMonth.reduce((sum, o) => sum.add(o.producedQty), Qty.zero());
    const producedCost = completedThisMonth.reduce((sum, o) => sum.add(workOrderWipTotal(o)), Money.zero());
    const avgCostPerUnit =
      unitsProduced.scaled > 0n ? Money.fromScaled((producedCost.scaled * 1_000_000n) / unitsProduced.scaled) : Money.zero();

    const bucket = (stage: WorkOrderStage) =>
      active
        .filter((o) => o.stage === stage)
        .map((o) => ({
          id: o.id,
          number: o.number,
          productItemId: o.productItemId,
          producedQty: num(o.producedQty),
          plannedQty: num(o.plannedQty),
          progress: workOrderProgress(o),
          priority: o.priority,
          overdue: isOverdue(o),
        }));

    return c.json({
      overdueCount: active.filter(isOverdue).length,
      kpis: {
        activeWorkOrders: active.filter((o) => o.status === "in_progress").length,
        wipValue: num(wipValue),
        unitsProducedThisMonth: num(unitsProduced),
        avgCostPerUnit: num(avgCostPerUnit),
      },
      buckets: {
        // The bucket a run actually starts in (R9.3). It was missing, so an
        // order nobody had begun appeared only in the flat list of everything
        // — the one bucket a supervisor opens the board to act on.
        notStarted: bucket("not_started"),
        awaitingMaterialIssue: bucket("started"),
        awaitingProductReceipt: bucket("materials_issued"),
        readyToComplete: bucket("product_received"),
      },
      activeOrders: active.map((o) => ({
        id: o.id,
        number: o.number,
        productItemId: o.productItemId,
        progress: workOrderProgress(o),
        producedQty: num(o.producedQty),
        plannedQty: num(o.plannedQty),
        priority: o.priority,
        scheduledEndDate: o.scheduledEndDate,
        overdue: isOverdue(o),
        stage: o.stage,
        nextAction: nextActionFor(o.stage),
      })),
    });
  });

  return app;
}
