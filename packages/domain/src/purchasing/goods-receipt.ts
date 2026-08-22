/**
 * إيصال الاستلام (Goods Receipt) — records physical receipt of goods against a
 * confirmed purchase order (docs/catalog/02 §Goods Receipts). مسودة (draft) →
 * مؤكد (confirmed). On confirmation it posts stock IN through the shared
 * costing/stock-ledger engine (raising on-hand and the weighted-average cost)
 * BEFORE any payable — tax and the payable are recognised later on the matching
 * purchase invoice. A receipt is always created FROM a PO and its lines are
 * auto-filled from the PO's outstanding quantities.
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/index.js";
import { NextNumberService } from "../numbering/index.js";
import {
  applyReceiptToOrder,
  lineOutstandingQty,
  type PurchaseOrder,
  type PurchaseOrderRepository,
} from "./purchase-order.js";
import {
  DEFAULT_PURCHASE_POLICY,
  type GoodsReceiptStatus,
  type PurchasePolicy,
  type PurchaseStockPostingPort,
} from "./types.js";
import {
  DuplicatePurchaseDocumentError,
  GoodsReceiptNotFoundError,
  InvalidPurchaseDocumentError,
  OverReceiptError,
  PurchaseDocumentNotDraftError,
  PurchaseOrderNotFoundError,
  PurchaseOrderNotReceivableError,
} from "./errors.js";

const GOODS_RECEIPT_SEQUENCE = "GOODS_RECEIPT";

export interface GoodsReceiptLine {
  readonly itemId: string;
  readonly description: string | null;
  readonly qty: Qty;
  /** Receipt-time unit cost (defaults to the PO unit price when auto-filled). */
  readonly unitCost: Money;
}

export interface GoodsReceipt {
  readonly id: string;
  readonly number: string;
  readonly purchaseOrderId: string;
  readonly supplierId: string;
  readonly warehouseId: string;
  readonly date: string;
  readonly notes: string | null;
  readonly lines: readonly GoodsReceiptLine[];
  readonly status: GoodsReceiptStatus;
  /** True once a purchase invoice has been booked against this receipt. */
  readonly invoiced: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface GoodsReceiptRepository {
  findById(id: string): Promise<GoodsReceipt | null>;
  list(): Promise<GoodsReceipt[]>;
  listByOrder(purchaseOrderId: string): Promise<GoodsReceipt[]>;
  create(receipt: GoodsReceipt): Promise<void>;
  update(receipt: GoodsReceipt): Promise<void>;
}

export interface GoodsReceiptLineInput {
  readonly itemId: string;
  readonly description?: string | null;
  readonly qty: Qty;
  readonly unitCost: Money;
}

export interface CreateGoodsReceiptCommand {
  readonly id: string;
  readonly purchaseOrderId: string;
  readonly date: string;
  readonly notes?: string | null;
  readonly createdBy?: string;
  /** Omit to auto-fill from the PO's outstanding quantities (create-from-PO). */
  readonly lines?: readonly GoodsReceiptLineInput[];
}

export interface CreateGoodsReceiptDeps {
  readonly receipts: GoodsReceiptRepository;
  readonly orders: PurchaseOrderRepository;
  readonly numbering: NextNumberService;
  readonly policy?: PurchasePolicy;
  readonly now?: () => string;
}

export interface ConfirmGoodsReceiptDeps {
  readonly receipts: GoodsReceiptRepository;
  readonly orders: PurchaseOrderRepository;
  readonly stock: PurchaseStockPostingPort;
  readonly now?: () => string;
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

// --- pure computations ------------------------------------------------------

/** Total cost of a receipt: Σ (qty × unit cost). */
export function goodsReceiptTotalCost(receipt: {
  readonly lines: readonly { qty: Qty; unitCost: Money }[];
}): Money {
  return Money.sum(receipt.lines.map((l) => extend(l.qty, l.unitCost)));
}

/**
 * Build draft receipt lines from a PO's outstanding quantities (create-from-PO
 * auto-fill, docs/catalog/02 §Goods Receipts). Unit cost defaults to the PO
 * unit price. Fully-received lines are skipped.
 */
export function buildReceiptLinesFromOrder(order: PurchaseOrder): GoodsReceiptLine[] {
  return order.lines
    .map((line) => ({
      itemId: line.itemId,
      description: line.description,
      qty: lineOutstandingQty(line),
      unitCost: line.unitPrice,
    }))
    .filter((line) => !line.qty.isZero());
}

function assertReceivable(order: PurchaseOrder): void {
  if (order.status !== "sent" && order.status !== "partially_received") {
    throw new PurchaseOrderNotReceivableError(order.id, order.status);
  }
}

/**
 * Create a مسودة (draft) goods receipt against a confirmed PO. Lines are taken
 * from the command, or auto-filled from the PO's outstanding quantities when
 * omitted. With `blockOverReceipt` on, a line may not exceed the PO outstanding.
 */
export async function createGoodsReceipt(
  command: CreateGoodsReceiptCommand,
  deps: CreateGoodsReceiptDeps,
): Promise<GoodsReceipt> {
  const policy = deps.policy ?? DEFAULT_PURCHASE_POLICY;
  const order = await deps.orders.findById(command.purchaseOrderId);
  if (!order) throw new PurchaseOrderNotFoundError(command.purchaseOrderId);
  assertReceivable(order);
  if (await deps.receipts.findById(command.id)) {
    throw new DuplicatePurchaseDocumentError(command.id);
  }

  const lines: GoodsReceiptLine[] = (
    command.lines
      ? command.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description ?? null,
          qty: l.qty,
          unitCost: l.unitCost,
        }))
      : buildReceiptLinesFromOrder(order)
  );

  const reasons: string[] = [];
  if (lines.length === 0) reasons.push("at least one line is required");
  lines.forEach((line, i) => {
    if (line.itemId.trim() === "") reasons.push(`line ${i}: an item is required`);
    if (line.qty.isZero() || line.qty.isNegative()) reasons.push(`line ${i}: qty must be positive`);
    if (line.unitCost.scaled < 0n) reasons.push(`line ${i}: unit cost must not be negative`);
  });
  if (reasons.length > 0) throw new InvalidPurchaseDocumentError(reasons);

  if (policy.blockOverReceipt) {
    const outstanding = new Map<string, Qty>();
    for (const l of order.lines) {
      outstanding.set(l.itemId, (outstanding.get(l.itemId) ?? Qty.zero()).add(lineOutstandingQty(l)));
    }
    const wanted = new Map<string, Qty>();
    for (const l of lines) {
      wanted.set(l.itemId, (wanted.get(l.itemId) ?? Qty.zero()).add(l.qty));
    }
    for (const [itemId, qty] of wanted) {
      const avail = outstanding.get(itemId) ?? Qty.zero();
      if (qty.compare(avail) > 0) throw new OverReceiptError(itemId);
    }
  }

  const number = await deps.numbering.next(GOODS_RECEIPT_SEQUENCE);
  const receipt: GoodsReceipt = {
    id: command.id,
    number: number.formatted,
    purchaseOrderId: order.id,
    supplierId: order.supplierId,
    warehouseId: order.warehouseId,
    date: command.date,
    notes: command.notes ?? null,
    lines,
    status: "draft",
    invoiced: false,
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
  };
  await deps.receipts.create(receipt);
  return receipt;
}

/**
 * تأكيد (Confirm): مسودة → مؤكد. Posts stock IN through the costing/stock-ledger
 * engine (sourceDocType PURCHASE_RECEIPT) — no GL entry — then rolls the received
 * quantities into the PO (advancing it to partially/fully received). Gateable
 * action PURCHASE_RECEIPT_CONFIRM is enforced by the workflow gate at the edge.
 */
export async function confirmGoodsReceipt(
  id: string,
  deps: ConfirmGoodsReceiptDeps,
): Promise<GoodsReceipt> {
  const receipt = await deps.receipts.findById(id);
  if (!receipt) throw new GoodsReceiptNotFoundError(id);
  if (receipt.status !== "draft") {
    throw new PurchaseDocumentNotDraftError(id, receipt.status);
  }
  const order = await deps.orders.findById(receipt.purchaseOrderId);
  if (!order) throw new PurchaseOrderNotFoundError(receipt.purchaseOrderId);

  await deps.stock.postReceipt({
    receiptId: receipt.id,
    receiptNumber: receipt.number,
    warehouseId: receipt.warehouseId,
    sourceDocType: "PURCHASE_RECEIPT",
    lines: receipt.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost })),
    occurredAt: nowIso(deps),
  });

  const updatedOrder = applyReceiptToOrder(
    order,
    receipt.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
  );
  await deps.orders.update(updatedOrder);

  const confirmed: GoodsReceipt = { ...receipt, status: "confirmed" };
  await deps.receipts.update(confirmed);
  return confirmed;
}

/** Mark a receipt as invoiced (called when a purchase invoice confirms against it). */
export async function markGoodsReceiptInvoiced(
  id: string,
  deps: Pick<ConfirmGoodsReceiptDeps, "receipts">,
): Promise<void> {
  const receipt = await deps.receipts.findById(id);
  if (!receipt) throw new GoodsReceiptNotFoundError(id);
  if (receipt.invoiced) return;
  await deps.receipts.update({ ...receipt, invoiced: true });
}
