/**
 * فاتورة المشتريات (Purchase Invoice) — the AP document (docs/archive/catalog/02
 * §Purchase Invoices). مسودة (draft) → مؤكد (confirmed). On confirmation it
 * posts the accounting effect (Dr Inventory + Dr Input VAT / Cr Accounts
 * Payable, with freight/expense lines debiting a freight account) through the GL
 * posting port, and — for a MANUAL invoice (not created from a goods receipt) —
 * also posts stock IN through the costing/stock-ledger engine.
 *
 * A "from receipt" invoice does NOT re-post stock: the goods already entered the
 * ledger when the receipt confirmed, so re-posting would double-count on-hand.
 * Its lines are auto-filled from the confirmed receipt (create-from auto-fill).
 */

import { InvoiceDocumentKind } from "../documents/invoice-document-kind.js";
import { allocate, Money, Qty } from "../money/index.js";
import type { CostCategory } from "../contracting/cost-category.js";
import type { AllocatableInvoiceRepository } from "../vouchers/allocation.js";
import { extend, occurredAtFromDocumentDate, unitCostOf, type CostLayerRepository } from "../inventory/index.js";
import { JournalEntryNotFoundError, ReversalDateBeforeOriginalError } from "../gl/errors.js";
import { convertToBase } from "../exchange-rates/convert.js";
import { NextNumberService } from "../numbering/index.js";
import { resolveDocumentLineTax, type TaxRate, type TaxRateRepository } from "../tax-rates/index.js";
import type { GoodsReceipt, GoodsReceiptRepository, ReceiptLineBilling, StockDifferenceAccounts } from "./goods-receipt.js";
import { backOrderCoverLines, billGoodsReceipt, cancelledReceiptStockLines, distinctPositions, GoodsReceiptInvoicingStatus, goodsReceiptInvoicingStatus, receiptLayersConsumed, receiptLineRemainingQty, unbillGoodsReceipt } from "./goods-receipt.js";
import { LandedCostStandsOnDocumentError } from "../landed-costs/errors.js";
import { atomically, recordPurchaseAudit, type PurchaseAuditDeps } from "./audit.js";
import { assertDocumentWritten } from "../documents/errors.js";

const PURCHASE_INVOICE_DOC_TYPE = "PURCHASE_INVOICE";
import {
  DEFAULT_PURCHASE_POLICY,
  type PurchaseGlAccounts,
  type PurchaseGlPosting,
  type PurchaseGlPostingLine,
  type PurchaseGlPostingPort,
  type PurchaseGlReversalPort,
  type PurchaseInvoiceStatus,
  type PurchasePolicy,
  type PurchaseStockPostingPort,
} from "./types.js";
import {
  GoodsReceiptAlreadyInvoicedError,
  GoodsReceiptInvoicedRefusal,
  InvoiceDoesNotMatchReceiptError,
  InvoiceExceedsReceiptError,
  DuplicatePurchaseDocumentError,
  GoodsReceiptNotFoundError,
  InvalidPurchaseDocumentError,
  PurchaseDocumentNotDraftError,
  PurchaseInvoiceNotFoundError,
  PurchaseItemsAlreadyConsumedError,
  ReceiptRequiredError,
} from "./errors.js";

const PURCHASE_INVOICE_SEQUENCE = "PURCHASE_INVOICE";
const TAX_SCALE = 1_000_000n; // percent carried to 1e-6 for exact tax math

/**
 * The three things a purchase-invoice line can be (R4.2):
 *
 * - `inventory` (مخزني) — raises stock and debits the inventory account
 * - `expense`   (مصروف)  — debits the general purchase-expense account
 * - `freight`   (شحن)    — debits the freight account
 *
 * None of the three changes what the supplier is owed; they decide which
 * account the debit side lands in, which is what makes the P&L legible.
 */
export type PurchaseInvoiceLineKind = "inventory" | "expense" | "freight";

export interface PurchaseInvoiceLine {
  /** Required for an inventory line; null for a freight/expense line. */
  readonly itemId: string | null;
  readonly description: string | null;
  readonly kind: PurchaseInvoiceLineKind;
  readonly qty: Qty;
  readonly unitCost: Money;
  readonly taxRatePercent: number;
  readonly taxRateId?: string | null;
  /** Supplier lot this delivery arrived under. Absent for non-tracked goods. */
  readonly batchNo?: string | null;
  /** ISO-8601 expiry of the received goods; drives FEFO consumption. Absent for non-perishables. */
  readonly expiryDate?: string | null;
  /** فئة التكلفة — only meaningful with the invoice's `projectId` (D-01). */
  readonly costCategory?: CostCategory | null;
  /** INVARIANT: written once, at confirm — the receipt lines this line billed. A cancel gives back exactly these quantities; absent on a confirmed from-receipt invoice means it predates per-line billing and cleared the whole receipt. */
  readonly receiptBillings?: readonly ReceiptLineBilling[];
}

export interface PurchaseInvoice {
  readonly id: string;
  readonly documentKind?: InvoiceDocumentKind;
  readonly number: string;
  readonly supplierId: string;
  readonly date: string;
  readonly dueDate: string | null;
  /** The supplier's own invoice number (رقم فاتورة المورد), free text. */
  readonly supplierInvoiceNumber: string | null;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly currency: string;
  readonly notes: string | null;
  /** The confirmed goods receipt this invoice was created from, if any. */
  readonly receiptId: string | null;
  /** بُعد المشروع — the contracting project this invoice's cost belongs to (D-01). */
  readonly projectId?: string | null;
  readonly lines: readonly PurchaseInvoiceLine[];
  readonly status: PurchaseInvoiceStatus;
  /**
   * The rate this invoice was CONFIRMED at, when its currency is not the base
   * one. Stamped once, at confirm, so the sub-ledger and every report restate
   * the same figure the GL was posted with rather than re-deriving a rate that
   * may since have changed (D24). Null for a base-currency invoice.
   */
  readonly fxRate?: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export enum PurchaseInvoiceField {
  Status = "status",
  FxRate = "fxRate",
  Lines = "lines",
}

export interface PurchaseInvoiceRepository {
  findById(id: string): Promise<PurchaseInvoice | null>;
  list(filter?: PurchaseInvoiceListFilter): Promise<PurchaseInvoice[]>;
  /** How many invoices the same filter matches, ignoring `limit`/`offset`. */
  count?(filter?: PurchaseInvoiceListFilter): Promise<number>;
  create(invoice: PurchaseInvoice): Promise<void>;
  update(invoice: PurchaseInvoice): Promise<void>;
  /**
   * INVARIANT: the ONE write a posted invoice line takes — `taxRateId` on the
   * lines at these positions that store NONE at `taxRatePercent`, on a
   * confirmed invoice. Returns how many it named; nothing else is written.
   */
  nameLineTaxRate(invoiceId: string, lineIndexes: readonly number[], taxRatePercent: number, taxRateId: string): Promise<number>;
  /**
   * INVARIANT: the ONE write a state change makes to a stored invoice — the
   * named fields of `next`, only while the stored row is still in
   * `expected.status`. It answers whether a row was written; a confirm or a
   * cancel never saves a whole invoice it read earlier, so a classification
   * that landed in between is never undone.
   */
  writeFields(next: PurchaseInvoice, fields: readonly PurchaseInvoiceField[], expected: { readonly status: PurchaseInvoiceStatus }): Promise<boolean>;
}

/**
 * What the store can answer in SQL, so a list is a page rather than the whole
 * table (Q-8). Everything here is a column; anything derived stays in the
 * caller.
 */
export interface PurchaseInvoiceListFilter {
  readonly status?: PurchaseInvoiceStatus;
  /** A SET of statuses, ANDed with `status`. An empty array matches nothing. */
  readonly statusIn?: readonly PurchaseInvoiceStatus[];
  readonly supplierId?: string;
  /** Inclusive bounds on the invoice date. */
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly branchId?: string;
  readonly warehouseId?: string;
  readonly receiptId?: string;
  /** Substring of the document number or the supplier's own invoice number. */
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface PurchaseInvoiceLineInput {
  readonly itemId?: string | null;
  readonly description?: string | null;
  readonly kind?: PurchaseInvoiceLineKind;
  readonly qty: Qty;
  readonly unitCost: Money;
  readonly taxRatePercent?: number;
  readonly taxRateId?: string | null;
  readonly batchNo?: string | null;
  readonly expiryDate?: string | null;
  readonly costCategory?: CostCategory | null;
}

export interface CreatePurchaseInvoiceCommand {
  readonly id: string;
  readonly supplierId: string;
  readonly date: string;
  readonly dueDate?: string | null;
  readonly supplierInvoiceNumber?: string | null;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly currency?: string;
  readonly notes?: string | null;
  readonly receiptId?: string | null;
  /** بُعد المشروع — optional; omit to inherit the receipt's projectId (create-from-receipt). */
  readonly projectId?: string | null;
  readonly documentKind?: InvoiceDocumentKind;
  readonly createdBy?: string;
  readonly lines: readonly PurchaseInvoiceLineInput[];
}

export interface CreatePurchaseInvoiceDeps {
  readonly invoices: PurchaseInvoiceRepository;
  readonly taxRates?: Pick<TaxRateRepository, "list">;
  readonly receipts?: GoodsReceiptRepository;
  readonly numbering: NextNumberService;
  readonly policy?: PurchasePolicy;
  readonly now?: () => string;
}

export interface ConfirmPurchaseInvoiceDeps extends PurchaseAuditDeps {
  readonly invoices: PurchaseInvoiceRepository;
  readonly receipts?: GoodsReceiptRepository;
  readonly stock: PurchaseStockPostingPort;
  readonly gl: PurchaseGlPostingPort;
  readonly accounts: PurchaseGlAccounts;
  /**
   * Payables sub-ledger. Without it a confirmed invoice never becomes an
   * allocatable open invoice, so AP has no supplier dimension and voucher
   * allocation sees nothing to allocate against.
   */
  readonly allocatable?: AllocatableInvoiceRepository;
  /**
   * Exchange rates, so a foreign-currency invoice posts its base-currency value
   * at the rate that applied on its date and keeps that rate on the payable
   * line for revaluation (D24). Omit and a non-base currency is refused rather
   * than posted at 1:1 — silently mis-stating a debt is the worse failure.
   */
  readonly exchangeRates?: { findRate(currency: string, asOfDate: string): Promise<{ rate: string } | null> };
  /** The tenant's own currency; anything else on a document needs a rate. */
  readonly baseCurrency?: string;
  readonly now?: () => string;
}

export interface ConfirmPurchaseInvoiceResult {
  readonly invoice: PurchaseInvoice;
  /** The balanced posting handed to the GL — surfaced for callers/tests. */
  readonly posting: PurchaseGlPosting;
}

export interface CancelPurchaseInvoiceDeps extends PurchaseAuditDeps {
  readonly landedCostsStandingOn?: (documentId: string) => Promise<readonly string[]>;
  readonly invoices: PurchaseInvoiceRepository;
  readonly stock: PurchaseStockPostingPort;
  readonly glReverse: PurchaseGlReversalPort;
  readonly accounts?: StockDifferenceAccounts;
  readonly layers: CostLayerRepository;
  readonly receipts?: GoodsReceiptRepository;
  readonly policy?: PurchasePolicy;
  readonly now?: () => string;
  readonly cancelGuard?: (invoice: PurchaseInvoice) => Promise<void>;
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

export function purchaseInvoiceCancelEntryId(invoiceId: string): string {
  return `${invoiceId}:cancel`;
}

/** HALF_UP division on magnitudes (0.5 away from zero) — the TAX_COMPUTATION boundary. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

// --- pure computations ------------------------------------------------------

/** Line base = qty × unit cost (LINE_EXTENSION boundary). */
export function purchaseInvoiceLineBase(line: {
  readonly qty: Qty;
  readonly unitCost: Money;
}): Money {
  return extend(line.qty, line.unitCost);
}

/** Line tax = base × rate% (TAX_COMPUTATION boundary, HALF_UP). */
export function purchaseInvoiceLineTax(line: {
  readonly qty: Qty;
  readonly unitCost: Money;
  readonly taxRatePercent: number;
}): Money {
  const base = purchaseInvoiceLineBase(line);
  const rateScaled = BigInt(Math.round(line.taxRatePercent * Number(TAX_SCALE)));
  return Money.fromScaled(divRoundHalfUp(base.scaled * rateScaled, 100n * TAX_SCALE));
}

/** The base-currency parts of an invoice, each the sum of its lines converted one by one. */
export interface PurchaseInvoiceBaseParts {
  readonly inventory: Money;
  readonly freight: Money;
  readonly expense: Money;
  readonly tax: Money;
  readonly total: Money;
}

/**
 * Every figure the posting carries, in the BASE currency. Each line's base and
 * tax are converted on their own and the kind totals and the payable are sums
 * of those, so the AP credit is exactly the sum of the debits it balances; a
 * sum converted once can sit a rounding unit away from its converted parts,
 * which unbalanced the entry (D213).
 */
export function purchaseInvoiceBaseParts(
  invoice: { readonly lines: readonly PurchaseInvoiceLine[] },
  rate?: string | null,
): PurchaseInvoiceBaseParts {
  const convert = (amount: Money): Money => (rate ? convertToBase(amount, rate) : amount);
  let inventory = Money.zero();
  let freight = Money.zero();
  let expense = Money.zero();
  let tax = Money.zero();
  for (const line of invoice.lines) {
    const base = convert(purchaseInvoiceLineBase(line));
    if (line.kind === "inventory") inventory = inventory.add(base);
    else if (line.kind === "freight") freight = freight.add(base);
    else expense = expense.add(base);
    tax = tax.add(convert(purchaseInvoiceLineTax(line)));
  }
  return { inventory, freight, expense, tax, total: inventory.add(freight).add(expense).add(tax) };
}

/**
 * The invoice's total in the BASE currency — what GL 2100 was credited with.
 * `purchaseInvoiceTotal` is the document's own figure, in the document's own
 * currency; for a foreign invoice the two differ by the rate it confirmed at
 * (D24), and a sub-ledger that compares the wrong one to the control account
 * reads adrift by the whole exchange rate.
 */
export function purchaseInvoiceBaseTotal(invoice: {
  readonly lines: readonly PurchaseInvoiceLine[];
  readonly fxRate?: string | null;
}): Money {
  return purchaseInvoiceBaseParts(invoice, invoice.fxRate).total;
}

/** Σ line bases across all lines (the invoice subtotal, before tax). */
export function purchaseInvoiceSubtotal(invoice: {
  readonly lines: readonly PurchaseInvoiceLine[];
}): Money {
  return Money.sum(invoice.lines.map(purchaseInvoiceLineBase));
}

/** Σ inventory-line bases — the amount that raises stock and Dr Inventory. */
export function purchaseInvoiceInventoryBase(invoice: {
  readonly lines: readonly PurchaseInvoiceLine[];
}): Money {
  return Money.sum(
    invoice.lines.filter((l) => l.kind === "inventory").map(purchaseInvoiceLineBase),
  );
}

/** Σ freight-line bases — Dr Freight, never stock. */
export function purchaseInvoiceFreightBase(invoice: {
  readonly lines: readonly PurchaseInvoiceLine[];
}): Money {
  return Money.sum(
    invoice.lines.filter((l) => l.kind === "freight").map(purchaseInvoiceLineBase),
  );
}

/** Σ general-expense-line bases — Dr Purchase expenses, never stock (R4.2). */
export function purchaseInvoiceExpenseBase(invoice: {
  readonly lines: readonly PurchaseInvoiceLine[];
}): Money {
  return Money.sum(
    invoice.lines.filter((l) => l.kind === "expense").map(purchaseInvoiceLineBase),
  );
}

/** Σ line taxes — Dr Input VAT. */
export function purchaseInvoiceTax(invoice: {
  readonly lines: readonly PurchaseInvoiceLine[];
}): Money {
  return Money.sum(invoice.lines.map(purchaseInvoiceLineTax));
}

/** Grand total = subtotal + tax — the payable owed to the supplier (Cr AP). */
export function purchaseInvoiceTotal(invoice: {
  readonly lines: readonly PurchaseInvoiceLine[];
}): Money {
  return purchaseInvoiceSubtotal(invoice).add(purchaseInvoiceTax(invoice));
}

/**
 * Auto-fill purchase-invoice lines from a confirmed goods receipt (create-from
 * auto-fill). Each receipt line becomes an inventory line at the receipt's unit
 * cost; the tax rate per item is resolved via `resolveTaxRate` (defaults to 0).
 */
export function buildInvoiceLinesFromReceipt(
  receipt: GoodsReceipt,
  resolveTaxRate: (itemId: string) => number = () => 0,
  quantities?: readonly ReceiptLineBilling[],
): PurchaseInvoiceLine[] {
  const unknown = (quantities ?? []).filter((q) => receipt.lines[q.lineIndex] === undefined);
  if (unknown.length > 0) {
    throw new InvoiceDoesNotMatchReceiptError(receipt.id, unknown.map((q) => ({ ar: `البند رقم ${q.lineIndex + 1} غير موجود في إذن الاستلام`, en: `line ${q.lineIndex + 1} is not on the receipt` })));
  }
  const wanted = (index: number, remaining: Qty): Qty => {
    if (!quantities) return remaining;
    return Qty.sum(quantities.filter((q) => q.lineIndex === index).map((q) => q.qty));
  };
  return receipt.lines.map((l, index) => ({ l, qty: wanted(index, receiptLineRemainingQty(receipt, l)) })).filter(({ qty }) => qty.compare(Qty.zero()) > 0).map(({ l, qty }) => ({
    itemId: l.itemId,
    description: l.description,
    kind: "inventory" as const,
    qty,
    unitCost: l.unitCost,
    taxRatePercent: resolveTaxRate(l.itemId),
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
    costCategory: l.costCategory ?? null,
  }));
}

function normalizeLines(
  lines: readonly PurchaseInvoiceLineInput[],
  taxRates: readonly TaxRate[] | null,
): PurchaseInvoiceLine[] {
  return lines.map((l) => {
    const kind = l.kind ?? "inventory";
    const tax = resolveDocumentLineTax(taxRates, l, { defaultPercent: 0, zeroRating: null });
    return {
      itemId: kind === "expense" ? (l.itemId ?? null) : (l.itemId ?? null),
      description: l.description ?? null,
      kind,
      qty: l.qty,
      unitCost: l.unitCost,
      taxRatePercent: tax.taxRatePercent,
      taxRateId: tax.taxRateId,
      batchNo: l.batchNo ?? null,
      expiryDate: l.expiryDate ?? null,
      costCategory: l.costCategory ?? null,
    };
  });
}

function validate(lines: readonly PurchaseInvoiceLine[], supplierId: string, projectId: string | null = null): void {
  const reasons: string[] = [];
  if (supplierId.trim() === "") reasons.push("a supplier is required");
  if (lines.length === 0) reasons.push("at least one line is required");
  lines.forEach((line, i) => {
    if (line.kind === "inventory" && (line.itemId === null || line.itemId.trim() === "")) {
      reasons.push(`line ${i}: an inventory line requires an item`);
    }
    if (line.qty.isZero() || line.qty.isNegative()) reasons.push(`line ${i}: qty must be positive`);
    if (line.unitCost.scaled < 0n) reasons.push(`line ${i}: unit cost must not be negative`);
    if (line.taxRatePercent < 0) reasons.push(`line ${i}: tax rate must not be negative`);
    if (line.costCategory && !projectId) {
      reasons.push(`line ${i}: costCategory requires the invoice's projectId`);
    }
  });
  if (reasons.length > 0) throw new InvalidPurchaseDocumentError(reasons);
}

function assertInvoiceMatchesReceipt(command: Pick<CreatePurchaseInvoiceCommand, "warehouseId" | "lines">, receipt: GoodsReceipt): void {
  const reasons: { ar: string; en: string }[] = [];
  if (command.warehouseId !== receipt.warehouseId) {
    reasons.push({
      ar: `مستودع الفاتورة "${command.warehouseId}" يختلف عن مستودع الاستلام "${receipt.warehouseId}"`,
      en: `the invoice warehouse "${command.warehouseId}" is not the receipt's warehouse "${receipt.warehouseId}"`,
    });
  }
  const received = new Set(receipt.lines.map((line) => line.itemId));
  const foreign = new Set<string>();
  for (const line of command.lines) {
    if ((line.kind ?? "inventory") !== "inventory" || !line.itemId || received.has(line.itemId)) continue;
    foreign.add(line.itemId);
  }
  for (const itemId of foreign) {
    reasons.push({ ar: `الصنف "${itemId}" غير موجود في إذن الاستلام`, en: `item "${itemId}" is not on the receipt` });
  }
  if (reasons.length > 0) throw new InvoiceDoesNotMatchReceiptError(receipt.id, reasons);
}

export function billInvoiceAgainstReceipt(lines: readonly { readonly itemId?: string | null; readonly kind?: PurchaseInvoiceLineKind; readonly qty: Qty }[], receipt: GoodsReceipt): ReceiptLineBilling[][] {
  const remaining = receipt.lines.map((line) => receiptLineRemainingQty(receipt, line));
  const requested = new Map<string, Qty>();
  const available = new Map<string, Qty>();
  receipt.lines.forEach((line, index) => available.set(line.itemId, (available.get(line.itemId) ?? Qty.zero()).add(remaining[index] as Qty)));
  const billings = lines.map((line) => {
    if ((line.kind ?? "inventory") !== "inventory" || !line.itemId) return [];
    requested.set(line.itemId, (requested.get(line.itemId) ?? Qty.zero()).add(line.qty));
    let need = line.qty;
    const taken: ReceiptLineBilling[] = [];
    receipt.lines.forEach((receiptLine, index) => {
      const open = remaining[index] as Qty;
      if (receiptLine.itemId !== line.itemId || need.isZero() || open.compare(Qty.zero()) <= 0) return;
      const qty = open.compare(need) < 0 ? open : need;
      taken.push({ lineIndex: index, qty });
      remaining[index] = open.subtract(qty);
      need = need.subtract(qty);
    });
    return taken;
  });
  const excess = [...requested]
    .filter(([itemId, qty]) => available.has(itemId) && qty.compare(available.get(itemId) as Qty) > 0)
    .map(([itemId, qty]) => ({ itemId, requested: qty.toString(), remaining: (available.get(itemId) as Qty).toString() }));
  if (excess.length > 0) throw new InvoiceExceedsReceiptError(receipt.id, excess);
  return billings;
}

/**
 * Create a مسودة (draft) purchase invoice — manual, or from a confirmed receipt.
 * With `requireReceiptForInvoice` on, a `receiptId` is mandatory.
 */
export async function createPurchaseInvoice(
  command: CreatePurchaseInvoiceCommand,
  deps: CreatePurchaseInvoiceDeps,
): Promise<PurchaseInvoice> {
  const policy = deps.policy ?? DEFAULT_PURCHASE_POLICY;
  if (policy.requireReceiptForInvoice && !command.receiptId) {
    throw new ReceiptRequiredError();
  }
  let sourceReceipt: GoodsReceipt | null = null;
  if (command.receiptId && deps.receipts) {
    const receipt = await deps.receipts.findById(command.receiptId);
    if (!receipt) throw new GoodsReceiptNotFoundError(command.receiptId);
    if (receipt.status !== "confirmed") {
      throw new InvalidPurchaseDocumentError([
        `goods receipt "${command.receiptId}" is "${receipt.status}"; only a confirmed receipt can be invoiced`,
      ]);
    }
    if (goodsReceiptInvoicingStatus(receipt) === GoodsReceiptInvoicingStatus.Invoiced) throw new GoodsReceiptAlreadyInvoicedError(command.receiptId, GoodsReceiptInvoicedRefusal.SecondInvoice);
    assertInvoiceMatchesReceipt(command, receipt);
    billInvoiceAgainstReceipt(command.lines, receipt);
    sourceReceipt = receipt;
  }
  if (await deps.invoices.findById(command.id)) {
    throw new DuplicatePurchaseDocumentError(command.id);
  }

  const lines = normalizeLines(command.lines, deps.taxRates ? await deps.taxRates.list() : null);
  // A from-receipt invoice inherits the receipt's projectId when the caller
  // does not state its own (D-01) — the header field an unattended
  // create-from-receipt build would otherwise drop.
  const projectId = command.projectId ?? sourceReceipt?.projectId ?? null;
  validate(lines, command.supplierId, projectId);

  const number = await deps.numbering.next(PURCHASE_INVOICE_SEQUENCE, { branchId: command.branchId });
  const invoice: PurchaseInvoice = {
    id: command.id,
    documentKind: command.documentKind ?? InvoiceDocumentKind.Standard,
    number: number.formatted,
    fxRate: null,
    supplierId: command.supplierId,
    date: command.date,
    dueDate: command.dueDate ?? null,
    supplierInvoiceNumber: command.supplierInvoiceNumber ?? null,
    projectId,
    branchId: command.branchId,
    warehouseId: command.warehouseId,
    currency: command.currency ?? "EGP",
    notes: command.notes ?? null,
    receiptId: command.receiptId ?? null,
    lines,
    status: "draft",
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
  };
  await deps.invoices.create(invoice);
  return invoice;
}

/**
 * INVARIANT: a foreign line enters the stock ledger worth exactly the base
 * amount the posting debits for it, `convertToBase(qty × unitCost)`. One line
 * at the converted unit cost sits up to half a micro-unit per unit away from
 * GL 1200, so, as a work-order receipt does (D206), one unit carries the
 * remainder.
 */
export function baseReceiptLines(qty: Qty, unitCost: Money, rate?: string | null): { qty: Qty; unitCost: Money }[] {
  if (!rate) return [{ qty, unitCost }];
  const target = convertToBase(extend(qty, unitCost), rate);
  const unit = unitCostOf(target, qty);
  const one = Qty.fromMajor("1");
  if (extend(qty, unit).scaled === target.scaled || qty.compare(one) <= 0) return [{ qty, unitCost: unit }];
  const head = qty.subtract(one);
  return [
    { qty: head, unitCost: unit },
    { qty: one, unitCost: Money.fromScaled(target.scaled - extend(head, unit).scaled) },
  ];
}

/** Build the balanced Dr/Cr posting for a confirmed invoice (pure). */
export interface ReceiptCostVariance {
  readonly relievedByLine: readonly Money[];
  readonly absorbed: Money;
  readonly unabsorbed: Money;
}

export function buildInvoicePosting(
  invoice: PurchaseInvoice,
  accounts: PurchaseGlAccounts,
  fx?: { readonly rate: string; readonly baseCurrency: string },
  variance?: ReceiptCostVariance,
): PurchaseGlPosting {
  // Line amounts are entered in the DOCUMENT's currency. When that is not the
  // base currency they are converted here, once, at the rate that applied on
  // the invoice's date — and the payable line keeps the currency and rate, so
  // the FX revaluation engine can restate the debt later. Without this a
  // `currency: "USD"` invoice credited 2100 with its USD figure as though it
  // were EGP, understating the payable by the whole rate (D24).
  const foreign = fx !== undefined;
  const convert = (amount: Money): Money => (foreign ? convertToBase(amount, fx.rate) : amount);

  const parts = purchaseInvoiceBaseParts(invoice, foreign ? fx.rate : null);
  const inventoryBase = parts.inventory;
  const freightBase = parts.freight;
  const expenseBase = parts.expense;
  const tax = parts.tax;
  const payable = parts.total;
  const freightAccountId = accounts.freightAccountId ?? accounts.inventoryAccountId;
  const expenseAccountId = accounts.expenseAccountId ?? freightAccountId;
  const fxTag = foreign ? { currency: invoice.currency, fxRate: fx.rate } : {};

  // Cost-side lines (inventory/freight/expense) are split by cost category —
  // never the AP/VAT lines, which carry no cost dimension at all — so a mixed-
  // category invoice still posts one tagged line per category instead of
  // losing the split (D-01). A single, uncategorised group reproduces the
  // one-line-per-kind shape this posting always had.
  //
  // INVARIANT: each cost-side line also carries the tax rate its invoice lines
  // were charged under, exactly as the input-VAT line does. It is the taxable
  // BASE of that rate: the VAT return reads the base off these lines, and a 0%
  // line posts no VAT line at all, so this is the only place its rate reaches
  // the ledger (D28, D79).
  interface CostGroup {
    readonly costCategory: CostCategory | null;
    readonly rate: number;
    readonly taxRateId: string | null;
    readonly amount: Money;
  }
  const clearsGrni = invoice.receiptId !== null && accounts.goodsReceivedNotInvoicedAccountId !== undefined;
  const costGroups = (kind: PurchaseInvoiceLineKind): CostGroup[] => {
    const groups = new Map<string, CostGroup>();
    for (const [index, line] of invoice.lines.entries()) {
      if (line.kind !== kind) continue;
      // The accrual is cleared by what the RECEIPT recorded for the billed quantity, never by what the invoice states: the difference is a cost of the goods (or a price variance), not a balance left sitting in 2120.
      const amount = kind === "inventory" && clearsGrni && variance ? (variance.relievedByLine[index] as Money) : convert(purchaseInvoiceLineBase(line));
      const costCategory = line.costCategory ?? null;
      const taxRateId = line.taxRateId ?? null;
      const key = `${costCategory ?? ""}|${line.taxRatePercent}|${taxRateId ?? ""}`;
      const existing = groups.get(key);
      groups.set(key, { costCategory, rate: line.taxRatePercent, taxRateId, amount: (existing?.amount ?? Money.zero()).add(amount) });
    }
    return [...groups.values()];
  };
  const costLine = (accountId: string, group: CostGroup): PurchaseGlPostingLine => ({
    accountId,
    debit: group.amount,
    credit: Money.zero(),
    taxRatePercent: group.rate,
    taxRateId: group.taxRateId,
    ...(group.costCategory ? { costCategory: group.costCategory } : {}),
  });

  const lines: PurchaseGlPostingLine[] = [];
  if (inventoryBase.scaled !== 0n) {
    /**
     * Whichever document MOVED the stock is the one that debits inventory, and
     * only that one (D53). When a goods receipt brought the goods in, it has
     * already debited 1200 and credited بضاعة واردة لم تُفوتر; this invoice
     * clears that credit instead, so inventory is not debited twice and the
     * liability moves from "received, not invoiced" to a real payable. With no
     * receipt behind it, the invoice IS the stock-in document and debits
     * inventory itself.
     */
    const inventoryAccountId = clearsGrni ? (accounts.goodsReceivedNotInvoicedAccountId as string) : accounts.inventoryAccountId;
    for (const group of costGroups("inventory")) {
      if (group.amount.scaled !== 0n) lines.push(costLine(inventoryAccountId, group));
    }
    if (clearsGrni && variance) {
      lines.push(...receiptVarianceLines(invoice, accounts, variance, convert));
    }
  }
  if (freightBase.scaled !== 0n) {
    for (const group of costGroups("freight")) {
      if (group.amount.scaled !== 0n) lines.push(costLine(freightAccountId, group));
    }
  }
  if (expenseBase.scaled !== 0n) {
    for (const group of costGroups("expense")) {
      if (group.amount.scaled !== 0n) lines.push(costLine(expenseAccountId, group));
    }
  }
  if (tax.scaled !== 0n) {
    // One input-VAT line per rate charged, not one blended lump. The VAT return
    // reports the rates actually charged, and it can only do that if the ledger
    // recorded them (D28). The parts are summed from the per-line tax so they
    // still add to exactly `tax` — the payable above is unchanged.
    const taxByRate = new Map<string, { rate: number; taxRateId: string | null; amount: Money }>();
    for (const line of invoice.lines) {
      const lineTax = convert(purchaseInvoiceLineTax(line));
      if (lineTax.scaled === 0n) continue;
      const taxRateId = line.taxRateId ?? null;
      const key = `${line.taxRatePercent}|${taxRateId ?? ""}`;
      const taxed = taxByRate.get(key);
      taxByRate.set(key, { rate: line.taxRatePercent, taxRateId, amount: (taxed?.amount ?? Money.zero()).add(lineTax) });
    }
    if (taxByRate.size === 0) {
      lines.push({ accountId: accounts.taxAccountId, debit: tax, credit: Money.zero() });
    } else {
      for (const { rate, taxRateId, amount } of taxByRate.values()) {
        lines.push({ accountId: accounts.taxAccountId, debit: amount, credit: Money.zero(), taxRatePercent: rate, taxRateId });
      }
    }
  }
  lines.push({ accountId: accounts.payableAccountId, debit: Money.zero(), credit: payable, ...fxTag });

  const projectId = invoice.projectId ?? null;
  // بُعد الفرع (DEC-20) — the invoice header already carries the branch that
  // raised it, so every leg (inventory/GRNI, freight, expense, input VAT, AP)
  // is attributed rather than landing in «غير مخصص».
  const branchId = invoice.branchId ?? null;
  return {
    sourceDocType: "PURCHASE_INVOICE",
    sourceDocId: invoice.id,
    sourceDocNumber: invoice.number,
    date: invoice.date,
    memo: `فاتورة مشتريات ${invoice.number}`,
    lines: lines.map((l) => ({ ...l, projectId, branchId })),
  };
}

// INVARIANT: the VAT return reads a purchase's taxable base off the tagged
// cost-side lines of its entry. The 2120 line is cleared at the RECEIPT's cost,
// so what the invoice states above or below it is tagged here, rate by rate —
// or the base reported would be the receipt's and the tax the invoice's.
function receiptVarianceLines(
  invoice: PurchaseInvoice,
  accounts: PurchaseGlAccounts,
  variance: ReceiptCostVariance,
  convert: (amount: Money) => Money,
): PurchaseGlPostingLine[] {
  const gaps = new Map<string, { rate: number; taxRateId: string | null; gap: bigint }>();
  for (const [index, line] of invoice.lines.entries()) {
    if (line.kind !== "inventory") continue;
    const taxRateId = line.taxRateId ?? null;
    const key = `${line.taxRatePercent}|${taxRateId ?? ""}`;
    const gap = convert(purchaseInvoiceLineBase(line)).scaled - (variance.relievedByLine[index] as Money).scaled;
    gaps.set(key, { rate: line.taxRatePercent, taxRateId, gap: (gaps.get(key)?.gap ?? 0n) + gap });
  }
  const groups = [...gaps.values()];
  const signed = (accountId: string, amount: bigint, tag: { rate: number; taxRateId: string | null } | null): PurchaseGlPostingLine => ({
    accountId,
    debit: amount > 0n ? Money.fromScaled(amount) : Money.zero(),
    credit: amount > 0n ? Money.zero() : Money.fromScaled(-amount),
    ...(tag ? { taxRatePercent: tag.rate, taxRateId: tag.taxRateId } : {}),
  });
  const varianceAccountId = accounts.priceVarianceAccountId ?? accounts.inventoryAccountId;
  const stated = groups.reduce((sum, group) => sum + group.gap, 0n);
  if (stated !== variance.absorbed.scaled + variance.unabsorbed.scaled) {
    return [signed(accounts.inventoryAccountId, variance.absorbed.scaled, null), signed(varianceAccountId, variance.unabsorbed.scaled, null)].filter(
      (line) => line.debit.scaled !== 0n || line.credit.scaled !== 0n,
    );
  }
  const weights = groups.map((group) => (group.gap < 0n ? -group.gap : group.gap));
  const absorbed = weights.some((weight) => weight > 0n) ? allocate(variance.absorbed, weights) : groups.map(() => Money.zero());
  return groups.flatMap((group, index) => {
    const taken = (absorbed[index] as Money).scaled;
    return [signed(accounts.inventoryAccountId, taken, group), signed(varianceAccountId, group.gap - taken, group)].filter((line) => line.debit.scaled !== 0n || line.credit.scaled !== 0n);
  });
}

async function untrackedConfirmedInvoicesOnReceipt(invoices: PurchaseInvoiceRepository, receiptId: string, exceptId: string): Promise<PurchaseInvoice[]> {
  return (await invoices.list({ receiptId, status: "confirmed" })).filter(
    (other) => other.receiptId === receiptId && other.status === "confirmed" && other.id !== exceptId && !other.lines.some((line) => line.receiptBillings !== undefined),
  );
}

export const PURCHASE_INVOICE_LATE_VARIANCE_SUFFIX = ":variance";

interface CarriedReceiptVariance {
  readonly variance: ReceiptCostVariance;
  readonly late: { readonly day: string; readonly amount: Money }[];
}

async function carryReceiptCostVariance(
  invoice: PurchaseInvoice,
  receipt: GoodsReceipt,
  billings: readonly (readonly ReceiptLineBilling[])[],
  rate: string | null,
  stock: PurchaseStockPostingPort,
  confirmDay: string,
): Promise<CarriedReceiptVariance> {
  const relievedByLine = invoice.lines.map((_, index) =>
    Money.sum((billings[index] ?? []).map((billing) => extend(billing.qty, (receipt.lines[billing.lineIndex] as GoodsReceipt["lines"][number]).unitCost))),
  );
  const byItem = new Map<string, bigint>();
  invoice.lines.forEach((line, index) => {
    if (line.kind !== "inventory" || !line.itemId) return;
    const stated = rate ? convertToBase(purchaseInvoiceLineBase(line), rate) : purchaseInvoiceLineBase(line);
    byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0n) + stated.scaled - (relievedByLine[index] as Money).scaled);
  });
  let absorbed = 0n;
  let unabsorbed = 0n;
  const late: { day: string; amount: Money }[] = [];
  for (const [itemId, difference] of byItem) {
    if (difference === 0n) continue;
    if (!stock.applyReceiptCostVariance) {
      unabsorbed += difference;
      continue;
    }
    const carried = await stock.applyReceiptCostVariance({
      varianceDocId: invoice.id,
      varianceDocNumber: invoice.number,
      receiptId: receipt.id,
      itemId,
      warehouseId: receipt.warehouseId,
      valueDelta: Money.fromScaled(difference),
      occurredAt: occurredAtFromDocumentDate(invoice.date),
      lateOccurredAt: occurredAtFromDocumentDate(confirmDay),
    });
    const day = carried.occurredAt?.slice(0, 10) ?? invoice.date;
    if (day > invoice.date) {
      unabsorbed += difference;
      if (carried.absorbed.scaled !== 0n) late.push({ day, amount: carried.absorbed });
    } else {
      absorbed += carried.absorbed.scaled;
      unabsorbed += difference - carried.absorbed.scaled;
    }
  }
  return { variance: { relievedByLine, absorbed: Money.fromScaled(absorbed), unabsorbed: Money.fromScaled(unabsorbed) }, late };
}

function lateVariancePostings(invoice: PurchaseInvoice, accounts: PurchaseGlAccounts, late: readonly { day: string; amount: Money }[]): PurchaseGlPosting[] {
  const byDay = new Map<string, bigint>();
  for (const part of late) byDay.set(part.day, (byDay.get(part.day) ?? 0n) + part.amount.scaled);
  const varianceAccountId = accounts.priceVarianceAccountId ?? accounts.inventoryAccountId;
  return [...byDay].filter(([, amount]) => amount !== 0n).map(([day, amount], index) => {
    const magnitude = Money.fromScaled(amount < 0n ? -amount : amount);
    const [debit, credit] = amount > 0n ? [accounts.inventoryAccountId, varianceAccountId] : [varianceAccountId, accounts.inventoryAccountId];
    const dimensions = { projectId: invoice.projectId ?? null, branchId: invoice.branchId ?? null };
    return {
      sourceDocType: "PURCHASE_INVOICE" as const,
      sourceDocId: invoice.id,
      entrySuffix: `${PURCHASE_INVOICE_LATE_VARIANCE_SUFFIX}${index === 0 ? "" : index}`,
      sourceDocNumber: invoice.number,
      date: day,
      memo: `فرق سعر فاتورة مشتريات ${invoice.number} على البضاعة الباقية بالمخزن`,
      lines: [
        { accountId: debit, debit: magnitude, credit: Money.zero(), ...dimensions },
        { accountId: credit, debit: Money.zero(), credit: magnitude, ...dimensions },
      ],
    };
  });
}

/**
 * تأكيد الفاتورة (Confirm invoice): مسودة → مؤكد. Posts the GL entry (inventory +
 * tax + payable) always; posts stock IN only for a MANUAL invoice (no receipt),
 * since a from-receipt invoice's goods already entered the ledger at receipt
 * confirmation. Gateable action PURCHASE_INVOICE_CONFIRM is enforced at the edge.
 */
export async function confirmPurchaseInvoice(
  id: string,
  deps: ConfirmPurchaseInvoiceDeps,
): Promise<ConfirmPurchaseInvoiceResult> {
  // EVERY WRITE BELOW SHARES ONE TRANSACTION (B-7). The GL entry is keyed
  // `PI-JE:<invoiceId>`, so a failure after it posted left the invoice `draft`
  // with a live entry and every retry threw DuplicateJournalEntryError — the
  // invoice was permanently unconfirmable. SAVEPOINT nesting on the shared
  // connection makes the inner GL transaction safe inside this one.
  //
  // A closed period, an inactive account or an unbalanced entry refuses inside
  // it, and takes back the stock a manual invoice has already received (D21).
  const transaction = deps.gl.transaction?.bind(deps.gl) ?? (<T,>(fn: () => Promise<T>) => fn());

  const { confirmed, posting } = await transaction(async () => {
    // INVARIANT: the invoice is read and guarded inside the transaction that
    // posts it; a copy read before it began is never posted or written back.
    const invoice = await deps.invoices.findById(id);
    if (!invoice) throw new PurchaseInvoiceNotFoundError(id);
    if (invoice.status !== "draft") {
      throw new PurchaseDocumentNotDraftError(id, invoice.status);
    }

    const baseCurrency = deps.baseCurrency ?? "EGP";
    let fx: { rate: string; baseCurrency: string } | undefined;
    if (invoice.currency && invoice.currency !== baseCurrency) {
      const found = await deps.exchangeRates?.findRate(invoice.currency, invoice.date);
      if (!found) {
        throw new InvalidPurchaseDocumentError([
          `لا يوجد سعر صرف معتمد للعملة ${invoice.currency} بتاريخ ${invoice.date}؛ لا يمكن ترحيل الفاتورة.`,
        ]);
      }
      fx = { rate: found.rate, baseCurrency };
    }

    let posting = buildInvoicePosting(invoice, deps.accounts, fx);

    let billings: ReceiptLineBilling[][] | null = null;
    let latePostings: PurchaseGlPosting[] = [];
    if (invoice.receiptId) {
      const receipt = await deps.receipts?.findById(invoice.receiptId);
      if (receipt) {
        if (goodsReceiptInvoicingStatus(receipt) === GoodsReceiptInvoicingStatus.Invoiced) {
          throw new GoodsReceiptAlreadyInvoicedError(invoice.receiptId, GoodsReceiptInvoicedRefusal.SecondInvoice);
        }
        billings = billInvoiceAgainstReceipt(invoice.lines, receipt);
        if (deps.accounts.goodsReceivedNotInvoicedAccountId !== undefined) {
          const carried = await carryReceiptCostVariance(invoice, receipt, billings, fx?.rate ?? null, deps.stock, nowIso(deps).slice(0, 10));
          posting = buildInvoicePosting(invoice, deps.accounts, fx, carried.variance);
          latePostings = lateVariancePostings(invoice, deps.accounts, carried.late);
        }
      }
    }
    // ORDER MATTERS: a manual invoice (no prior receipt) IS the stock-in
    // document, and its goods enter stock before its entry is posted — what
    // they levelled of a back-order is booked in that same entry. Both sit in
    // this one transaction, so a refused entry takes the stock back with it.
    if (!invoice.receiptId) {
      // The stock ledger keeps every cost in BASE currency, because GL 1200
      // does and the two must reconcile. Receiving a foreign invoice at its
      // own unit cost put the sub-ledger 48,350.00 below its control account
      // on a single 1,000 USD invoice — the GL had already converted.
      const stockLines = invoice.lines
        .filter((l) => l.kind === "inventory" && l.itemId !== null)
        .flatMap((l) =>
          baseReceiptLines(l.qty, l.unitCost, fx?.rate).map((part) => ({
            itemId: l.itemId as string,
            qty: part.qty,
            unitCost: part.unitCost,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
          })),
        );
      if (stockLines.length > 0) {
        const received = await deps.stock.postReceipt({
          receiptId: invoice.id,
          receiptNumber: invoice.number,
          warehouseId: invoice.warehouseId,
          sourceDocType: "PURCHASE_INVOICE",
          lines: stockLines,
          occurredAt: occurredAtFromDocumentDate(invoice.date),
        });
        const cover = backOrderCoverLines(received.coverVariance, deps.accounts, { projectId: invoice.projectId ?? null, branchId: invoice.branchId ?? null });
        if (cover.length > 0) posting = { ...posting, lines: [...posting.lines, ...cover] };
      }
    }
    await deps.gl.post(posting);
    for (const late of latePostings) await deps.gl.post(late);

    if (invoice.receiptId && deps.receipts && billings) {
      await billGoodsReceipt(invoice.receiptId, billings.flat(), { receipts: deps.receipts });
    }

    const billedLines = billings ? invoice.lines.map((line, index) => ({ ...line, receiptBillings: (billings as ReceiptLineBilling[][])[index] ?? [] })) : invoice.lines;
    const next: PurchaseInvoice = { ...invoice, lines: billedLines, status: "confirmed", fxRate: fx?.rate ?? null };
    assertDocumentWritten(
      await deps.invoices.writeFields(next, [PurchaseInvoiceField.Status, PurchaseInvoiceField.FxRate, ...(billings ? [PurchaseInvoiceField.Lines] : [])], { status: invoice.status }),
      PURCHASE_INVOICE_DOC_TYPE,
      next.id,
    );

    if (deps.allocatable) {
      await deps.allocatable.save({
        id: next.id,
        invoiceNo: next.number,
        kind: "purchase",
        partyId: next.supplierId,
        date: next.date,
        // BASE currency: a supplier payment settles in base, and GL 2100 holds
        // base — storing the document's own USD figure made a foreign invoice
        // look settled by a fraction of what it owes (D24).
        total: purchaseInvoiceBaseTotal(next),
        allocated: Money.zero(),
      });
    }
    await recordPurchaseAudit(deps, "PURCHASE_INVOICE", "CONFIRM", {
      invoiceId: next.id,
      number: next.number,
      supplierId: next.supplierId,
      receiptId: next.receiptId,
      status: next.status,
      total: purchaseInvoiceTotal(next).toString(),
    }, next.id);
    return { confirmed: next, posting };
  });

  return { invoice: confirmed, posting };
}

/**
 * إلغاء الفاتورة (Cancel invoice) — docs/archive/catalog/09 §"تتبع البضاعة المستهلكة
 * من فواتير الشراء": a draft invoice (no GL/stock effect yet) cancels
 * trivially. A confirmed invoice may be cancelled too — UNLESS
 * `trackSoldPurchaseItems` is on and any of its inventory-line goods have
 * since been sold, transferred, or consumed, in which case it must be
 * corrected via a Purchase Return instead. Cancelling a confirmed invoice
 * mirror-reverses its GL posting and — for a MANUAL invoice only (a
 * from-receipt invoice's stock belongs to the receipt, not the invoice) —
 * reverses the stock it posted.
 */
export async function cancelPurchaseInvoice(
  id: string,
  deps: CancelPurchaseInvoiceDeps,
  options: { readonly date?: string } = {},
): Promise<PurchaseInvoice> {
  const policy = deps.policy ?? DEFAULT_PURCHASE_POLICY;

  return atomically(deps, async () => {
  // INVARIANT: read and guarded inside the transaction, so the reversal mirrors
  // the entry's tax tags as they stand and the write below moves only the status.
  const invoice = await deps.invoices.findById(id);
  if (!invoice) throw new PurchaseInvoiceNotFoundError(id);
  if (invoice.status === "cancelled") {
    throw new PurchaseDocumentNotDraftError(id, invoice.status);
  }

  if (options.date !== undefined && options.date < invoice.date) {
    throw new ReversalDateBeforeOriginalError(id, options.date, invoice.date);
  }
  const today = nowIso(deps).slice(0, 10);
  const cancelDate = options.date ?? (today < invoice.date ? invoice.date : today);

  if (invoice.status === "confirmed") {
    const standing = (await deps.landedCostsStandingOn?.(invoice.id)) ?? [];
    if (standing.length > 0) throw new LandedCostStandsOnDocumentError(invoice.id, standing);
  }
  if (invoice.status === "confirmed") {
    await deps.cancelGuard?.(invoice);
    const inventoryLines = invoice.lines.filter((l) => l.kind === "inventory" && l.itemId !== null);
    const sourceReceipt = invoice.receiptId ? ((await deps.receipts?.findById(invoice.receiptId)) ?? null) : null;
    const tracked = inventoryLines.some((l) => l.receiptBillings !== undefined);
    const positions = sourceReceipt && !tracked
      ? distinctPositions(sourceReceipt.lines.map((l) => ({ itemId: l.itemId, warehouseId: sourceReceipt.warehouseId })))
      : distinctPositions(inventoryLines.map((l) => ({ itemId: l.itemId as string, warehouseId: sourceReceipt?.warehouseId ?? invoice.warehouseId })));
    const layerOwnerId = invoice.receiptId ?? invoice.id;
    if (policy.trackSoldPurchaseItems) {
      for (const position of positions) {
        const layers = await deps.layers.listByPosition(position.itemId, position.warehouseId);
        if (receiptLayersConsumed(layers, layerOwnerId)) throw new PurchaseItemsAlreadyConsumedError(id);
      }
    }

    // A from-receipt invoice never posted its own stock (the receipt did) — see confirmPurchaseInvoice.
    let unmirrored = Money.zero();
    if (!invoice.receiptId && inventoryLines.length > 0) {
      const taken = await deps.stock.reverseReceipt({
        reversalId: purchaseInvoiceCancelEntryId(invoice.id),
        sourceDocType: "PURCHASE_INVOICE",
        sourceDocId: invoice.id,
        positions,
        occurredAt: occurredAtFromDocumentDate(cancelDate),
      });
      unmirrored = taken.unmirroredValue;
    }

    if (sourceReceipt && deps.stock.reverseReceiptCostVariance) {
      const takenBack = await deps.stock.reverseReceiptCostVariance({
        varianceDocId: invoice.id,
        reversalId: purchaseInvoiceCancelEntryId(invoice.id),
        positions,
        occurredAt: occurredAtFromDocumentDate(cancelDate),
      });
      if (!takenBack.takenBack) throw new PurchaseItemsAlreadyConsumedError(id);
      for (const index of [0, 1, 2, 3]) {
        const suffix = `${PURCHASE_INVOICE_LATE_VARIANCE_SUFFIX}${index === 0 ? "" : index}`;
        try {
          await deps.glReverse.reverse(`${invoice.id}${suffix}`, {
            reversalId: `${purchaseInvoiceCancelEntryId(invoice.id)}${suffix}`,
            date: takenBack.occurredOn && takenBack.occurredOn > cancelDate ? takenBack.occurredOn : cancelDate,
            memo: `عكس فرق سعر فاتورة مشتريات ${invoice.number}`,
          });
        } catch (err) {
          if (!(err instanceof JournalEntryNotFoundError)) throw err;
          break;
        }
      }
    }

    await deps.glReverse.reverse(invoice.id, {
      reversalId: purchaseInvoiceCancelEntryId(invoice.id),
      date: cancelDate,
      memo: `عكس فاتورة مشتريات ${invoice.number}`,
      appendLines: cancelledReceiptStockLines(unmirrored, deps.accounts, { projectId: invoice.projectId ?? null, branchId: invoice.branchId ?? null }),
    });
    if (invoice.receiptId && deps.receipts && (await untrackedConfirmedInvoicesOnReceipt(deps.invoices, invoice.receiptId, invoice.id)).length === 0) {
      await unbillGoodsReceipt(invoice.receiptId, tracked ? inventoryLines.flatMap((l) => l.receiptBillings ?? []) : null, { receipts: deps.receipts });
    }
  }

  const cancelled: PurchaseInvoice = { ...invoice, status: "cancelled" };
  assertDocumentWritten(
    await deps.invoices.writeFields(cancelled, [PurchaseInvoiceField.Status], { status: invoice.status }),
    PURCHASE_INVOICE_DOC_TYPE,
    cancelled.id,
  );
  await recordPurchaseAudit(deps, "PURCHASE_INVOICE", "CANCEL", {
    invoiceId: cancelled.id,
    number: cancelled.number,
    supplierId: cancelled.supplierId,
    receiptId: cancelled.receiptId,
    status: cancelled.status,
    previousStatus: invoice.status,
    total: purchaseInvoiceTotal(cancelled).toString(),
  }, cancelled.id);
  return cancelled;
  });
}
