/**
 * أمر التصنيع (Work Order) — a discrete production run against a BOM
 * (docs/catalog/07 §Work Orders). It executes through a 4-stage machine:
 *
 *   بدء العمل (start) → صرف المواد (issue raw materials, stock OUT) →
 *   استلام المنتج (receive finished product, stock IN) → إكمال أمر العمل
 *   (complete — auto-posts the GL chain).
 *
 * WIP costing: raw materials issue OUT at their moving-average cost (accumulated
 * as the work order's material WIP), while standard labour and overhead from the
 * BOM capitalise into WIP too. On product receipt the whole WIP (materials +
 * labour + overhead + any logged extra cost) is capitalised into finished-goods
 * inventory at the computed unit cost — so COGS is recognised only on the later
 * sale, never here. Stock moves are posted stock-only (no GL); the single
 * completion posting drives the ledger, mirroring the purchase chain's split of
 * receipt (stock) vs. invoice (GL).
 */

import { Money, Qty } from "../money/index.js";
import { unitCostOf } from "../inventory/index.js";
import { NextNumberService } from "../numbering/index.js";
import { type Bom, type BomRepository, bomLineEffectiveQty } from "./bom.js";
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

export interface WorkOrderWasteEntry {
  readonly itemId: string;
  readonly qty: Qty;
  readonly notes: string | null;
  readonly at: string;
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
  readonly configInstanceId: string | null;
  readonly glPosted: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly issuedAt: string | null;
  readonly receivedAt: string | null;
  readonly completedAt: string | null;
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
  readonly destinationWarehouseId: string;
  readonly priority?: WorkOrderPriority;
  readonly scheduledStartDate: string;
  readonly scheduledEndDate?: string | null;
  readonly notes?: string | null;
  readonly createdBy?: string;
  readonly configInstanceId?: string | null;
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
    reasons.push("planned quantity must be positive");
  }
  if (command.sourceWarehouseId.trim() === "") reasons.push("a raw-material warehouse is required");
  if (command.destinationWarehouseId.trim() === "") reasons.push("a finished-goods warehouse is required");
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
    configInstanceId: command.configInstanceId ?? null,
    glPosted: false,
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
    startedAt: null,
    issuedAt: null,
    receivedAt: null,
    completedAt: null,
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
 * صرف المواد (Issue materials): stage started → materials_issued. Posts stock
 * OUT for every non-optional material at its required quantity (stock-only —
 * no GL), captures the moving-average cost as the material WIP, and records the
 * per-item issue unit cost so returns can reverse at the same cost.
 */
export async function issueWorkOrderMaterials(
  id: string,
  deps: WorkOrderStockDeps,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "started") throw new WorkOrderStageError("issue", order.stage);

  const toIssue = order.materials.filter((m) => !m.optional && m.requiredQty.scaled > 0n);
  if (toIssue.length === 0) throw new InvalidManufacturingDocumentError(["no materials to issue"]);

  const occurredAt = nowIso(deps);
  const result = await deps.stock.postIssue({
    issueId: `WO-ISSUE:${order.id}`,
    sourceDocType: "WORK_ORDER",
    sourceDocId: order.id,
    sourceDocNumber: order.number,
    warehouseId: order.sourceWarehouseId,
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
  };
  await deps.workOrders.update(updated);
  return updated;
}

export interface IssueMoreLine {
  readonly itemId: string;
  readonly qty: Qty;
}

/**
 * صرف إضافي (Extra issue): additional stock OUT after the initial issue, adding
 * to the issued quantities and the material WIP.
 */
export async function extraIssueWorkOrderMaterials(
  id: string,
  lines: readonly IssueMoreLine[],
  deps: WorkOrderStockDeps,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued") throw new WorkOrderStageError("extra-issue", order.stage);
  if (lines.length === 0) throw new InvalidManufacturingDocumentError(["no materials to issue"]);

  const occurredAt = nowIso(deps);
  const result = await deps.stock.postIssue({
    issueId: `WO-XISSUE:${order.id}:${occurredAt}`,
    sourceDocType: "WORK_ORDER",
    sourceDocId: order.id,
    sourceDocNumber: order.number,
    warehouseId: order.sourceWarehouseId,
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
 * إرجاع مواد (Return materials): unused issued material goes back to the source
 * warehouse (stock IN) at the recorded issue unit cost, reducing the material
 * WIP by the same value.
 */
export async function returnWorkOrderMaterials(
  id: string,
  lines: readonly IssueMoreLine[],
  deps: WorkOrderStockDeps,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued") throw new WorkOrderStageError("return", order.stage);
  if (lines.length === 0) throw new InvalidManufacturingDocumentError(["no materials to return"]);

  const byItem = new Map(order.materials.map((m) => [m.itemId, m]));
  const receiptLines = lines.map((l) => {
    const mat = byItem.get(l.itemId);
    const unitCost = mat?.issuedUnitCost ?? Money.zero();
    const outstanding = mat ? mat.issuedQty.subtract(mat.returnedQty) : Qty.zero();
    if (!mat || l.qty.compare(outstanding) > 0) {
      throw new InvalidManufacturingDocumentError([
        `cannot return ${l.qty.toString()} of "${l.itemId}"; only ${outstanding.toString()} outstanding`,
      ]);
    }
    return { itemId: l.itemId, qty: l.qty, unitCost };
  });

  const occurredAt = nowIso(deps);
  await deps.stock.postReceipt({
    receiptId: `WO-RETURN:${order.id}:${occurredAt}`,
    receiptNumber: order.number,
    warehouseId: order.sourceWarehouseId,
    sourceDocType: "WORK_ORDER",
    lines: receiptLines,
    occurredAt,
  });

  let returnedValue = Money.zero();
  const materials = order.materials.map<WorkOrderMaterial>((m) => {
    const ret = lines.find((l) => l.itemId === m.itemId);
    if (!ret) return m;
    returnedValue = returnedValue.add(
      Money.fromScaled(mulDivRoundHalfUp(ret.qty.scaled, m.issuedUnitCost.scaled, 1_000_000n)),
    );
    return { ...m, returnedQty: m.returnedQty.add(ret.qty) };
  });

  const updated: WorkOrder = {
    ...order,
    materials,
    materialCost: order.materialCost.add(returnedValue.negate()),
  };
  await deps.workOrders.update(updated);
  return updated;
}

/** تسجيل فاقد (Log waste): record wasted material (informational — no stock effect). */
export async function logWorkOrderWaste(
  id: string,
  entries: readonly { itemId: string; qty: Qty; notes?: string | null }[],
  deps: { workOrders: WorkOrderRepository; now?: () => string },
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued" && order.stage !== "product_received") {
    throw new WorkOrderStageError("log-waste", order.stage);
  }
  const at = nowIso(deps);
  const wasteLog = [
    ...order.wasteLog,
    ...entries.map((e) => ({ itemId: e.itemId, qty: e.qty, notes: e.notes ?? null, at })),
  ];
  const updated: WorkOrder = { ...order, wasteLog };
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
    throw new InvalidManufacturingDocumentError(["logged cost must be positive"]);
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
 * Capitalises the whole WIP into finished-goods inventory — the finished product
 * enters stock (stock IN, no GL) at unit cost = WIP total ÷ produced quantity.
 */
export async function receiveWorkOrderProduct(
  id: string,
  producedQty: Qty,
  deps: WorkOrderStockDeps,
): Promise<WorkOrder> {
  const order = await load(id, deps);
  if (order.stage !== "materials_issued") throw new WorkOrderStageError("receive", order.stage);
  if (producedQty.isZero() || producedQty.isNegative()) {
    throw new InvalidManufacturingDocumentError(["produced quantity must be positive"]);
  }

  const wip = workOrderWipTotal(order);
  const unitCost = unitCostOf(wip, producedQty);
  const occurredAt = nowIso(deps);
  await deps.stock.postReceipt({
    receiptId: `WO-RECEIVE:${order.id}`,
    receiptNumber: order.number,
    warehouseId: order.destinationWarehouseId,
    sourceDocType: "WORK_ORDER",
    lines: [{ itemId: order.productItemId, qty: producedQty, unitCost }],
    occurredAt,
  });

  const updated: WorkOrder = {
    ...order,
    stage: "product_received",
    producedQty,
    receivedAt: occurredAt,
  };
  await deps.workOrders.update(updated);
  return updated;
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
 * (docs/catalog/07 — FG receipt / raw / labour / overhead).
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
        ? { accountId, debit: Money.fromScaled(net), credit: Money.zero() }
        : { accountId, debit: Money.zero(), credit: Money.fromScaled(-net) },
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
  const posting = buildWorkOrderGlPosting(order, deps.accounts, completedAt);
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
