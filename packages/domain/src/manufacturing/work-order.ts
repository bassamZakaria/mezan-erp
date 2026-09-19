/**
 * أمر التصنيع (Work Order) — a discrete production run against a BOM
 * (docs/archive/catalog/07 §Work Orders). It executes through a 4-stage machine:
 *
 *   بدء العمل (start) → صرف المواد (issue raw materials, stock OUT) →
 *   استلام المنتج (receive finished product, stock IN) → إكمال أمر العمل
 *   (complete — auto-posts the GL chain).
 *
 * WIP HAS A PHYSICAL ADDRESS. Every work order names a third warehouse —
 * `wipWarehouseId`, مستودع التشغيل, conventionally of type PRODUCTION — and
 * صرف المواد is a TRANSFER into it, not a disappearance out of the raw store.
 * Material issued to the floor is therefore still stock: it has a warehouse, a
 * quantity, a batch and a value, so a supervisor can walk the floor, count what
 * is sitting on it and reconcile that count against a system quantity. Before
 * this, issue posted a bare OUT and the goods survived only as `materialCost`,
 * a value-only bucket on the order; a floor count had nothing to be compared
 * with, and for the entire length of the run the stock sub-ledger sat BELOW GL
 * 1200 by the issued value, because the balancing GL entry is not posted until
 * completion.
 *
 * WIP costing: raw materials transfer into مستودع التشغيل at their moving-average
 * cost (accumulated as the work order's material WIP), while standard labour and
 * overhead from the BOM capitalise into WIP too. On product receipt the material
 * standing in مستودع التشغيل is CONSUMED (stock OUT) and the whole WIP (materials
 * + labour + overhead + any logged extra cost) is capitalised into finished-goods
 * inventory at the computed unit cost — so COGS is recognised only on the later
 * sale, never here. Stock moves are posted stock-only (no GL); the single
 * completion posting drives the ledger, mirroring the purchase chain's split of
 * receipt (stock) vs. invoice (GL).
 */

import { Money, Qty, allocate } from "../money/index.js";
import { extend, unitCostOf } from "../inventory/index.js";
import { NextNumberService } from "../numbering/index.js";
import { type Bom, type BomRepository, bomLineEffectiveQty, wasteAllowanceOf } from "./bom.js";
import {
  type ManufacturingGlPosting,
  type ManufacturingGlPostingLine,
  type ManufacturingGlPostingPort,
  type ManufacturingStockPort,
  type WorkOrderGlAccounts,
  type WorkOrderPriority,
  type WorkOrderStage,
  type WorkOrderStatus,
} from "./types.js";
import {
  BomNotFoundError,
  DuplicateManufacturingDocumentError,
  InvalidManufacturingDocumentError,
  WorkOrderNotFoundError,
  WorkOrderStageError,
} from "./errors.js";

const WORK_ORDER_SEQUENCE = "WORK_ORDER";

/** a × b ÷ c with HALF_UP rounding on the magnitude (exact bigint). */
function mulDivRoundHalfUp(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError("division by zero");
  const negative = a < 0n !== b < 0n;
  const n = (a < 0n ? -a : a) * (b < 0n ? -b : b);
  const d = c < 0n ? -c : c;
  const q = n / d;
  const rem = n % d;
  const rounded = rem * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

export interface WorkOrderMaterial {
  readonly itemId: string;
  /** Effective (post-waste) required quantity, scaled to the planned batch. */
  readonly requiredQty: Qty;
  readonly wastePercent: number;
  readonly optional: boolean;
  readonly issuedQty: Qty;
  readonly returnedQty: Qty;
  /** Moving-average unit cost captured on issue (used to reverse returns). */
  readonly issuedUnitCost: Money;
}

export interface WorkOrderCostLogEntry {
  readonly kind: "labor" | "overhead" | "other";
  readonly amount: Money;
  readonly notes: string | null;
  readonly at: string;
}

/**
 * One shop-floor action, stamped with the محطة العمل it happened at and the
 * المشغّل who performed it (R9.1).
 *
 * `ref` is the issue/receipt id the action handed the stock ledger, and every
 * movement it produced is `<ref>:<lineIndex>` — that is the join key the
 * activity feed uses. It is deliberately NOT the timestamp: several actions on
 * one order can share a millisecond, and keying on `at` silently reported the
 * last one's station on all of them. It is `null` only on waste entries written
 * before scrap moved stock at all (D64); scrap now carries its own issue ref
 * like every other movement.
 */
export interface WorkOrderShopFloorEntry {
  readonly kind: "issue" | "extra_issue" | "return" | "waste" | "receive";
  readonly stationId: string | null;
  readonly operatorId: string | null;
  readonly ref: string | null;
  readonly at: string;
}

/**
 * One تسجيل فاقد line.
 *
 * `qty` is what was scrapped. It is split against the BOM's own waste
 * allowance: `normalQty` is loss the BOM planned for, whose cost stays
 * capitalised in the order and reaches the finished product; `abnormalQty` is
 * loss beyond the allowance, expensed the day it happened (EAS/IAS 2).
 *
 * `stockMoved` is false ONLY on entries written before waste moved stock at
 * all (D64). Those rows are left exactly as they were — their quantity is
 * still standing in مستودع التشغيل and is still consumed at receipt — because
 * retro-moving stock for a run that has already closed would restate books
 * nobody asked us to restate. They contribute nothing to the WIP quantity or
 * to either waste cost.
 */
export interface WorkOrderWasteEntry {
  readonly itemId: string;
  readonly qty: Qty;
  readonly notes: string | null;
  readonly at: string;
  readonly stockMoved: boolean;
  readonly normalQty: Qty;
  readonly abnormalQty: Qty;
  /** Cost of `normalQty` at the moving average it left مستودع التشغيل at. */
  readonly normalCost: Money;
  /** Cost of `abnormalQty` — the amount posted to the scrap expense account. */
  readonly abnormalCost: Money;
}

export interface WorkOrder {
  readonly id: string;
  readonly number: string;
  readonly bomId: string;
  readonly bomVersion: number;
  readonly productItemId: string;
  readonly plannedQty: Qty;
  readonly producedQty: Qty;
  readonly sourceWarehouseId: string;
  /**
   * مستودع التشغيل — where issued material physically stands while it is being
   * worked on. Empty ONLY on orders written before WIP had a location; every
   * stage that moves stock refuses such an order rather than silently falling
   * back to the old vanishing issue.
   */
  readonly wipWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly priority: WorkOrderPriority;
  readonly scheduledStartDate: string;
  readonly scheduledEndDate: string | null;
  readonly notes: string | null;
  readonly status: WorkOrderStatus;
  readonly stage: WorkOrderStage;
  readonly materials: readonly WorkOrderMaterial[];
  /** Accumulated actual raw-material WIP cost (issue − return). */
  readonly materialCost: Money;
  /** Labour capitalised into WIP (standard from the BOM, plus any logged labour). */
  readonly laborCost: Money;
  /** Overhead capitalised into WIP (standard from the BOM, plus any logged overhead). */
  readonly overheadCost: Money;
  /** Other logged costs capitalised into WIP. */
  readonly extraCost: Money;
  readonly costLog: readonly WorkOrderCostLogEntry[];
  readonly wasteLog: readonly WorkOrderWasteEntry[];
  readonly shopFloorLog: readonly WorkOrderShopFloorEntry[];
  readonly configInstanceId: string | null;
  readonly glPosted: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly issuedAt: string | null;
  readonly receivedAt: string | null;
  readonly completedAt: string | null;
  /**
   * بُعد المشروع — the contracting project this run belongs to. The finished
   * good still goes to inventory at completion (no cost category here); the
   * project only picks up cost when the product is later issued to it.
   */
  readonly projectId: string | null;
}

export interface WorkOrderRepository {
  findById(id: string): Promise<WorkOrder | null>;
  list(): Promise<WorkOrder[]>;
  create(order: WorkOrder): Promise<void>;
  update(order: WorkOrder): Promise<void>;
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

// --- pure read helpers ------------------------------------------------------

/** Total work-in-process cost so far (materials + labour + overhead + extra). */
export function workOrderWipTotal(wo: {
  materialCost: Money;
  laborCost: Money;
  overheadCost: Money;
  extraCost: Money;
}): Money {
  return wo.materialCost.add(wo.laborCost).add(wo.overheadCost).add(wo.extraCost);
}

/** Production progress as a fraction in [0, 1] (produced ÷ planned). */
export function workOrderProgress(wo: Pick<WorkOrder, "producedQty" | "plannedQty">): number {
  if (wo.plannedQty.scaled === 0n) return 0;
  return Number(wo.producedQty.scaled) / Number(wo.plannedQty.scaled);
}

// --- create -----------------------------------------------------------------

export interface CreateWorkOrderCommand {
  readonly id: string;
  readonly bomId: string;
  readonly plannedQty: Qty;
  readonly sourceWarehouseId: string;
  readonly wipWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly priority?: WorkOrderPriority;
  readonly scheduledStartDate: string;
  readonly scheduledEndDate?: string | null;
  readonly notes?: string | null;
  readonly createdBy?: string;
  readonly configInstanceId?: string | null;
  readonly projectId?: string | null;
}

export interface CreateWorkOrderDeps {
  readonly workOrders: WorkOrderRepository;
  readonly boms: BomRepository;
  readonly numbering: NextNumberService;
  readonly now?: () => string;
}

/**
 * Snapshot a BOM into a planned work order: material required quantities, labour
 * and overhead are all scaled from the BOM's standard batch to the planned
 * quantity, and frozen on the order so later BOM edits never change it.
 */
export async function createWorkOrder(
  command: CreateWorkOrderCommand,
  deps: CreateWorkOrderDeps,
): Promise<WorkOrder> {
  const reasons: string[] = [];
  if (command.plannedQty.isZero() || command.plannedQty.isNegative()) {
    reasons.push("الكمية المخططة يجب أن تكون أكبر من صفر");
  }
  if (command.sourceWarehouseId.trim() === "") reasons.push("مستودع المواد الخام مطلوب");
  if (command.destinationWarehouseId.trim() === "") reasons.push("مستودع المنتج التام مطلوب");
  // مستودع التشغيل must be its OWN location. Pointing it at the raw store would
  // leave issued material indistinguishable from material still on the shelf,
  // and at the finished-goods store it would mix components with product — in
  // both cases the floor count this warehouse exists to make possible is lost.
  if (command.wipWarehouseId.trim() === "") reasons.push("مستودع التشغيل مطلوب");
  else if (command.wipWarehouseId === command.sourceWarehouseId) {
    reasons.push("يجب أن يختلف مستودع التشغيل عن مستودع المواد الخام");
  } else if (command.wipWarehouseId === command.destinationWarehouseId) {
    reasons.push("يجب أن يختلف مستودع التشغيل عن مستودع المنتج التام");
  }
  if (reasons.length > 0) throw new InvalidManufacturingDocumentError(reasons);

  const bom = await deps.boms.findById(command.bomId);
  if (!bom) throw new BomNotFoundError(command.bomId);
  if (await deps.workOrders.findById(command.id)) {
    throw new DuplicateManufacturingDocumentError(command.id);
  }

  const planned = command.plannedQty.scaled;
  const standard = bom.standardQty.scaled;
  const scaleMoney = (m: Money) => Money.fromScaled(mulDivRoundHalfUp(m.scaled, planned, standard));

  const materials = bom.lines.map<WorkOrderMaterial>((line) => {
    const effective = bomLineEffectiveQty(line);
    const requiredScaled = mulDivRoundHalfUp(effective.scaled, planned, standard);
    return {
      itemId: line.itemId,
      requiredQty: Qty.fromScaled(requiredScaled),
      wastePercent: line.wastePercent,
      optional: line.optional,
      issuedQty: Qty.zero(),
      returnedQty: Qty.zero(),
      issuedUnitCost: Money.zero(),
    };
  });

  const order: WorkOrder = {
    id: command.id,
    number: (await deps.numbering.next(WORK_ORDER_SEQUENCE)).formatted,
    bomId: bom.id,
    bomVersion: bom.version,
    productItemId: bom.productItemId,
    plannedQty: command.plannedQty,
    producedQty: Qty.zero(),
    sourceWarehouseId: command.sourceWarehouseId,
    wipWarehouseId: command.wipWarehouseId,
    destinationWarehouseId: command.destinationWarehouseId,
    priority: command.priority ?? "normal",
    scheduledStartDate: command.scheduledStartDate,
    scheduledEndDate: command.scheduledEndDate ?? null,
    notes: command.notes ?? null,
    status: "planned",
    stage: "not_started",
    materials,
    materialCost: Money.zero(),
    laborCost: scaleMoney(bom.laborCost),
    overheadCost: scaleMoney(bom.overheadCost),
    extraCost: Money.zero(),
    costLog: [],
    wasteLog: [],
    shopFloorLog: [],
    configInstanceId: command.configInstanceId ?? null,
    glPosted: false,
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
    startedAt: null,
    issuedAt: null,
    receivedAt: null,
    completedAt: null,
    projectId: command.projectId ?? null,
  };
  await deps.workOrders.create(order);
  return order;
}

// --- stage transitions ------------------------------------------------------

async function load(id: string, deps: { workOrders: WorkOrderRepository }): Promise<WorkOrder> {
  const order = await deps.workOrders.findById(id);
  if (!order) throw new WorkOrderNotFoundError(id);
  return order;
}

/** بدء العمل (Start): planned → in_progress, stage not_started → started. */
export async function startWorkOrder(
  id: string,
  deps: { workOrders: WorkOrderRepository; now?: () => string },
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "not_started") throw new WorkOrderStageError("start", order.stage);
  const updated: WorkOrder = { ...order, status: "in_progress", stage: "started", startedAt: nowIso(deps) };
  await deps.workOrders.update(updated);
  return updated;
}

export interface WorkOrderStockDeps {
  readonly workOrders: WorkOrderRepository;
  readonly stock: ManufacturingStockPort;
  readonly now?: () => string;
}

/**
 * Refuse to move a gram of stock for an order that names no مستودع التشغيل.
 *
 * Orders written before WIP had a location carry an empty one. Falling back to
 * the old behaviour for them — issuing straight out of the raw store — would
 * quietly keep the defect alive on exactly the rows nobody is watching, so the
 * order is refused instead and the operator re-plans it against a real WIP
 * warehouse.
 */
function wipWarehouseOf(order: WorkOrder): string {
  if (order.wipWarehouseId.trim() === "") {
    throw new InvalidManufacturingDocumentError([
      `أمر التصنيع "${order.number}" لا يحدد مستودع تشغيل`,
    ]);
  }
  return order.wipWarehouseId;
}

/**
 * Quantity scrapped OUT of مستودع التشغيل for one item — the waste entries that
 * actually moved stock. Legacy entries (`stockMoved: false`) count zero: their
 * material is still physically represented in WIP.
 */
export function workOrderWastedQty(order: Pick<WorkOrder, "wasteLog">, itemId: string): Qty {
  return order.wasteLog
    .filter((w) => w.stockMoved && w.itemId === itemId)
    .reduce((sum, w) => sum.add(w.qty), Qty.zero());
}

/** Normal (allowed) scrap cost still capitalised in this order — it reaches the product. */
export function workOrderNormalWasteCost(order: Pick<WorkOrder, "wasteLog">): Money {
  return Money.sum(order.wasteLog.map((w) => w.normalCost));
}

/** Abnormal scrap cost already expensed — never part of the product's cost. */
export function workOrderAbnormalWasteCost(order: Pick<WorkOrder, "wasteLog">): Money {
  return Money.sum(order.wasteLog.map((w) => w.abnormalCost));
}

/** Material still standing in مستودع التشغيل for this order: issued − returned − scrapped. */
export function workOrderWipQty(order: Pick<WorkOrder, "wasteLog">, m: Pick<WorkOrderMaterial, "itemId" | "issuedQty" | "returnedQty">): Qty {
  return m.issuedQty.subtract(m.returnedQty).subtract(workOrderWastedQty(order, m.itemId));
}

/**
 * Who did it and where (R9.1). The station and the operator are ids the caller
 * supplies; the API resolves both against their own registries before handing
 * them here, so a shop-floor entry can never name a station that does not
 * exist.
 */
export interface ShopFloorAttribution {
  readonly stationId?: string | null;
  readonly operatorId?: string | null;
}

function shopFloorEntry(
  kind: WorkOrderShopFloorEntry["kind"],
  attribution: ShopFloorAttribution | undefined,
  at: string,
  ref: string | null,
): WorkOrderShopFloorEntry {
  return {
    kind,
    stationId: attribution?.stationId ?? null,
    operatorId: attribution?.operatorId ?? null,
    ref,
    at,
  };
}

/**
 * صرف المواد (Issue materials): stage started → materials_issued. TRANSFERS
 * every non-optional material at its required quantity from the raw store into
 * مستودع التشغيل (stock-only — no GL), captures the moving-average cost as the
 * material WIP, and records the per-item issue unit cost.
 *
 * The transfer is valuation-neutral, which is the point: total inventory value
 * does not move, so the stock sub-ledger and GL 1200 stay in agreement for the
 * whole run rather than diverging by the issued value until completion. What
 * moves is the LOCATION — and that is the quantity a floor count reconciles
 * against.
 */
export async function issueWorkOrderMaterials(
  id: string,
  deps: WorkOrderStockDeps,
  attribution?: ShopFloorAttribution,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "started") throw new WorkOrderStageError("issue", order.stage);
  const wipWarehouseId = wipWarehouseOf(order);

  const toIssue = order.materials.filter((m) => !m.optional && m.requiredQty.scaled > 0n);
  if (toIssue.length === 0) throw new InvalidManufacturingDocumentError(["لا توجد مواد لصرفها"]);

  const occurredAt = nowIso(deps);
  const issueId = `WO-ISSUE:${order.id}`;
  const result = await deps.stock.postTransfer({
    transferId: issueId,
    sourceDocType: "WORK_ORDER",
    sourceDocId: order.id,
    transferNumber: order.number,
    fromWarehouseId: order.sourceWarehouseId,
    toWarehouseId: wipWarehouseId,
    lines: toIssue.map((m) => ({ itemId: m.itemId, qty: m.requiredQty })),
    occurredAt,
  });

  const costByItem = new Map<string, Money>();
  for (const l of result.lines) costByItem.set(l.itemId, l.unitCost);

  const materials = order.materials.map<WorkOrderMaterial>((m) => {
    if (m.optional || m.requiredQty.scaled === 0n) return m;
    return {
      ...m,
      issuedQty: m.requiredQty,
      issuedUnitCost: costByItem.get(m.itemId) ?? Money.zero(),
    };
  });

  const updated: WorkOrder = {
    ...order,
    stage: "materials_issued",
    materials,
    materialCost: order.materialCost.add(result.totalCost),
    issuedAt: occurredAt,
    shopFloorLog: [...order.shopFloorLog, shopFloorEntry("issue", attribution, occurredAt, issueId)],
  };
  await deps.workOrders.update(updated);
  return updated;
}

export interface IssueMoreLine {
  readonly itemId: string;
  readonly qty: Qty;
}

/**
 * صرف إضافي (Extra issue): a further transfer from the raw store into مستودع
 * التشغيل after the initial issue, adding to the issued quantities and the
 * material WIP.
 */
export async function extraIssueWorkOrderMaterials(
  id: string,
  lines: readonly IssueMoreLine[],
  deps: WorkOrderStockDeps,
  attribution?: ShopFloorAttribution,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued") throw new WorkOrderStageError("extra-issue", order.stage);
  const wipWarehouseId = wipWarehouseOf(order);
  if (lines.length === 0) throw new InvalidManufacturingDocumentError(["لا توجد مواد لصرفها"]);

  const occurredAt = nowIso(deps);
  const issueId = `WO-XISSUE:${order.id}:${occurredAt}`;
  const result = await deps.stock.postTransfer({
    transferId: issueId,
    sourceDocType: "WORK_ORDER",
    sourceDocId: order.id,
    transferNumber: order.number,
    fromWarehouseId: order.sourceWarehouseId,
    toWarehouseId: wipWarehouseId,
    lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    occurredAt,
  });

  const addQty = new Map<string, Qty>();
  const addCost = new Map<string, Money>();
  for (const l of result.lines) {
    addQty.set(l.itemId, (addQty.get(l.itemId) ?? Qty.zero()).add(l.qty));
    addCost.set(l.itemId, l.unitCost);
  }
  const materials = mergeIssuedMaterials(order.materials, addQty, addCost);

  const updated: WorkOrder = {
    ...order,
    materials,
    materialCost: order.materialCost.add(result.totalCost),
    shopFloorLog: [...order.shopFloorLog, shopFloorEntry("extra_issue", attribution, occurredAt, issueId)],
  };
  await deps.workOrders.update(updated);
  return updated;
}

function mergeIssuedMaterials(
  materials: readonly WorkOrderMaterial[],
  addQty: Map<string, Qty>,
  addCost: Map<string, Money>,
): WorkOrderMaterial[] {
  const byItem = new Map(materials.map((m) => [m.itemId, m]));
  for (const [itemId, qty] of addQty) {
    const existing = byItem.get(itemId);
    if (existing) {
      byItem.set(itemId, {
        ...existing,
        issuedQty: existing.issuedQty.add(qty),
        issuedUnitCost: addCost.get(itemId) ?? existing.issuedUnitCost,
      });
    } else {
      byItem.set(itemId, {
        itemId,
        requiredQty: Qty.zero(),
        wastePercent: 0,
        optional: true,
        issuedQty: qty,
        returnedQty: Qty.zero(),
        issuedUnitCost: addCost.get(itemId) ?? Money.zero(),
      });
    }
  }
  return [...byItem.values()];
}

/**
 * إرجاع مواد (Return materials): unused material walks back off the floor —
 * a transfer out of مستودع التشغيل into the raw store, reducing the material WIP
 * by the value that actually left.
 *
 * The returnable quantity is recomputed HERE from the order's own issued and
 * returned totals; it is never read from the request. And the value credited
 * back to WIP is the value the ledger says left مستودع التشغيل, not a figure
 * re-derived from the issue-time unit cost: those two differ the moment a second
 * issue lands at a different moving average, and re-deriving would leave the
 * order's `materialCost` claiming stock that مستودع التشغيل does not hold.
 */
export async function returnWorkOrderMaterials(
  id: string,
  lines: readonly IssueMoreLine[],
  deps: WorkOrderStockDeps,
  attribution?: ShopFloorAttribution,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued") throw new WorkOrderStageError("return", order.stage);
  const wipWarehouseId = wipWarehouseOf(order);
  if (lines.length === 0) throw new InvalidManufacturingDocumentError(["لا توجد مواد لإرجاعها"]);

  const byItem = new Map(order.materials.map((m) => [m.itemId, m]));
  for (const l of lines) {
    const mat = byItem.get(l.itemId);
    const outstanding = mat ? workOrderWipQty(order, mat) : Qty.zero();
    if (!mat || l.qty.compare(outstanding) > 0) {
      throw new InvalidManufacturingDocumentError([
        `لا يمكن إرجاع ${l.qty.toString()} من "${l.itemId}"؛ القائم فقط ${outstanding.toString()}`,
      ]);
    }
  }

  const occurredAt = nowIso(deps);
  const returnId = `WO-RETURN:${order.id}:${occurredAt}`;
  const result = await deps.stock.postTransfer({
    transferId: returnId,
    sourceDocType: "WORK_ORDER",
    sourceDocId: order.id,
    transferNumber: order.number,
    fromWarehouseId: wipWarehouseId,
    toWarehouseId: order.sourceWarehouseId,
    lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    occurredAt,
  });

  const returnedQtyByItem = new Map<string, Qty>();
  for (const l of lines) {
    returnedQtyByItem.set(l.itemId, (returnedQtyByItem.get(l.itemId) ?? Qty.zero()).add(l.qty));
  }
  const materials = order.materials.map<WorkOrderMaterial>((m) => {
    const ret = returnedQtyByItem.get(m.itemId);
    return ret ? { ...m, returnedQty: m.returnedQty.add(ret) } : m;
  });

  const updated: WorkOrder = {
    ...order,
    materials,
    materialCost: order.materialCost.add(result.totalCost.negate()),
    shopFloorLog: [...order.shopFloorLog, shopFloorEntry("return", attribution, occurredAt, returnId)],
  };
  await deps.workOrders.update(updated);
  return updated;
}

/** What تسجيل فاقد needs beyond the order itself: the stock ledger and a GL to expense abnormal loss into. */
export interface WorkOrderWasteDeps extends WorkOrderStockDeps {
  readonly gl: ManufacturingGlPostingPort;
  readonly accounts: WorkOrderWasteAccounts;
}

/** The accounts a scrap posting touches. */
export interface WorkOrderWasteAccounts {
  /** Credited for ALL scrap that left مستودع التشغيل — the control account the stock ledger moves value through. */
  readonly rawInventoryAccountId: string;
  /** Debited for scrap beyond the BOM allowance — a loss of this period. */
  readonly abnormalScrapAccountId: string;
  /** Debited for scrap within the allowance — still an asset, waiting for the product that absorbs it. */
  readonly wipAccountId: string;
}

/**
 * تسجيل فاقد (Log waste): material is destroyed on the floor, so it leaves
 * مستودع التشغيل — and its cost is split against what the BOM planned for.
 *
 * This used to write a row into `wasteLog` and move nothing (D64), so a floor
 * count disagreed with the system by exactly the scrapped quantity from the
 * moment it was logged until the product was received.
 *
 * The split is the accounting standard, not a preference:
 *   - up to the BOM's own waste allowance the loss is NORMAL. Its cost stays
 *     capitalised in the order and reaches the finished product, which is what
 *     `wastePercent` grossing up the required quantity already assumed. No GL
 *     entry now — the completion posting credits inventory for it along with
 *     everything else consumed.
 *   - beyond the allowance the loss is ABNORMAL and belongs to the period it
 *     happened in: Dr فاقد التصنيع غير الطبيعي / Cr المخزون, posted here, and
 *     deliberately NOT added to `materialCost` so it never reaches the product.
 *
 * The allowance is consumed across the whole run, not per entry: scrapping 3%
 * twice against a 5% allowance makes the second entry 2% normal and 1%
 * abnormal. The value split uses the cost the ledger says actually left, and
 * `allocate` so the two parts sum to it EXACTLY.
 */
export async function logWorkOrderWaste(
  id: string,
  entries: readonly { itemId: string; qty: Qty; notes?: string | null }[],
  deps: WorkOrderWasteDeps,
  attribution?: ShopFloorAttribution,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued" && order.stage !== "product_received") {
    throw new WorkOrderStageError("log-waste", order.stage);
  }
  const wipWarehouseId = wipWarehouseOf(order);
  if (entries.length === 0) throw new InvalidManufacturingDocumentError(["لا يوجد هدر لتسجيله"]);

  // Aggregate per item first: two lines for the same item in one call must be
  // checked against the outstanding quantity TOGETHER, or each passes alone
  // and the pair scraps more than the floor holds.
  const wantedByItem = new Map<string, Qty>();
  for (const e of entries) {
    if (e.qty.isZero() || e.qty.isNegative()) {
      throw new InvalidManufacturingDocumentError([`كمية الهدر لـ "${e.itemId}" يجب أن تكون أكبر من صفر`]);
    }
    wantedByItem.set(e.itemId, (wantedByItem.get(e.itemId) ?? Qty.zero()).add(e.qty));
  }

  const byItem = new Map(order.materials.map((m) => [m.itemId, m]));
  for (const [itemId, qty] of wantedByItem) {
    const mat = byItem.get(itemId);
    const outstanding = mat ? workOrderWipQty(order, mat) : Qty.zero();
    if (!mat || qty.compare(outstanding) > 0) {
      throw new InvalidManufacturingDocumentError([
        `لا يمكن هدر ${qty.toString()} من "${itemId}"؛ القائم فقط ${outstanding.toString()} في مستودع التشغيل`,
      ]);
    }
  }

  const at = nowIso(deps);
  const wasteId = `WO-WASTE:${order.id}:${at}`;
  const issueLines = [...wantedByItem].map(([itemId, qty]) => ({ itemId, qty }));
  // No `gl` on the command: the normal half is credited to inventory later, by
  // the completion posting, and the abnormal half is posted here. Letting
  // postIssue post the whole cost would double-count the normal part.
  const issued = await deps.stock.postIssue({
    issueId: wasteId,
    sourceDocType: "WORK_ORDER",
    sourceDocId: order.id,
    sourceDocNumber: order.number,
    warehouseId: wipWarehouseId,
    lines: issueLines,
    occurredAt: at,
  });

  const costByItem = new Map<string, Money>();
  for (const l of issued.lines) {
    costByItem.set(l.itemId, (costByItem.get(l.itemId) ?? Money.zero()).add(l.cost));
  }

  // Allowance left per item, after everything already scrapped as normal.
  const allowanceLeft = new Map<string, Qty>();
  for (const [itemId, mat] of byItem) {
    const used = order.wasteLog
      .filter((w) => w.itemId === itemId)
      .reduce((sum, w) => sum.add(w.normalQty), Qty.zero());
    const total = wasteAllowanceOf(mat.requiredQty, mat.wastePercent);
    allowanceLeft.set(itemId, total.compare(used) > 0 ? total.subtract(used) : Qty.zero());
  }

  const newEntries: WorkOrderWasteEntry[] = [];
  for (const e of entries) {
    const left = allowanceLeft.get(e.itemId) ?? Qty.zero();
    const normalQty = left.compare(e.qty) >= 0 ? e.qty : left;
    const abnormalQty = e.qty.subtract(normalQty);
    allowanceLeft.set(e.itemId, left.subtract(normalQty));

    // The item's whole cost this call, shared out across ITS entries by
    // quantity, then split normal/abnormal — both with largest-remainder, so
    // nothing is created or lost by rounding.
    const itemTotalQty = wantedByItem.get(e.itemId) ?? e.qty;
    const itemCost = costByItem.get(e.itemId) ?? Money.zero();
    const [entryCost] = allocate(itemCost, [e.qty.scaled, itemTotalQty.scaled - e.qty.scaled]);
    const [normalCost, abnormalCost] = allocate(entryCost ?? Money.zero(), [normalQty.scaled, abnormalQty.scaled]);

    newEntries.push({
      itemId: e.itemId,
      qty: e.qty,
      notes: e.notes ?? null,
      at,
      stockMoved: true,
      normalQty,
      abnormalQty,
      normalCost: normalCost ?? Money.zero(),
      abnormalCost: abnormalCost ?? Money.zero(),
    });
  }

  // ALL of it leaves inventory, because all of it is physically gone — so GL
  // 1200 falls by exactly what the sub-ledger just lost, and the two never
  // drift mid-run. Where the value goes is what the split decides: the normal
  // part is still an asset and parks in إنتاج تحت التشغيل until the product
  // that absorbs it is received; the abnormal part is a loss of this period.
  const normalTotal = Money.sum(newEntries.map((e) => e.normalCost));
  const abnormalTotal = Money.sum(newEntries.map((e) => e.abnormalCost));
  const scrapTotal = normalTotal.add(abnormalTotal);
  if (scrapTotal.scaled !== 0n) {
    const glLines: ManufacturingGlPostingLine[] = [];
    if (abnormalTotal.scaled !== 0n) {
      glLines.push({ accountId: deps.accounts.abnormalScrapAccountId, debit: abnormalTotal, credit: Money.zero() });
    }
    if (normalTotal.scaled !== 0n) {
      glLines.push({ accountId: deps.accounts.wipAccountId, debit: normalTotal, credit: Money.zero() });
    }
    glLines.push({ accountId: deps.accounts.rawInventoryAccountId, debit: Money.zero(), credit: scrapTotal });
    await deps.gl.post({
      sourceDocType: "WORK_ORDER",
      sourceDocId: order.id,
      sourceDocNumber: order.number,
      // The GL is dated with a DAY; `at` is an ISO instant.
      date: at.slice(0, 10),
      memo: `فاقد أمر التصنيع ${order.number}`,
      // Scrap can be logged many times on one order, so the ref carries the
      // waste id (which is already unique per call) rather than the order's.
      entryRef: `WO-WASTE-JE:${wasteId}`,
      lines: glLines,
    });
  }

  const updated: WorkOrder = {
    ...order,
    wasteLog: [...order.wasteLog, ...newEntries],
    shopFloorLog: [...order.shopFloorLog, shopFloorEntry("waste", attribution, at, wasteId)],
  };
  await deps.workOrders.update(updated);
  return updated;
}

/** تسجيل تكلفة (Log cost): capitalise an extra labour/overhead/other cost into WIP. */
export async function logWorkOrderCost(
  id: string,
  entry: { kind: "labor" | "overhead" | "other"; amount: Money; notes?: string | null },
  deps: { workOrders: WorkOrderRepository; now?: () => string },
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage === "not_started" || order.stage === "completed") {
    throw new WorkOrderStageError("log-cost", order.stage);
  }
  if (entry.amount.scaled <= 0n) {
    throw new InvalidManufacturingDocumentError(["التكلفة المسجّلة يجب أن تكون أكبر من صفر"]);
  }
  const at = nowIso(deps);
  const patch: Partial<WorkOrder> =
    entry.kind === "labor"
      ? { laborCost: order.laborCost.add(entry.amount) }
      : entry.kind === "overhead"
        ? { overheadCost: order.overheadCost.add(entry.amount) }
        : { extraCost: order.extraCost.add(entry.amount) };
  const updated: WorkOrder = {
    ...order,
    ...patch,
    costLog: [...order.costLog, { kind: entry.kind, amount: entry.amount, notes: entry.notes ?? null, at }],
  };
  await deps.workOrders.update(updated);
  return updated;
}

/**
 * استلام المنتج (Receive product): stage materials_issued → product_received.
 *
 * Two stock moves, in this order:
 *
 *   1. CONSUME — every material still standing in مستودع التشغيل leaves stock.
 *      This is where raw material is finally used up; until now it had merely
 *      changed address. Anything not consumed by the product must be returned
 *      to the raw store first, which is why the whole outstanding quantity goes.
 *   2. RECEIVE — the finished product enters the finished-goods warehouse at
 *      unit cost = WIP total ÷ produced quantity.
 *
 * `materialCost` is then RESET to what the consume leg actually removed from
 * inventory, not left at the sum of the issues. The completion posting credits
 * raw inventory by `materialCost`, so if the two ever differ the GL and the
 * stock sub-ledger part company by the difference — the D3 failure shape. They
 * differ in practice as soon as مستودع التشغيل holds the same item for two
 * orders at once and its moving average blends them.
 *
 * Both moves are stock-only (no GL); إكمال أمر العمل posts the ledger.
 */
export interface WorkOrderReceiveDeps extends WorkOrderStockDeps {
  readonly gl: ManufacturingGlPostingPort;
  readonly accounts: Pick<WorkOrderWasteAccounts, "rawInventoryAccountId" | "wipAccountId">;
}

export async function receiveWorkOrderProduct(
  id: string,
  producedQty: Qty,
  deps: WorkOrderReceiveDeps,
  attribution?: ShopFloorAttribution,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued") throw new WorkOrderStageError("receive", order.stage);
  const wipWarehouseId = wipWarehouseOf(order);
  if (producedQty.isZero() || producedQty.isNegative()) {
    throw new InvalidManufacturingDocumentError(["الكمية المنتجة يجب أن تكون أكبر من صفر"]);
  }

  const occurredAt = nowIso(deps);
  const consumeLines = order.materials
    .map((m) => ({ itemId: m.itemId, qty: workOrderWipQty(order, m) }))
    .filter((l) => l.qty.scaled > 0n);

  const receiptId = `WO-RECEIVE:${order.id}`;
  let consumedCost = Money.zero();
  if (consumeLines.length > 0) {
    const consumed = await deps.stock.postIssue({
      // Deliberately a CHILD of the receipt id, not an id of its own. The
      // consume and the finished-goods receipt are one shop-floor action, and
      // the activity feed joins a station and an operator onto a movement by
      // the `<ref>:…` prefix of the action that produced it — an id starting
      // anywhere else would report both consume movements as performed by
      // nobody, at no station.
      issueId: `${receiptId}:consume`,
      sourceDocType: "WORK_ORDER",
      sourceDocId: order.id,
      sourceDocNumber: order.number,
      warehouseId: wipWarehouseId,
      lines: consumeLines,
      occurredAt,
    });
    consumedCost = consumed.totalCost;
  }

  // Normal scrap left مستودع التشغيل earlier but its cost is still the
  // product's — `consumedCost` covers only what was standing at receipt, so
  // adding it back is what keeps the unit cost the same as it was before waste
  // moved stock at all. Abnormal scrap is deliberately absent: it was expensed
  // the day it happened and must never reach the product.
  const materialCost = consumedCost.add(workOrderNormalWasteCost(order));
  const wip = workOrderWipTotal({ ...order, materialCost });
  const unitCost = unitCostFloor(wip, producedQty);
  await deps.stock.postReceipt({
    receiptId,
    sourceDocId: order.id,
    receiptNumber: order.number,
    warehouseId: order.destinationWarehouseId,
    sourceDocType: "WORK_ORDER",
    lines: finishedGoodsReceiptLines(order.productItemId, producedQty, wip, unitCost),
    occurredAt,
  });

  // The normal scrap parked in إنتاج تحت التشغيل is now inside the finished
  // goods the stock ledger just valued at `unitCost`, so it comes back to the
  // inventory control account and 1250 returns to zero for this order. Without
  // this the sub-ledger would rise by the scrap's value and GL 1200 would not.
  const parkedWaste = workOrderNormalWasteCost(order);
  if (parkedWaste.scaled !== 0n) {
    await deps.gl.post({
      sourceDocType: "WORK_ORDER",
      sourceDocId: order.id,
      sourceDocNumber: order.number,
      date: occurredAt.slice(0, 10),
      memo: `تحميل الفاقد الطبيعي على المنتج — أمر التصنيع ${order.number}`,
      // Once per order: the stage guard admits exactly one receipt.
      entryRef: `WO-RECEIVE-JE:${order.id}`,
      lines: [
        { accountId: deps.accounts.rawInventoryAccountId, debit: parkedWaste, credit: Money.zero() },
        { accountId: deps.accounts.wipAccountId, debit: Money.zero(), credit: parkedWaste },
      ],
    });
  }

  const updated: WorkOrder = {
    ...order,
    stage: "product_received",
    producedQty,
    materialCost,
    receivedAt: occurredAt,
    shopFloorLog: [...order.shopFloorLog, shopFloorEntry("receive", attribution, occurredAt, receiptId)],
  };
  await deps.workOrders.update(updated);
  return updated;
}

/**
 * INVARIANT: the receipt is worth exactly `wip`, the amount the completion
 * posting debits to inventory. One line at `round(wip ÷ qty)` left the stock
 * ledger up to half a micro-unit per unit away from GL 1200 (D206), so one unit
 * carries the remainder. At a quantity of one or less the rounding cannot
 * survive `extend`, so no split is needed. The unit cost must be rounded DOWN
 * (`unitCostFloor`): rounded up, the remainder unit goes negative once
 * (qty − 1) half-micro-units exceed the WIP itself (D224).
 */
function finishedGoodsReceiptLines(
  itemId: string,
  qty: Qty,
  wip: Money,
  unitCost: Money,
): { itemId: string; qty: Qty; unitCost: Money }[] {
  const one = Qty.fromMajor("1");
  if (extend(qty, unitCost).scaled === wip.scaled || qty.compare(one) <= 0) {
    return [{ itemId, qty, unitCost }];
  }
  const head = qty.subtract(one);
  const tail = Money.fromScaled(wip.scaled - extend(head, unitCost).scaled);
  return [
    { itemId, qty: head, unitCost },
    { itemId, qty: one, unitCost: tail },
  ];
}

function unitCostFloor(total: Money, qty: Qty): Money {
  if (qty.scaled <= 0n || total.scaled <= 0n) return unitCostOf(total, qty);
  return Money.fromScaled((total.scaled * 1_000_000n) / qty.scaled);
}

export interface CompleteWorkOrderDeps {
  readonly workOrders: WorkOrderRepository;
  readonly gl: ManufacturingGlPostingPort;
  readonly accounts: WorkOrderGlAccounts;
  readonly now?: () => string;
}

export interface CompleteWorkOrderResult {
  readonly order: WorkOrder;
  readonly posting: ManufacturingGlPosting | null;
}

/**
 * Build the balanced WIP-capitalisation posting for a received work order
 * (docs/archive/catalog/07 — FG receipt / raw / labour / overhead).
 *
 * Lines are NETTED by account, not merely merged by side. The finished-goods
 * and raw-materials roles usually resolve to the SAME inventory control
 * account, because that is the only account the stock ledger moves value
 * through, and a Dr and a Cr against one account in one entry is both untidy
 * and, worse, invisible: `accountBalance` has no subtree rollup, so posting the
 * two legs to 1210/1220 instead left GL 1200 flat while the stock sub-ledger
 * moved by labour plus overhead — the 80.00 gap D3 measured.
 */
export function buildWorkOrderGlPosting(
  order: WorkOrder,
  accounts: WorkOrderGlAccounts,
  date: string,
): ManufacturingGlPosting | null {
  const wip = workOrderWipTotal(order);
  if (wip.scaled === 0n) return null;

  const overheadTotal = order.overheadCost.add(order.extraCost);
  // Signed by account: positive is a net debit, negative a net credit.
  const netByAccount = new Map<string, bigint>();
  const add = (accountId: string, scaled: bigint) => {
    if (scaled === 0n) return;
    netByAccount.set(accountId, (netByAccount.get(accountId) ?? 0n) + scaled);
  };
  add(accounts.finishedGoodsAccountId, wip.scaled);
  add(accounts.rawInventoryAccountId, -order.materialCost.scaled);
  add(accounts.laborAppliedAccountId, -order.laborCost.scaled);
  add(accounts.overheadAppliedAccountId, -overheadTotal.scaled);

  const lines: ManufacturingGlPostingLine[] = [];
  for (const [accountId, net] of netByAccount) {
    if (net === 0n) continue;
    lines.push(
      net > 0n
        ? { accountId, debit: Money.fromScaled(net), credit: Money.zero(), projectId: order.projectId }
        : { accountId, debit: Money.zero(), credit: Money.fromScaled(-net), projectId: order.projectId },
    );
  }
  if (lines.length < 2) return null;

  return {
    sourceDocType: "WORK_ORDER",
    sourceDocId: order.id,
    sourceDocNumber: order.number,
    date,
    memo: `إكمال أمر التصنيع ${order.number}`,
    lines,
  };
}

/**
 * إكمال أمر العمل (Complete): stage product_received → completed. Auto-posts the
 * WIP-capitalisation GL chain (finished goods vs. raw / labour / overhead) and
 * marks the order completed.
 */
export async function completeWorkOrder(
  id: string,
  deps: CompleteWorkOrderDeps,
): Promise<CompleteWorkOrderResult> {
  const order = await load(id, deps);
  if (order.stage !== "product_received") throw new WorkOrderStageError("complete", order.stage);

  const completedAt = nowIso(deps);
  const posting = buildWorkOrderGlPosting(order, deps.accounts, completedAt.slice(0, 10));
  if (posting) await deps.gl.post(posting);

  const updated: WorkOrder = {
    ...order,
    status: "completed",
    stage: "completed",
    glPosted: posting !== null,
    completedAt,
  };
  await deps.workOrders.update(updated);
  return { order: updated, posting };
}

/** إلغاء أمر التصنيع (Cancel) — only before materials are issued (no reversal path). */
export async function cancelWorkOrder(
  id: string,
  deps: { workOrders: WorkOrderRepository },
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "not_started" && order.stage !== "started") {
    throw new WorkOrderStageError("cancel", order.stage);
  }
  const updated: WorkOrder = { ...order, status: "cancelled" };
  await deps.workOrders.update(updated);
  return updated;
}
