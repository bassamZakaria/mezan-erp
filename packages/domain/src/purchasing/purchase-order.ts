/**
 * أمر الشراء (Purchase Order) — the first document in the purchase chain
 * (docs/catalog/02 §Purchase Orders). A PO carries no stock or GL effect; it is
 * numbering + workflow only: مسودة (draft) → مرسل (sent) → مستلم جزئياً /
 * مستلم بالكامل (partially / fully received) as goods receipts confirm against
 * it, with ملغي (cancelled) as the cancel path.
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/index.js";
import { NextNumberService } from "../numbering/index.js";
import type { PurchaseOrderStatus } from "./types.js";
import {
  DuplicatePurchaseDocumentError,
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

/** Persistence port. The domain depends on this interface only (docs/plan.md §2.2). */
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

export interface PurchaseOrderDeps {
  readonly orders: PurchaseOrderRepository;
  readonly numbering: NextNumberService;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
}

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
function deriveReceivedStatus(lines: readonly PurchaseOrderLine[]): PurchaseOrderStatus {
  const anyReceived = lines.some((l) => !l.receivedQty.isZero());
  const allReceived = lines.every((l) => lineOutstandingQty(l).isZero());
  if (allReceived) return "fully_received";
  if (anyReceived) return "partially_received";
  return "sent";
}

function validate(command: CreatePurchaseOrderCommand): void {
  const reasons: string[] = [];
  if (command.supplierId.trim() === "") reasons.push("a supplier is required");
  if (command.warehouseId.trim() === "") reasons.push("a warehouse is required");
  if (command.branchId.trim() === "") reasons.push("a branch is required");
  if (command.date.trim() === "") reasons.push("a date is required");
  if (command.lines.length === 0) reasons.push("at least one line is required");
  command.lines.forEach((line, i) => {
    if (line.itemId.trim() === "") reasons.push(`line ${i}: an item is required`);
    if (line.qty.isZero() || line.qty.isNegative()) reasons.push(`line ${i}: qty must be positive`);
    if (line.unitPrice.scaled < 0n) reasons.push(`line ${i}: unit price must not be negative`);
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
  if (await deps.orders.findById(command.id)) {
    throw new DuplicatePurchaseDocumentError(command.id);
  }
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
  deps: Pick<PurchaseOrderDeps, "orders">,
): Promise<PurchaseOrder> {
  const order = await deps.orders.findById(id);
  if (!order) throw new PurchaseOrderNotFoundError(id);
  if (order.status !== "draft") {
    throw new InvalidPurchaseDocumentError([
      `purchase order "${id}" is "${order.status}"; only a draft can be sent`,
    ]);
  }
  const sent: PurchaseOrder = { ...order, status: "sent" };
  await deps.orders.update(sent);
  return sent;
}

/** إلغاء (Cancel): a draft or sent order → ملغي. */
export async function cancelPurchaseOrder(
  id: string,
  deps: Pick<PurchaseOrderDeps, "orders">,
): Promise<PurchaseOrder> {
  const order = await deps.orders.findById(id);
  if (!order) throw new PurchaseOrderNotFoundError(id);
  if (order.status === "fully_received" || order.status === "cancelled") {
    throw new InvalidPurchaseDocumentError([
      `purchase order "${id}" is "${order.status}" and cannot be cancelled`,
    ]);
  }
  const cancelled: PurchaseOrder = { ...order, status: "cancelled" };
  await deps.orders.update(cancelled);
  return cancelled;
}

/**
 * Apply received quantities to a PO (pure). Distributes each item's received qty
 * across that item's lines in order, capping at each line's ordered qty, then
 * recomputes the status (partially/fully received). Used by goods-receipt
 * confirmation.
 */
export function applyReceiptToOrder(
  order: PurchaseOrder,
  received: readonly { itemId: string; qty: Qty }[],
): PurchaseOrder {
  const remainingByItem = new Map<string, Qty>();
  for (const r of received) {
    remainingByItem.set(r.itemId, (remainingByItem.get(r.itemId) ?? Qty.zero()).add(r.qty));
  }
  const lines = order.lines.map((line) => {
    const remaining = remainingByItem.get(line.itemId);
    if (!remaining || remaining.isZero() || remaining.isNegative()) return line;
    const outstanding = lineOutstandingQty(line);
    const take = remaining.compare(outstanding) <= 0 ? remaining : outstanding;
    remainingByItem.set(line.itemId, remaining.subtract(take));
    return { ...line, receivedQty: line.receivedQty.add(take) };
  });
  return { ...order, lines, status: deriveReceivedStatus(lines) };
}
