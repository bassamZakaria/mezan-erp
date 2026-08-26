/**
 * فاتورة المشتريات (Purchase Invoice) — the AP document (docs/catalog/02
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

import { Money, Qty } from "../money/index.js";
import type { AllocatableInvoiceRepository } from "../vouchers/allocation.js";
import { extend, occurredAtFromDocumentDate, type CostLayerRepository } from "../inventory/index.js";
import { convertToBase } from "../exchange-rates/convert.js";
import { NextNumberService } from "../numbering/index.js";
import type { GoodsReceipt, GoodsReceiptRepository } from "./goods-receipt.js";
import { markGoodsReceiptInvoiced } from "./goods-receipt.js";
import { recordPurchaseAudit, type PurchaseAuditDeps } from "./audit.js";
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
  /** Supplier lot this delivery arrived under. Absent for non-tracked goods. */
  readonly batchNo?: string | null;
  /** ISO-8601 expiry of the received goods; drives FEFO consumption. Absent for non-perishables. */
  readonly expiryDate?: string | null;
}

export interface PurchaseInvoice {
  readonly id: string;
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

export interface PurchaseInvoiceRepository {
  findById(id: string): Promise<PurchaseInvoice | null>;
  list(): Promise<PurchaseInvoice[]>;
  create(invoice: PurchaseInvoice): Promise<void>;
  update(invoice: PurchaseInvoice): Promise<void>;
}

export interface PurchaseInvoiceLineInput {
  readonly itemId?: string | null;
  readonly description?: string | null;
  readonly kind?: PurchaseInvoiceLineKind;
  readonly qty: Qty;
  readonly unitCost: Money;
  readonly taxRatePercent?: number;
  readonly batchNo?: string | null;
  readonly expiryDate?: string | null;
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
  readonly createdBy?: string;
  readonly lines: readonly PurchaseInvoiceLineInput[];
}

export interface CreatePurchaseInvoiceDeps {
  readonly invoices: PurchaseInvoiceRepository;
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
  readonly invoices: PurchaseInvoiceRepository;
  readonly stock: PurchaseStockPostingPort;
  readonly glReverse: PurchaseGlReversalPort;
  readonly layers: CostLayerRepository;
  readonly policy?: PurchasePolicy;
  readonly now?: () => string;
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
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
  const rate = invoice.fxRate;
  if (!rate) return purchaseInvoiceTotal(invoice);
  // Converted component by component, in the same order `buildInvoicePosting`
  // uses — converting the sum instead can land a rounding unit away from what
  // the control account actually holds.
  return convertToBase(purchaseInvoiceInventoryBase(invoice), rate)
    .add(convertToBase(purchaseInvoiceFreightBase(invoice), rate))
    .add(convertToBase(purchaseInvoiceExpenseBase(invoice), rate))
    .add(convertToBase(purchaseInvoiceTax(invoice), rate));
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
): PurchaseInvoiceLine[] {
  return receipt.lines.map((l) => ({
    itemId: l.itemId,
    description: l.description,
    kind: "inventory" as const,
    qty: l.qty,
    unitCost: l.unitCost,
    taxRatePercent: resolveTaxRate(l.itemId),
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
  }));
}

function normalizeLines(
  lines: readonly PurchaseInvoiceLineInput[],
): PurchaseInvoiceLine[] {
  return lines.map((l) => {
    const kind = l.kind ?? "inventory";
    return {
      itemId: kind === "expense" ? (l.itemId ?? null) : (l.itemId ?? null),
      description: l.description ?? null,
      kind,
      qty: l.qty,
      unitCost: l.unitCost,
      taxRatePercent: l.taxRatePercent ?? 0,
      batchNo: l.batchNo ?? null,
      expiryDate: l.expiryDate ?? null,
    };
  });
}

function validate(lines: readonly PurchaseInvoiceLine[], supplierId: string): void {
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
  });
  if (reasons.length > 0) throw new InvalidPurchaseDocumentError(reasons);
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
  if (command.receiptId && deps.receipts) {
    const receipt = await deps.receipts.findById(command.receiptId);
    if (!receipt) throw new GoodsReceiptNotFoundError(command.receiptId);
    if (receipt.status !== "confirmed") {
      throw new InvalidPurchaseDocumentError([
        `goods receipt "${command.receiptId}" is "${receipt.status}"; only a confirmed receipt can be invoiced`,
      ]);
    }
    // Only the status was checked, never this flag — so a second invoice
    // against the same receipt was accepted and posted a duplicate Dr
    // Inventory with no matching stock movement.
    if (receipt.invoiced) throw new GoodsReceiptAlreadyInvoicedError(command.receiptId);
  }
  if (await deps.invoices.findById(command.id)) {
    throw new DuplicatePurchaseDocumentError(command.id);
  }

  const lines = normalizeLines(command.lines);
  validate(lines, command.supplierId);

  const number = await deps.numbering.next(PURCHASE_INVOICE_SEQUENCE, { branchId: command.branchId });
  const invoice: PurchaseInvoice = {
    id: command.id,
    number: number.formatted,
    fxRate: null,
    supplierId: command.supplierId,
    date: command.date,
    dueDate: command.dueDate ?? null,
    supplierInvoiceNumber: command.supplierInvoiceNumber ?? null,
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

/** Build the balanced Dr/Cr posting for a confirmed invoice (pure). */
export function buildInvoicePosting(
  invoice: PurchaseInvoice,
  accounts: PurchaseGlAccounts,
  fx?: { readonly rate: string; readonly baseCurrency: string },
): PurchaseGlPosting {
  // Line amounts are entered in the DOCUMENT's currency. When that is not the
  // base currency they are converted here, once, at the rate that applied on
  // the invoice's date — and the payable line keeps the currency and rate, so
  // the FX revaluation engine can restate the debt later. Without this a
  // `currency: "USD"` invoice credited 2100 with its USD figure as though it
  // were EGP, understating the payable by the whole rate (D24).
  const foreign = fx !== undefined;
  const convert = (amount: Money): Money => (foreign ? convertToBase(amount, fx.rate) : amount);

  const inventoryBase = convert(purchaseInvoiceInventoryBase(invoice));
  const freightBase = convert(purchaseInvoiceFreightBase(invoice));
  const expenseBase = convert(purchaseInvoiceExpenseBase(invoice));
  const tax = convert(purchaseInvoiceTax(invoice));
  const payable = inventoryBase.add(freightBase).add(expenseBase).add(tax);
  const freightAccountId = accounts.freightAccountId ?? accounts.inventoryAccountId;
  const expenseAccountId = accounts.expenseAccountId ?? freightAccountId;
  const fxTag = foreign ? { currency: invoice.currency, fxRate: fx.rate } : {};

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
    const clearsGrni = invoice.receiptId !== null && accounts.goodsReceivedNotInvoicedAccountId !== undefined;
    lines.push({
      accountId: clearsGrni ? (accounts.goodsReceivedNotInvoicedAccountId as string) : accounts.inventoryAccountId,
      debit: inventoryBase,
      credit: Money.zero(),
    });
  }
  if (freightBase.scaled !== 0n) {
    lines.push({ accountId: freightAccountId, debit: freightBase, credit: Money.zero() });
  }
  if (expenseBase.scaled !== 0n) {
    lines.push({ accountId: expenseAccountId, debit: expenseBase, credit: Money.zero() });
  }
  if (tax.scaled !== 0n) {
    lines.push({ accountId: accounts.taxAccountId, debit: tax, credit: Money.zero() });
  }
  lines.push({ accountId: accounts.payableAccountId, debit: Money.zero(), credit: payable, ...fxTag });

  return {
    sourceDocType: "PURCHASE_INVOICE",
    sourceDocId: invoice.id,
    sourceDocNumber: invoice.number,
    date: invoice.date,
    memo: `فاتورة مشتريات ${invoice.number}`,
    lines,
  };
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

  // The GL goes FIRST, and this ordering is load-bearing: there is no
  // transaction around this confirm, so whatever runs before a refusal stays
  // applied. Posting first means a closed period, an inactive account or an
  // unbalanced entry leaves nothing behind; with the stock move first, a
  // refused confirm left the inventory sub-ledger permanently ahead of GL 1200
  // with no document to explain it (D21). The reverse risk does not exist here:
  // a purchase invoice's movement is always a receipt IN, which no stock policy
  // can refuse.
  const posting = buildInvoicePosting(invoice, deps.accounts, fx);
  await deps.gl.post(posting);

  // Manual invoice (no prior receipt): the invoice IS the stock-in document.
  if (!invoice.receiptId) {
    const stockLines = invoice.lines
      .filter((l) => l.kind === "inventory" && l.itemId !== null)
      .map((l) => ({
        itemId: l.itemId as string,
        qty: l.qty,
        // The stock ledger keeps every cost in BASE currency, because GL 1200
        // does and the two must reconcile. Receiving a foreign invoice at its
        // own unit cost put the sub-ledger 48,350.00 below its control account
        // on a single 1,000 USD invoice — the GL had already converted.
        unitCost: fx ? convertToBase(l.unitCost, fx.rate) : l.unitCost,
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
      }));
    if (stockLines.length > 0) {
      await deps.stock.postReceipt({
        receiptId: invoice.id,
        receiptNumber: invoice.number,
        warehouseId: invoice.warehouseId,
        sourceDocType: "PURCHASE_INVOICE",
        lines: stockLines,
        occurredAt: occurredAtFromDocumentDate(invoice.date),
      });
    }
  }

  if (invoice.receiptId && deps.receipts) {
    await markGoodsReceiptInvoiced(invoice.receiptId, { receipts: deps.receipts });
  }

  const confirmed: PurchaseInvoice = { ...invoice, status: "confirmed", fxRate: fx?.rate ?? null };
  await deps.invoices.update(confirmed);

  if (deps.allocatable) {
    await deps.allocatable.save({
      id: confirmed.id,
      invoiceNo: confirmed.number,
      kind: "purchase",
      partyId: confirmed.supplierId,
      date: confirmed.date,
      // BASE currency: a supplier payment settles in base, and GL 2100 holds
      // base — storing the document's own USD figure made a foreign invoice
      // look settled by a fraction of what it owes (D24).
      total: purchaseInvoiceBaseTotal(confirmed),
      allocated: Money.zero(),
    });
  }

  await recordPurchaseAudit(deps, "PURCHASE_INVOICE", "CONFIRM", {
    invoiceId: confirmed.id,
    number: confirmed.number,
    supplierId: confirmed.supplierId,
    receiptId: confirmed.receiptId,
    status: confirmed.status,
    total: purchaseInvoiceTotal(confirmed).toString(),
  }, confirmed.id);

  return { invoice: confirmed, posting };
}

/**
 * إلغاء الفاتورة (Cancel invoice) — docs/catalog/09 §"تتبع البضاعة المستهلكة
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
): Promise<PurchaseInvoice> {
  const policy = deps.policy ?? DEFAULT_PURCHASE_POLICY;
  const invoice = await deps.invoices.findById(id);
  if (!invoice) throw new PurchaseInvoiceNotFoundError(id);
  if (invoice.status === "cancelled") {
    throw new PurchaseDocumentNotDraftError(id, invoice.status);
  }

  if (invoice.status === "confirmed") {
    const inventoryLines = invoice.lines.filter((l) => l.kind === "inventory" && l.itemId !== null);
    if (policy.trackSoldPurchaseItems) {
      for (const line of inventoryLines) {
        const layers = await deps.layers.listByPosition(line.itemId as string, invoice.warehouseId);
        const consumed = layers
          .filter((l) => l.sourceDocId === invoice.id)
          .some((l) => l.remainingQty.compare(l.originalQty) !== 0);
        if (consumed) throw new PurchaseItemsAlreadyConsumedError(id);
      }
    }

    await deps.glReverse.reverse(invoice.id, {
      reversalId: `${invoice.id}:cancel`,
      date: nowIso(deps),
      memo: `عكس فاتورة مشتريات ${invoice.number}`,
    });

    // A from-receipt invoice never posted its own stock (the receipt did) — see confirmPurchaseInvoice.
    if (!invoice.receiptId && inventoryLines.length > 0) {
      await deps.stock.reverseReceipt({
        reversalId: `${invoice.id}:cancel`,
        sourceDocType: "PURCHASE_INVOICE",
        sourceDocId: invoice.id,
        positions: inventoryLines.map((l) => ({
          itemId: l.itemId as string,
          warehouseId: invoice.warehouseId,
        })),
        occurredAt: occurredAtFromDocumentDate(invoice.date),
      });
    }
  }

  const cancelled: PurchaseInvoice = { ...invoice, status: "cancelled" };
  await deps.invoices.update(cancelled);
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
}
