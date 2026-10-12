import type { CostCategory } from "../contracting/cost-category.js";
/**
 * Shared types + ports for the purchase chain (docs/archive/catalog/02-purchases.md
 * §"Document chain"): أوامر الشراء (Purchase Orders) → استلام البضائع (Goods
 * Receipts) → فواتير المشتريات (Purchase Invoices).
 *
 * The three document types are built on the shared engines (numbering, workflow,
 * the costing/stock-ledger engine, and the GL posting engine) and depend on
 * PORTS only — never on SQL, HTTP, or a specific driver (docs/archive/plan.md §3.2).
 * The GL posting port mirrors the inventory engine's `InventoryGlPostingPort`:
 * the purchase chain builds a balanced Dr/Cr posting and hands it off, so it
 * never imports the accounting module directly.
 */

import type { Money } from "../money/index.js";
import type { PostReceiptCommand, ReverseReceiptCommand } from "../inventory/index.js";

/** أمر الشراء lifecycle (docs/archive/catalog/02 §Purchase Orders §Workflows/statuses). */
export type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "fully_received"
  | "cancelled";

/** إيصال الاستلام lifecycle (docs/archive/catalog/02 §Goods Receipts). */
export type GoodsReceiptStatus = "draft" | "confirmed" | "cancelled";

/** فاتورة المشتريات lifecycle (docs/archive/catalog/02 §Purchase Invoices). */
export type PurchaseInvoiceStatus = "draft" | "confirmed" | "cancelled";

/**
 * The purchase-strictness gates (docs/archive/catalog/09 §"التحكم في المشتريات"): a
 * 3-gate procurement strictness model — PO→GRN→Invoice enforcement, plus a
 * cancellation-safety guard. Threaded through the create/confirm/cancel
 * use-cases; every gate defaults OFF (except `trackSoldPurchaseItems`, which
 * defaults ON) so the lenient/manual paths work out of the box
 * (docs/archive/catalog/09 lines 316-319).
 */
export interface PurchasePolicy {
  /**
   * Require an existing, confirmed ("sent"/"partially_received") purchase
   * order before a goods receipt may be created. OFF allows an ad-hoc receipt
   * with no `purchaseOrderId` (`requirePoForGrn` in TenantSettings).
   */
  readonly requirePoForGrn: boolean;
  /** Require a confirmed goods receipt before a purchase invoice may be created (`requireGrnForInvoice`). */
  readonly requireReceiptForInvoice: boolean;
  /** Block a goods receipt from receiving more than the PO's outstanding qty. */
  readonly blockOverReceipt: boolean;
  /**
   * Block cancelling a purchase invoice/receipt once any of its goods have
   * since been sold, transferred, or otherwise consumed (`trackSoldPurchaseItems`).
   */
  readonly trackSoldPurchaseItems: boolean;
}

export const DEFAULT_PURCHASE_POLICY: PurchasePolicy = {
  requirePoForGrn: false,
  requireReceiptForInvoice: false,
  blockOverReceipt: false,
  trackSoldPurchaseItems: true,
};

// --- GL posting hook (no import of the accounting module) -------------------

export interface PurchaseGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  /**
   * The ORIGINAL transaction currency, when it is not the base one, and the
   * rate it was converted at. `debit`/`credit` are always base-currency; these
   * two are what makes the balance revaluable later.
   *
   * The FX revaluation engine was correct end to end and no document ever set
   * these, so a `currency: "USD"` invoice posted its foreign numbers as EGP and
   * the debt was invisible to revaluation (D24).
   */
  readonly currency?: string | null;
  readonly fxRate?: string | null;
  /** بُعد المشروع — the contracting project the line belongs to (D-01). Dropped here, it is gone for good. */
  readonly projectId?: string | null;
  /** فئة التكلفة — only meaningful with `projectId`. */
  readonly costCategory?: CostCategory | null;
  /** بُعد الفرع (DEC-20) — the branch the invoice was raised in. Dropped here, it is gone for good. */
  readonly branchId?: string | null;
  /**
   * The VAT rate this line was charged at (14, 5, 0…). Carried on the input-VAT
   * line so the VAT return reports the rates actually charged instead of
   * dividing tax by base per entry (D28).
   */
  readonly taxRatePercent?: number | null;
}

/**
 * A balanced posting the purchase-invoice confirm step hands to whoever posts
 * to the GL (Σ debit === Σ credit): Dr Inventory (+ Dr Freight for expense
 * lines) + Dr Input VAT / Cr Accounts Payable.
 */
export interface PurchaseGlPosting {
  readonly sourceDocType: "PURCHASE_INVOICE" | "PURCHASE_RECEIPT";
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly PurchaseGlPostingLine[];
  readonly warehouseId?: string | null;
}

export interface PurchaseGlPostingPort {
  post(posting: PurchaseGlPosting): Promise<void>;
  /**
   * Run the whole confirm inside one atomic boundary. Without it the GL entry
   * posted first with a deterministic id and any later failure left the invoice
   * `draft` with a live entry, so every retry threw a duplicate-id refusal
   * and the invoice was permanently unconfirmable (B-7). Optional so a caller
   * that has no transactor still works, unatomically, as before.
   */
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * GL account mapping for a purchase-invoice posting. Supplied per confirm (the
 * API derives it from item/tenant defaults); the domain never hardcodes ids.
 */
export interface PurchaseGlAccounts {
  readonly inventoryAccountId: string;
  readonly payableAccountId: string;
  readonly taxAccountId: string;
  /** Booked for freight lines (مصروف شحن); falls back to inventory when absent. */
  readonly freightAccountId?: string;
  /** Booked for general purchase-expense lines (مصروف); falls back to freight, then inventory (R4.2). */
  readonly expenseAccountId?: string;
  /**
   * بضاعة واردة لم تُفوتر — credited when goods are RECEIVED and cleared when
   * they are invoiced (D53). Optional: without it a receipt posts nothing, which
   * is the behaviour that predates this and is still what an installation with
   * no such account configured must fall back to.
   */
  readonly goodsReceivedNotInvoicedAccountId?: string;
}

/**
 * The stock IN hook the chain uses for goods receipts and manual purchase
 * invoices. `StockLedgerService` satisfies this structurally via its
 * `postReceipt` method (the costing/stock-ledger engine).
 */
export interface PurchaseStockPostingPort {
  postReceipt(command: PostReceiptCommand): Promise<void>;
  /** Undo a prior `postReceipt` (cancellation). `StockLedgerService.reverseReceipt` satisfies this structurally. */
  reverseReceipt(command: ReverseReceiptCommand): Promise<void>;
}

/**
 * The GL reversal hook a confirmed purchase invoice's cancellation uses to
 * mirror-reverse its posted journal entry (docs/archive/catalog/04 — "never mutate a
 * posted entry, post a reversing one"). A separate, optional port from
 * {@link PurchaseGlPostingPort} so existing confirm-only callers are unaffected.
 */
export interface PurchaseGlReversalPort {
  reverse(
    sourceDocId: string,
    opts: { readonly reversalId: string; readonly date?: string; readonly memo?: string },
  ): Promise<void>;
}
