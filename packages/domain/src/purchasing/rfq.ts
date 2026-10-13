/**
 * طلب عرض سعر (RFQ / Purchase Quote Request) — docs/archive/catalog/02 §"طلبات عروض
 * الأسعار": مسودة → مرسل → مغلق, with ملغي as a cancel path. The pre-PO
 * document: capture the items needed, collect supplier quotes against it,
 * compare them, then convert the chosen quote into a Purchase Order — the
 * "compare supplier quotes → generate a PO" flow (docs/archive/catalog/02).
 *
 * Carries no stock or GL effect of its own (mirrors the PO: numbering +
 * workflow only) — pure domain, ports only (docs/archive/plan.md §3.2).
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/index.js";
import { NextNumberService } from "../numbering/index.js";
import {
  createPurchaseOrder,
  type CreatePurchaseOrderCommand,
  type PurchaseOrder,
  type PurchaseOrderDeps,
} from "./purchase-order.js";
import {
  InvalidRfqError,
  RfqNotDraftError,
  RfqNotFoundError,
  RfqNotOpenError,
  RfqNotSentError,
  RfqQuoteNotFoundError,
} from "./errors.js";

const PURCHASE_RFQ_SEQUENCE = "PURCHASE_RFQ";

export type PurchaseRfqStatus = "draft" | "sent" | "closed" | "cancelled";

export interface PurchaseRfqLine {
  readonly itemId: string;
  readonly description: string | null;
  readonly qty: Qty;
  readonly notes: string | null;
}

export interface PurchaseRfq {
  readonly id: string;
  /** Sequential document number ("RFQ-000001"), assigned at creation. */
  readonly number: string;
  readonly date: string;
  readonly requiredByDate: string | null;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly notes: string | null;
  readonly lines: readonly PurchaseRfqLine[];
  readonly status: PurchaseRfqStatus;
  /** Set once a quote is converted into a PO (that action also closes the RFQ). */
  readonly purchaseOrderId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Persistence port. */
export interface PurchaseRfqRepository {
  findById(id: string): Promise<PurchaseRfq | null>;
  list(): Promise<PurchaseRfq[]>;
  create(rfq: PurchaseRfq): Promise<void>;
  update(rfq: PurchaseRfq): Promise<void>;
}

export interface RfqQuoteLine {
  readonly itemId: string;
  readonly unitPrice: Money;
  readonly notes: string | null;
}

/** One supplier's price quote against a sent RFQ (العروض). */
export interface RfqQuote {
  readonly id: string;
  readonly rfqId: string;
  readonly supplierId: string;
  readonly lines: readonly RfqQuoteLine[];
  readonly notes: string | null;
  readonly submittedAt: string;
}

export interface RfqQuoteRepository {
  findById(id: string): Promise<RfqQuote | null>;
  listByRfq(rfqId: string): Promise<RfqQuote[]>;
  create(quote: RfqQuote): Promise<void>;
}

export interface CreateRfqLineInput {
  readonly itemId: string;
  readonly description?: string | null;
  readonly qty: Qty;
  readonly notes?: string | null;
}

export interface CreateRfqCommand {
  readonly id: string;
  readonly date: string;
  readonly requiredByDate?: string | null;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly notes?: string | null;
  readonly createdBy?: string;
  readonly lines: readonly CreateRfqLineInput[];
}

export interface RfqQuoteLineInput {
  readonly itemId: string;
  readonly unitPrice: Money;
  readonly notes?: string | null;
}

export interface RecordRfqQuoteCommand {
  readonly id: string;
  readonly rfqId: string;
  readonly supplierId: string;
  readonly lines: readonly RfqQuoteLineInput[];
  readonly notes?: string | null;
}

export interface ConvertRfqCommand {
  readonly rfqId: string;
  readonly purchaseOrderId: string;
  readonly supplierId: string;
  readonly expectedDeliveryDate?: string | null;
  readonly createdBy?: string;
}

export interface RfqDeps {
  readonly rfqs: PurchaseRfqRepository;
  readonly numbering: NextNumberService;
  readonly now?: () => string;
}

export interface RfqQuoteDeps {
  readonly rfqs: PurchaseRfqRepository;
  readonly quotes: RfqQuoteRepository;
  readonly now?: () => string;
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

function validateCreate(command: CreateRfqCommand): void {
  const reasons: string[] = [];
  if (command.branchId.trim() === "") reasons.push("a branch is required");
  if (command.warehouseId.trim() === "") reasons.push("a warehouse is required");
  if (command.date.trim() === "") reasons.push("a date is required");
  if (command.lines.length === 0) reasons.push("at least one line is required");
  command.lines.forEach((line, i) => {
    if (line.itemId.trim() === "") reasons.push(`line ${i}: an item is required`);
    if (line.qty.isZero() || line.qty.isNegative()) reasons.push(`line ${i}: qty must be positive`);
  });
  if (reasons.length > 0) throw new InvalidRfqError(reasons);
}

/** Create a مسودة (draft) RFQ: validate, allocate the next RFQ number, persist. */
export async function createRfq(command: CreateRfqCommand, deps: RfqDeps): Promise<PurchaseRfq> {
  validateCreate(command);
  const number = await deps.numbering.next(PURCHASE_RFQ_SEQUENCE);
  const rfq: PurchaseRfq = {
    id: command.id,
    number: number.formatted,
    date: command.date,
    requiredByDate: command.requiredByDate ?? null,
    branchId: command.branchId,
    warehouseId: command.warehouseId,
    notes: command.notes ?? null,
    lines: command.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description ?? null,
      qty: l.qty,
      notes: l.notes ?? null,
    })),
    status: "draft",
    purchaseOrderId: null,
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
  };
  await deps.rfqs.create(rfq);
  return rfq;
}

/** مرسل (Send): مسودة → مرسل — opens the RFQ up for supplier quotes. */
export async function sendRfq(id: string, deps: Pick<RfqDeps, "rfqs">): Promise<PurchaseRfq> {
  const rfq = await deps.rfqs.findById(id);
  if (!rfq) throw new RfqNotFoundError(id);
  if (rfq.status !== "draft") throw new RfqNotDraftError(id, rfq.status);
  const sent: PurchaseRfq = { ...rfq, status: "sent" };
  await deps.rfqs.update(sent);
  return sent;
}

/** إلغاء (Cancel): a draft or sent RFQ → ملغي. */
export async function cancelRfq(id: string, deps: Pick<RfqDeps, "rfqs">): Promise<PurchaseRfq> {
  const rfq = await deps.rfqs.findById(id);
  if (!rfq) throw new RfqNotFoundError(id);
  if (rfq.status === "closed" || rfq.status === "cancelled") {
    throw new RfqNotOpenError(id, rfq.status);
  }
  const cancelled: PurchaseRfq = { ...rfq, status: "cancelled" };
  await deps.rfqs.update(cancelled);
  return cancelled;
}

/** مغلق (Close) a sent RFQ WITHOUT converting it (e.g. no quote was chosen). */
export async function closeRfq(id: string, deps: Pick<RfqDeps, "rfqs">): Promise<PurchaseRfq> {
  const rfq = await deps.rfqs.findById(id);
  if (!rfq) throw new RfqNotFoundError(id);
  if (rfq.status !== "sent") throw new RfqNotSentError(id, rfq.status);
  const closed: PurchaseRfq = { ...rfq, status: "closed" };
  await deps.rfqs.update(closed);
  return closed;
}

function validateQuote(command: RecordRfqQuoteCommand, rfq: PurchaseRfq): void {
  const reasons: string[] = [];
  if (command.supplierId.trim() === "") reasons.push("a supplier is required");
  if (command.lines.length === 0) reasons.push("at least one quote line is required");
  const rfqItemIds = new Set(rfq.lines.map((l) => l.itemId));
  command.lines.forEach((line, i) => {
    if (line.itemId.trim() === "") reasons.push(`line ${i}: an item is required`);
    else if (!rfqItemIds.has(line.itemId)) {
      reasons.push(`line ${i}: item "${line.itemId}" is not on this RFQ`);
    }
    if (line.unitPrice.scaled < 0n) reasons.push(`line ${i}: unit price must not be negative`);
  });
  if (reasons.length > 0) throw new InvalidRfqError(reasons);
}

/**
 * Record one supplier's price quote against a sent RFQ (العروض — quote
 * entry). Only allowed while the RFQ is "sent" (still open for quotes).
 */
export async function recordRfqQuote(
  command: RecordRfqQuoteCommand,
  deps: RfqQuoteDeps,
): Promise<RfqQuote> {
  const rfq = await deps.rfqs.findById(command.rfqId);
  if (!rfq) throw new RfqNotFoundError(command.rfqId);
  if (rfq.status !== "sent") throw new RfqNotSentError(command.rfqId, rfq.status);
  validateQuote(command, rfq);

  const quote: RfqQuote = {
    id: command.id,
    rfqId: command.rfqId,
    supplierId: command.supplierId,
    lines: command.lines.map((l) => ({
      itemId: l.itemId,
      unitPrice: l.unitPrice,
      notes: l.notes ?? null,
    })),
    notes: command.notes ?? null,
    submittedAt: nowIso(deps),
  };
  await deps.quotes.create(quote);
  return quote;
}

// --- Comparison --------------------------------------------------------------

export interface RfqComparisonRow {
  readonly itemId: string;
  readonly qty: Qty;
  /** This item's quoted unit price per supplier (absent = that supplier didn't quote this item). */
  readonly quotesBySupplier: ReadonlyMap<string, Money>;
  /** The cheapest quoting supplier for this item, if any. */
  readonly cheapestSupplierId: string | null;
}

export interface RfqComparison {
  readonly rfq: PurchaseRfq;
  readonly supplierIds: readonly string[];
  readonly rows: readonly RfqComparisonRow[];
  /** Σ (qty × unit price) per supplier — only for suppliers that quoted EVERY line (a full-basket total). */
  readonly totalsBySupplier: ReadonlyMap<string, Money>;
}

/** Build a per-item, per-supplier price comparison (pure) — the "مقارنة العروض" grid. */
export function compareRfqQuotes(
  rfq: PurchaseRfq,
  quotes: readonly RfqQuote[],
): RfqComparison {
  const supplierIds = [...new Set(quotes.map((q) => q.supplierId))];

  const rows: RfqComparisonRow[] = rfq.lines.map((line) => {
    const bySupplier = new Map<string, Money>();
    for (const quote of quotes) {
      const match = quote.lines.find((l) => l.itemId === line.itemId);
      if (match) bySupplier.set(quote.supplierId, match.unitPrice);
    }
    let cheapestSupplierId: string | null = null;
    for (const [supplierId, price] of bySupplier) {
      const current = cheapestSupplierId ? bySupplier.get(cheapestSupplierId) : null;
      if (!current || price.scaled < current.scaled) cheapestSupplierId = supplierId;
    }
    return { itemId: line.itemId, qty: line.qty, quotesBySupplier: bySupplier, cheapestSupplierId };
  });

  const totalsBySupplier = new Map<string, Money>();
  for (const supplierId of supplierIds) {
    if (!rows.every((r) => r.quotesBySupplier.has(supplierId))) continue;
    let total = Money.zero();
    for (const row of rows) {
      const price = row.quotesBySupplier.get(supplierId) as Money;
      total = total.add(extend(row.qty, price));
    }
    totalsBySupplier.set(supplierId, total);
  }

  return { rfq, supplierIds, rows, totalsBySupplier };
}

/**
 * Convert a chosen supplier's quote into a Purchase Order (docs/archive/catalog/02 —
 * "generate a PO" from a compared quote) and close the RFQ, linked to the new
 * PO. Every RFQ line must have a matching quote line from that supplier.
 */
export async function convertRfqToPurchaseOrder(
  command: ConvertRfqCommand,
  deps: RfqQuoteDeps & PurchaseOrderDeps,
): Promise<{ rfq: PurchaseRfq; order: PurchaseOrder }> {
  const rfq = await deps.rfqs.findById(command.rfqId);
  if (!rfq) throw new RfqNotFoundError(command.rfqId);
  if (rfq.status !== "sent") throw new RfqNotSentError(command.rfqId, rfq.status);

  const quotes = await deps.quotes.listByRfq(command.rfqId);
  const chosen = quotes.find((q) => q.supplierId === command.supplierId);
  if (!chosen) throw new RfqQuoteNotFoundError(`${command.rfqId}:${command.supplierId}`);

  const lines: CreatePurchaseOrderCommand["lines"] = rfq.lines.map((line) => {
    const priced = chosen.lines.find((l) => l.itemId === line.itemId);
    if (!priced) {
      throw new InvalidRfqError([
        `supplier "${command.supplierId}" did not quote item "${line.itemId}"`,
      ]);
    }
    return {
      itemId: line.itemId,
      description: line.description,
      qty: line.qty,
      unitPrice: priced.unitPrice,
    };
  });

  const order = await createPurchaseOrder(
    {
      id: command.purchaseOrderId,
      supplierId: command.supplierId,
      date: rfq.date,
      expectedDeliveryDate: command.expectedDeliveryDate ?? rfq.requiredByDate ?? null,
      branchId: rfq.branchId,
      warehouseId: rfq.warehouseId,
      notes: rfq.notes,
      createdBy: command.createdBy,
      lines,
    },
    deps,
  );

  const closed: PurchaseRfq = { ...rfq, status: "closed", purchaseOrderId: order.id };
  await deps.rfqs.update(closed);
  return { rfq: closed, order };
}
