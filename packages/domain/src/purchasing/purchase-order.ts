/**
 * أمر الشراء (Purchase Order) — the first document in the purchase chain
 * (docs/archive/catalog/02 §Purchase Orders). A PO carries no stock or GL effect; it is
 * numbering + workflow only: مسودة (draft) → مرسل (sent) → مستلم جزئياً /
 * مستلم بالكامل (partially / fully received) as goods receipts confirm against
 * it, with ملغي (cancelled) as the cancel path.
 */

import type { ReasonInput } from "../bilingual-reasons.js";
import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/index.js";
import { NextNumberService } from "../numbering/index.js";
import { atomically, recordPurchaseAudit, type PurchaseAuditDeps } from "./audit.js";
import type { PurchaseOrderStatus } from "./types.js";
import {
  InvalidPurchaseDocumentError,
  PurchaseOrderNotFoundError,
} from "./errors.js";

const PURCHASE_ORDER_SEQUENCE = "PURCHASE_ORDER";

export interface PurchaseOrderLine {
  readonly itemId: string;
  readonly description: string | null;
  readonly qty: Qty;
  readonly unitPrice: Money;
  /** Cumulative qty received against this line via confirmed goods receipts. */
  readonly receivedQty: Qty;
}

export interface PurchaseOrder {
  readonly id: string;
  /** Sequential document number ("PO-000001"), assigned at creation. */
  readonly number: string;
  readonly supplierId: string;
  /** ISO date (YYYY-MM-DD). */
  readonly date: string;
  readonly expectedDeliveryDate: string | null;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly currency: string;
  readonly notes: string | null;
  readonly lines: readonly PurchaseOrderLine[];
  readonly status: PurchaseOrderStatus;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Persistence port. The domain depends on this interface only (docs/archive/plan.md §2.2). */
export interface PurchaseOrderRepository {
  findById(id: string): Promise<PurchaseOrder | null>;
  list(): Promise<PurchaseOrder[]>;
  create(order: PurchaseOrder): Promise<void>;
  update(order: PurchaseOrder): Promise<void>;
}

export interface PurchaseOrderLineInput {
  readonly itemId: string;
  readonly description?: string | null;
  readonly qty: Qty;
  readonly unitPrice: Money;
}

export interface CreatePurchaseOrderCommand {
  readonly id: string;
  readonly supplierId: string;
  readonly date: string;
  readonly expectedDeliveryDate?: string | null;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly currency?: string;
  readonly notes?: string | null;
  readonly createdBy?: string;
  readonly lines: readonly PurchaseOrderLineInput[];
}

export interface PurchaseOrderDeps extends PurchaseAuditDeps {
  readonly orders: PurchaseOrderRepository;
  readonly numbering: NextNumberService;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
}

export type ConfirmPurchaseOrderDeps = Pick<PurchaseOrderDeps, "orders" | "audit" | "actor" | "transactor">;
export type CancelPurchaseOrderDeps = ConfirmPurchaseOrderDeps;

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

// --- pure computations ------------------------------------------------------

/** Extended value of a line (qty × unit price), rounded at the LINE_EXTENSION boundary. */
export function purchaseOrderLineTotal(line: {
  readonly qty: Qty;
  readonly unitPrice: Money;
}): Money {
  return extend(line.qty, line.unitPrice);
}

/** Σ line totals — the order subtotal (== total; a PO carries no tax). */
export function purchaseOrderSubtotal(order: {
  readonly lines: readonly { qty: Qty; unitPrice: Money }[];
}): Money {
  return Money.sum(order.lines.map(purchaseOrderLineTotal));
}

export const purchaseOrderTotal = purchaseOrderSubtotal;

/** Outstanding (not-yet-received) qty of a line: ordered − received (never negative). */
export function lineOutstandingQty(line: {
  readonly qty: Qty;
  readonly receivedQty: Qty;
}): Qty {
  const outstanding = line.qty.subtract(line.receivedQty);
  return outstanding.isNegative() ? Qty.zero() : outstanding;
}

/** True once every line has been received in full. */
export function isFullyReceived(order: { readonly lines: readonly PurchaseOrderLine[] }): boolean {
  return order.lines.every((l) => lineOutstandingQty(l).isZero());
}

/** Derive the status after (possibly partial) receiving, from a base of "sent". */
export function deriveReceivedStatus(lines: readonly PurchaseOrderLine[]): PurchaseOrderStatus {
  const anyReceived = lines.some((l) => !l.receivedQty.isZero());
  const allReceived = lines.every((l) => lineOutstandingQty(l).isZero());
  if (allReceived) return "fully_received";
  if (anyReceived) return "partially_received";
  return "sent";
}

function validate(command: CreatePurchaseOrderCommand): void {
  const reasons: ReasonInput[] = [];
  if (command.supplierId.trim() === "") reasons.push({ ar: "المورد مطلوب", en: "A supplier is required" });
  if (command.warehouseId.trim() === "") reasons.push({ ar: "المستودع مطلوب", en: "A warehouse is required" });
  if (command.branchId.trim() === "") reasons.push({ ar: "الفرع مطلوب", en: "A branch is required" });
  if (command.date.trim() === "") reasons.push({ ar: "التاريخ مطلوب", en: "A date is required" });
  if (command.lines.length === 0) reasons.push({ ar: "يلزم بند واحد على الأقل", en: "At least one line is required" });
  command.lines.forEach((line, i) => {
    if (line.itemId.trim() === "") reasons.push({ ar: `البند ${i + 1}: الصنف مطلوب`, en: `Line ${i + 1}: an item is required.` });
    if (line.qty.isZero() || line.qty.isNegative()) reasons.push({ ar: `البند ${i + 1}: الكمية يجب أن تكون موجبة`, en: `Line ${i + 1}: the quantity must be greater than zero.` });
    if (line.unitPrice.scaled < 0n) reasons.push({ ar: `البند ${i + 1}: سعر الوحدة لا يجوز أن يكون سالباً`, en: `Line ${i + 1}: the unit price cannot be negative.` });
  });
  if (reasons.length > 0) throw new InvalidPurchaseDocumentError(reasons);
}

/**
 * Create a مسودة (draft) purchase order: validate, allocate the next PO number,
 * persist. Lines start with zero received quantity.
 */
export async function createPurchaseOrder(
  command: CreatePurchaseOrderCommand,
  deps: PurchaseOrderDeps,
): Promise<PurchaseOrder> {
  validate(command);
  const number = await deps.numbering.next(PURCHASE_ORDER_SEQUENCE);
  const order: PurchaseOrder = {
    id: command.id,
    number: number.formatted,
    supplierId: command.supplierId,
    date: command.date,
    expectedDeliveryDate: command.expectedDeliveryDate ?? null,
    branchId: command.branchId,
    warehouseId: command.warehouseId,
    currency: command.currency ?? "EGP",
    notes: command.notes ?? null,
    lines: command.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description ?? null,
      qty: l.qty,
      unitPrice: l.unitPrice,
      receivedQty: Qty.zero(),
    })),
    status: "draft",
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
  };
  await deps.orders.create(order);
  return order;
}

/**
 * تأكيد وإرسال (Confirm & Send): مسودة → مرسل. Gateable action
 * PURCHASE_ORDER_CONFIRM is enforced by the workflow gate at the edge; the
 * domain only performs the transition.
 */
export async function confirmPurchaseOrder(
  id: string,
  deps: ConfirmPurchaseOrderDeps,
): Promise<PurchaseOrder> {
  const order = await deps.orders.findById(id);
  if (!order) throw new PurchaseOrderNotFoundError(id);
  if (order.status !== "draft") {
    throw new InvalidPurchaseDocumentError([
      {
        ar: `لا يمكن إرسال أمر الشراء ${order.number}؛ المسودة وحدها يمكن إرسالها.`,
        en: `Purchase order ${order.number} cannot be sent; only a draft can be sent.`,
      },
    ]);
  }
  const sent: PurchaseOrder = { ...order, status: "sent" };
  return atomically(deps, async () => {
    await deps.orders.update(sent);
    await recordPurchaseAudit(deps, "PURCHASE_ORDER", "CONFIRM", {
      orderId: sent.id,
      number: sent.number,
      supplierId: sent.supplierId,
      status: sent.status,
      total: purchaseOrderTotal(sent).toString(),
    }, sent.id);
    return sent;
  });
}

/** إلغاء (Cancel): a draft or sent order → ملغي. */
export async function cancelPurchaseOrder(
  id: string,
  deps: CancelPurchaseOrderDeps,
): Promise<PurchaseOrder> {
  const order = await deps.orders.findById(id);
  if (!order) throw new PurchaseOrderNotFoundError(id);
  if (order.status === "fully_received" || order.status === "cancelled") {
    throw new InvalidPurchaseDocumentError([
      {
        ar: `لا يمكن إلغاء أمر الشراء ${order.number} لأنه مستلم بالكامل أو ملغى بالفعل.`,
        en: `Purchase order ${order.number} cannot be cancelled because it is already fully received or cancelled.`,
      },
    ]);
  }
  const cancelled: PurchaseOrder = { ...order, status: "cancelled" };
  return atomically(deps, async () => {
    await deps.orders.update(cancelled);
    await recordPurchaseAudit(deps, "PURCHASE_ORDER", "CANCEL", {
      orderId: cancelled.id,
      number: cancelled.number,
      supplierId: cancelled.supplierId,
      status: cancelled.status,
      previousStatus: order.status,
    }, cancelled.id);
    return cancelled;
  });
}

/** INVARIANT: an over-receipt's excess lands on the item's last line; `revertReceiptFromOrder` walks lines in reverse so a cancel takes it back from there. */
export function applyReceiptToOrder(
  order: PurchaseOrder,
  received: readonly { itemId: string; qty: Qty }[],
): PurchaseOrder {
  const remainingByItem = new Map<string, Qty>();
  for (const r of received) {
    remainingByItem.set(r.itemId, (remainingByItem.get(r.itemId) ?? Qty.zero()).add(r.qty));
  }
  const lastLineOfItem = new Map<string, number>();
  order.lines.forEach((line, index) => lastLineOfItem.set(line.itemId, index));
  const lines = order.lines.map((line, index) => {
    const remaining = remainingByItem.get(line.itemId);
    if (!remaining || remaining.isZero() || remaining.isNegative()) return line;
    const outstanding = lineOutstandingQty(line);
    const take = lastLineOfItem.get(line.itemId) === index || remaining.compare(outstanding) <= 0 ? remaining : outstanding;
    remainingByItem.set(line.itemId, remaining.subtract(take));
    return { ...line, receivedQty: line.receivedQty.add(take) };
  });
  return { ...order, lines, status: deriveReceivedStatus(lines) };
}

/**
 * Undo `applyReceiptToOrder` (used when a goods receipt is cancelled): subtracts
 * the reversed quantities back off each line's `receivedQty`, capped so it never
 * goes negative, and re-derives the status — but ONLY when the order's status
 * was itself receiving-driven ("partially_received"/"fully_received"); a
 * "cancelled" order (cancelled independently of receiving) is left untouched.
 */
export function revertReceiptFromOrder(
  order: PurchaseOrder,
  received: readonly { itemId: string; qty: Qty }[],
): PurchaseOrder {
  const remainingByItem = new Map<string, Qty>();
  for (const r of received) {
    remainingByItem.set(r.itemId, (remainingByItem.get(r.itemId) ?? Qty.zero()).add(r.qty));
  }
  const lines = [...order.lines].reverse().map((line) => {
    const remaining = remainingByItem.get(line.itemId);
    if (!remaining || remaining.isZero() || remaining.isNegative()) return line;
    const take = remaining.compare(line.receivedQty) <= 0 ? remaining : line.receivedQty;
    remainingByItem.set(line.itemId, remaining.subtract(take));
    return { ...line, receivedQty: line.receivedQty.subtract(take) };
  }).reverse();
  const status =
    order.status === "partially_received" || order.status === "fully_received"
      ? deriveReceivedStatus(lines)
      : order.status;
  return { ...order, lines, status };
}
