/**
 * إيصال الاستلام (Goods Receipt) — records physical receipt of goods against a
 * confirmed purchase order (docs/archive/catalog/02 §Goods Receipts). مسودة (draft) →
 * مؤكد (confirmed). On confirmation it posts stock IN through the shared
 * costing/stock-ledger engine (raising on-hand and the weighted-average cost)
 * BEFORE any payable — tax and the payable are recognised later on the matching
 * purchase invoice. A receipt is always created FROM a PO and its lines are
 * auto-filled from the PO's outstanding quantities.
 */

import { Money, Qty } from "../money/index.js";
import { extend, occurredAtFromDocumentDate, type CostLayer, type CostLayerRepository } from "../inventory/index.js";
import { NextNumberService } from "../numbering/index.js";
import { JournalEntryNotFoundError, ReversalDateBeforeOriginalError } from "../gl/errors.js";
import type { CostCategory } from "../contracting/cost-category.js";
import {
  applyReceiptToOrder,
  revertReceiptFromOrder,
  lineOutstandingQty,
  type PurchaseOrder,
  type PurchaseOrderRepository,
} from "./purchase-order.js";
import { LandedCostStandsOnDocumentError } from "../landed-costs/errors.js";
import { atomically, recordPurchaseAudit, type PurchaseAuditDeps } from "./audit.js";
import {
  DEFAULT_PURCHASE_POLICY,
  type GoodsReceiptStatus,
  type PurchasePolicy,
  type PurchaseStockPostingPort,
  type PurchaseGlAccounts,
  type PurchaseGlPosting,
  type PurchaseGlPostingPort,
  type PurchaseGlReversalPort,
} from "./types.js";
import {
  DuplicatePurchaseDocumentError,
  GoodsReceiptAlreadyInvoicedError,
  GoodsReceiptNotFoundError,
  InvalidPurchaseDocumentError,
  OverReceiptError,
  PurchaseDocumentNotDraftError,
  PurchaseItemsAlreadyConsumedError,
  PurchaseOrderNotFoundError,
  PurchaseOrderNotReceivableError,
  PurchaseOrderRequiredError,
} from "./errors.js";

const GOODS_RECEIPT_SEQUENCE = "GOODS_RECEIPT";

export interface GoodsReceiptLine {
  readonly itemId: string;
  readonly description: string | null;
  readonly qty: Qty;
  /** Receipt-time unit cost (defaults to the PO unit price when auto-filled). */
  readonly unitCost: Money;
  /** Supplier lot this delivery arrived under. Absent for non-tracked goods. */
  readonly batchNo?: string | null;
  /** ISO-8601 expiry of the received goods; drives FEFO consumption. Absent for non-perishables. */
  readonly expiryDate?: string | null;
  /** فئة التكلفة — only meaningful with the receipt's `projectId` (D-01). */
  readonly costCategory?: CostCategory | null;
}

export interface GoodsReceipt {
  readonly id: string;
  readonly number: string;
  /** Null for an ad-hoc (PO-less) receipt — only possible when `requirePoForGrn` is off. */
  readonly purchaseOrderId: string | null;
  readonly supplierId: string;
  readonly warehouseId: string;
  readonly date: string;
  readonly notes: string | null;
  /** بُعد المشروع — the contracting project this receipt's cost belongs to (D-01). */
  readonly projectId?: string | null;
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
  readonly batchNo?: string | null;
  readonly expiryDate?: string | null;
  readonly costCategory?: CostCategory | null;
}

export interface CreateGoodsReceiptCommand {
  readonly id: string;
  /** Omit for an ad-hoc (PO-less) receipt — only allowed when `requirePoForGrn` is off. */
  readonly purchaseOrderId?: string | null;
  readonly date: string;
  readonly notes?: string | null;
  /** بُعد المشروع — optional; a line `costCategory` without it is refused. */
  readonly projectId?: string | null;
  readonly createdBy?: string;
  /** Required for an ad-hoc receipt (no PO to source from); omit to auto-fill from the PO. */
  readonly lines?: readonly GoodsReceiptLineInput[];
  /** Required for an ad-hoc receipt; ignored (derived from the PO) otherwise. */
  readonly supplierId?: string;
  readonly warehouseId?: string;
}

export interface CreateGoodsReceiptDeps {
  readonly receipts: GoodsReceiptRepository;
  readonly orders: PurchaseOrderRepository;
  readonly numbering: NextNumberService;
  readonly policy?: PurchasePolicy;
  readonly now?: () => string;
  /**
   * Settings §"سياسة المخزون" → `autoGenerateBatchNumbers`. Returns the batch
   * number to stamp on a line the receiver left blank, or null to leave it
   * blank. The composition — not the domain — decides whether the tenant asked
   * for this and whether the item tracks batches at all.
   */
  readonly autoBatchNo?: (input: {
    itemId: string;
    receiptNumber: string;
    lineIndex: number;
  }) => Promise<string | null>;
}

export interface ConfirmGoodsReceiptDeps extends PurchaseAuditDeps {
  readonly receipts: GoodsReceiptRepository;
  readonly orders: PurchaseOrderRepository;
  readonly stock: PurchaseStockPostingPort;
  /** Both optional together: without them a receipt moves stock and posts nothing, which is what predates D53. */
  readonly gl?: PurchaseGlPostingPort;
  readonly accounts?: PurchaseGlAccounts;
  readonly now?: () => string;
}

export interface CancelGoodsReceiptDeps extends PurchaseAuditDeps {
  /** Numbers of the confirmed landed costs standing on a document; one that carries any is not cancelled under them. */
  readonly landedCostsStandingOn?: (documentId: string) => Promise<readonly string[]>;
  readonly receipts: GoodsReceiptRepository;
  readonly orders: PurchaseOrderRepository;
  readonly stock: PurchaseStockPostingPort;
  readonly layers: CostLayerRepository;
  readonly glReverse?: PurchaseGlReversalPort;
  readonly policy?: PurchasePolicy;
  readonly now?: () => string;
}

export function goodsReceiptCancelEntryId(receiptId: string): string {
  return `${receiptId}:cancel`;
}

/**
 * A layer that was fully issued is REMOVED from the store, so "no layer of this
 * document" means consumed, not untouched. Reading it as untouched let a cancel
 * credit GL 1200 for goods that had already left through cost of sales.
 */
export function receiptLayersConsumed(layers: readonly CostLayer[], sourceDocId: string): boolean {
  const mine = layers.filter((l) => l.sourceDocId === sourceDocId);
  return mine.length === 0 || mine.some((l) => l.remainingQty.compare(l.originalQty) !== 0);
}

export interface StockPosition {
  readonly itemId: string;
  readonly warehouseId: string;
}

// One document may carry the same item on several lines; its layers are found per position, so a repeated position must be visited once.
export function distinctPositions(positions: readonly StockPosition[]): StockPosition[] {
  const seen = new Set<string>();
  return positions.filter((p) => {
    const key = JSON.stringify([p.itemId, p.warehouseId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

async function stampBatchNumbers(
  lines: readonly GoodsReceiptLine[],
  receiptNumber: string,
  deps: CreateGoodsReceiptDeps,
): Promise<GoodsReceiptLine[]> {
  const out: GoodsReceiptLine[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    if (line.batchNo !== null || !deps.autoBatchNo) {
      out.push(line);
      continue;
    }
    const batchNo = await deps.autoBatchNo({ itemId: line.itemId, receiptNumber, lineIndex });
    out.push(batchNo ? { ...line, batchNo } : line);
  }
  return out;
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
 * auto-fill, docs/archive/catalog/02 §Goods Receipts). Unit cost defaults to the PO
 * unit price. Fully-received lines are skipped.
 */
export function buildReceiptLinesFromOrder(order: PurchaseOrder): GoodsReceiptLine[] {
  return order.lines
    .map((line) => ({
      itemId: line.itemId,
      description: line.description,
      qty: lineOutstandingQty(line),
      unitCost: line.unitPrice,
      batchNo: null,
      expiryDate: null,
      costCategory: null,
    }))
    .filter((line) => !line.qty.isZero());
}

function assertReceivable(order: PurchaseOrder): void {
  if (order.status !== "sent" && order.status !== "partially_received") {
    throw new PurchaseOrderNotReceivableError(order.id, order.status);
  }
}

/**
 * Create a مسودة (draft) goods receipt — normally against a confirmed PO
 * (lines taken from the command, or auto-filled from the PO's outstanding
 * quantities when omitted; with `blockOverReceipt` on, a line may not exceed
 * the PO outstanding), or — when `purchaseOrderId` is omitted and
 * `requirePoForGrn` is off — an AD-HOC receipt with explicit `supplierId`,
 * `warehouseId` and `lines` (no PO to auto-fill from).
 */
export async function createGoodsReceipt(
  command: CreateGoodsReceiptCommand,
  deps: CreateGoodsReceiptDeps,
): Promise<GoodsReceipt> {
  const policy = deps.policy ?? DEFAULT_PURCHASE_POLICY;
  if (await deps.receipts.findById(command.id)) {
    throw new DuplicatePurchaseDocumentError(command.id);
  }

  if (!command.purchaseOrderId) {
    if (policy.requirePoForGrn) throw new PurchaseOrderRequiredError();
    return createAdHocGoodsReceipt(command, deps);
  }

  const order = await deps.orders.findById(command.purchaseOrderId);
  if (!order) throw new PurchaseOrderNotFoundError(command.purchaseOrderId);
  assertReceivable(order);

  const lines: GoodsReceiptLine[] = (
    command.lines
      ? command.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description ?? null,
          qty: l.qty,
          unitCost: l.unitCost,
          batchNo: l.batchNo ?? null,
          expiryDate: l.expiryDate ?? null,
          costCategory: l.costCategory ?? null,
        }))
      : buildReceiptLinesFromOrder(order)
  );

  validateLines(lines, command.projectId ?? null);

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
    projectId: command.projectId ?? null,
    lines: await stampBatchNumbers(lines, number.formatted, deps),
    status: "draft",
    invoiced: false,
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
  };
  await deps.receipts.create(receipt);
  return receipt;
}

function validateLines(lines: readonly GoodsReceiptLine[], projectId: string | null = null): void {
  const reasons: string[] = [];
  if (lines.length === 0) reasons.push("at least one line is required");
  lines.forEach((line, i) => {
    if (line.itemId.trim() === "") reasons.push(`line ${i}: an item is required`);
    if (line.qty.isZero() || line.qty.isNegative()) reasons.push(`line ${i}: qty must be positive`);
    if (line.unitCost.scaled < 0n) reasons.push(`line ${i}: unit cost must not be negative`);
    if (line.costCategory && !projectId) {
      reasons.push(`line ${i}: costCategory requires the receipt's projectId`);
    }
  });
  if (reasons.length > 0) throw new InvalidPurchaseDocumentError(reasons);
}

/** Ad-hoc (PO-less) receipt: `requirePoForGrn` is off and no `purchaseOrderId` was supplied. */
async function createAdHocGoodsReceipt(
  command: CreateGoodsReceiptCommand,
  deps: CreateGoodsReceiptDeps,
): Promise<GoodsReceipt> {
  const reasons: string[] = [];
  if (!command.supplierId || command.supplierId.trim() === "") {
    reasons.push("a supplier is required for an ad-hoc (PO-less) receipt");
  }
  if (!command.warehouseId || command.warehouseId.trim() === "") {
    reasons.push("a warehouse is required for an ad-hoc (PO-less) receipt");
  }
  if (!command.lines || command.lines.length === 0) {
    reasons.push("lines are required for an ad-hoc (PO-less) receipt");
  }
  if (reasons.length > 0) throw new InvalidPurchaseDocumentError(reasons);

  const lines: GoodsReceiptLine[] = (command.lines as readonly GoodsReceiptLineInput[]).map((l) => ({
    itemId: l.itemId,
    description: l.description ?? null,
    qty: l.qty,
    unitCost: l.unitCost,
    batchNo: l.batchNo ?? null,
    expiryDate: l.expiryDate ?? null,
    costCategory: l.costCategory ?? null,
  }));
  validateLines(lines, command.projectId ?? null);

  const number = await deps.numbering.next(GOODS_RECEIPT_SEQUENCE);
  const receipt: GoodsReceipt = {
    id: command.id,
    number: number.formatted,
    purchaseOrderId: null,
    supplierId: command.supplierId as string,
    warehouseId: command.warehouseId as string,
    date: command.date,
    notes: command.notes ?? null,
    projectId: command.projectId ?? null,
    lines: await stampBatchNumbers(lines, number.formatted, deps),
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
/**
 * Dr المخزون / Cr بضاعة واردة لم تُفوتر for what the receipt brought in (D53).
 *
 * Receiving goods makes them the buyer's asset and creates the obligation to
 * pay for them; both halves belong on the books from that moment. The purchase
 * invoice later clears the GRNI credit against the real payable, so inventory
 * is debited exactly once, by whichever document actually moved the stock.
 */
export function buildGoodsReceiptPosting(
  receipt: GoodsReceipt,
  accounts: { readonly inventoryAccountId: string; readonly goodsReceivedNotInvoicedAccountId: string },
): PurchaseGlPosting {
  const value = Money.sum(receipt.lines.map((l) => extend(l.qty, l.unitCost)));
  // Split the inventory debit by cost category (never the GRNI credit — that
  // is the liability side, like AP), so a receipt mixing categories still
  // posts one tagged line per category rather than losing the split (D-01).
  const byCategory = new Map<CostCategory | null, Money>();
  for (const l of receipt.lines) {
    const key = l.costCategory ?? null;
    const amount = extend(l.qty, l.unitCost);
    byCategory.set(key, (byCategory.get(key) ?? Money.zero()).add(amount));
  }
  const projectId = receipt.projectId ?? null;
  const debitLines = [...byCategory.entries()]
    .filter(([, amount]) => amount.scaled !== 0n)
    .map(([costCategory, amount]) => ({
      accountId: accounts.inventoryAccountId,
      debit: amount,
      credit: Money.zero(),
      projectId,
      ...(costCategory ? { costCategory } : {}),
    }));
  return {
    sourceDocType: "PURCHASE_RECEIPT",
    sourceDocId: receipt.id,
    sourceDocNumber: receipt.number,
    date: receipt.date,
    memo: `إذن استلام ${receipt.number}`,
    lines: [
      ...debitLines,
      { accountId: accounts.goodsReceivedNotInvoicedAccountId, debit: Money.zero(), credit: value, projectId },
    ],
  };
}

export async function confirmGoodsReceipt(
  id: string,
  deps: ConfirmGoodsReceiptDeps,
): Promise<GoodsReceipt> {
  const receipt = await deps.receipts.findById(id);
  if (!receipt) throw new GoodsReceiptNotFoundError(id);
  if (receipt.status !== "draft") {
    throw new PurchaseDocumentNotDraftError(id, receipt.status);
  }

  return atomically(deps, async () => {
  await deps.stock.postReceipt({
    receiptId: receipt.id,
    receiptNumber: receipt.number,
    warehouseId: receipt.warehouseId,
    sourceDocType: "PURCHASE_RECEIPT",
    lines: receipt.lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      unitCost: l.unitCost,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
    })),
    occurredAt: occurredAtFromDocumentDate(receipt.date),
  });

  // Stock first here, unlike the invoice: a receipt's movement is always an IN,
  // which no stock policy refuses, and the GL entry is what must not be left
  // behind if something later fails.
  if (deps.gl && deps.accounts?.goodsReceivedNotInvoicedAccountId) {
    await deps.gl.post(
      buildGoodsReceiptPosting(receipt, {
        inventoryAccountId: deps.accounts.inventoryAccountId,
        goodsReceivedNotInvoicedAccountId: deps.accounts.goodsReceivedNotInvoicedAccountId,
      }),
    );
  }

  if (receipt.purchaseOrderId) {
    const order = await deps.orders.findById(receipt.purchaseOrderId);
    if (!order) throw new PurchaseOrderNotFoundError(receipt.purchaseOrderId);
    const updatedOrder = applyReceiptToOrder(
      order,
      receipt.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    );
    await deps.orders.update(updatedOrder);
  }

  const confirmed: GoodsReceipt = { ...receipt, status: "confirmed" };
  await deps.receipts.update(confirmed);
  await recordPurchaseAudit(deps, "GOODS_RECEIPT", "CONFIRM", {
    receiptId: confirmed.id,
    number: confirmed.number,
    supplierId: confirmed.supplierId,
    purchaseOrderId: confirmed.purchaseOrderId,
    warehouseId: confirmed.warehouseId,
    status: confirmed.status,
    totalCost: goodsReceiptTotalCost(confirmed).toString(),
  }, confirmed.id);
  return confirmed;
  });
}

/**
 * إلغاء (Cancel) a goods receipt (docs/archive/catalog/09 §"تتبع البضاعة المستهلكة").
 * A draft receipt (no stock/PO effect yet) cancels trivially. A confirmed
 * receipt may only be cancelled if (a) it has not yet been invoiced, and (b)
 * — when `trackSoldPurchaseItems` is on — none of the stock it brought in has
 * since been drawn down (sold/transferred/consumed): reverses the stock IN and
 * rolls the received quantities back off the linked PO (if any).
 */
export async function cancelGoodsReceipt(
  id: string,
  deps: CancelGoodsReceiptDeps,
  options: { readonly date?: string } = {},
): Promise<GoodsReceipt> {
  const policy = deps.policy ?? DEFAULT_PURCHASE_POLICY;
  const receipt = await deps.receipts.findById(id);
  if (!receipt) throw new GoodsReceiptNotFoundError(id);
  if (receipt.status === "cancelled") {
    throw new PurchaseDocumentNotDraftError(id, receipt.status);
  }
  if (receipt.invoiced) throw new GoodsReceiptAlreadyInvoicedError(id);
  if (options.date !== undefined && options.date < receipt.date) {
    throw new ReversalDateBeforeOriginalError(id, options.date, receipt.date);
  }
  const today = (deps.now?.() ?? new Date().toISOString()).slice(0, 10);
  const cancelDate = options.date ?? (today < receipt.date ? receipt.date : today);

  if (receipt.status === "confirmed") {
    const standing = (await deps.landedCostsStandingOn?.(receipt.id)) ?? [];
    if (standing.length > 0) throw new LandedCostStandsOnDocumentError(receipt.id, standing);
  }

  return atomically(deps, async () => {
  if (receipt.status === "confirmed") {
    const positions = distinctPositions(receipt.lines.map((l) => ({ itemId: l.itemId, warehouseId: receipt.warehouseId })));
    if (policy.trackSoldPurchaseItems) {
      for (const position of positions) {
        const layers = await deps.layers.listByPosition(position.itemId, position.warehouseId);
        if (receiptLayersConsumed(layers, receipt.id)) throw new PurchaseItemsAlreadyConsumedError(id);
      }
    }

    await deps.stock.reverseReceipt({
      reversalId: goodsReceiptCancelEntryId(receipt.id),
      sourceDocType: "PURCHASE_RECEIPT",
      sourceDocId: receipt.id,
      positions,
      // The day the GL reversal is dated, so stock and GL 1200 leave together.
      occurredAt: occurredAtFromDocumentDate(cancelDate),
    });

    try {
      await deps.glReverse?.reverse(receipt.id, {
        reversalId: goodsReceiptCancelEntryId(receipt.id),
        date: cancelDate,
        memo: `عكس إذن استلام ${receipt.number}`,
      });
    } catch (err) {
      // A receipt confirmed while no accrual account was configured posted no entry: there is nothing to reverse.
      if (!(err instanceof JournalEntryNotFoundError)) throw err;
    }

    if (receipt.purchaseOrderId) {
      const order = await deps.orders.findById(receipt.purchaseOrderId);
      if (order) {
        const reverted = revertReceiptFromOrder(
          order,
          receipt.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        );
        await deps.orders.update(reverted);
      }
    }
  }

  const cancelled: GoodsReceipt = { ...receipt, status: "cancelled" };
  await deps.receipts.update(cancelled);
  await recordPurchaseAudit(deps, "GOODS_RECEIPT", "CANCEL", {
    receiptId: cancelled.id,
    number: cancelled.number,
    supplierId: cancelled.supplierId,
    purchaseOrderId: cancelled.purchaseOrderId,
    warehouseId: cancelled.warehouseId,
    status: cancelled.status,
    previousStatus: receipt.status,
  }, cancelled.id);
  return cancelled;
  });
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

export async function releaseGoodsReceiptFromInvoice(
  id: string,
  deps: Pick<ConfirmGoodsReceiptDeps, "receipts">,
): Promise<void> {
  const receipt = await deps.receipts.findById(id);
  if (!receipt?.invoiced) return;
  await deps.receipts.update({ ...receipt, invoiced: false });
}
