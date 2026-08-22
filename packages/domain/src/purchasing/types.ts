/**
 * Shared types + ports for the purchase chain (docs/catalog/02-purchases.md
 * §"Document chain"): أوامر الشراء (Purchase Orders) → استلام البضائع (Goods
 * Receipts) → فواتير المشتريات (Purchase Invoices).
 *
 * The three document types are built on the shared engines (numbering, workflow,
 * the costing/stock-ledger engine, and the GL posting engine) and depend on
 * PORTS only — never on SQL, HTTP, or a specific driver (docs/plan.md §3.2).
 * The GL posting port mirrors the inventory engine's `InventoryGlPostingPort`:
 * the purchase chain builds a balanced Dr/Cr posting and hands it off, so it
 * never imports the accounting module directly.
 */

import type { Money } from "../money/index.js";
import type { PostReceiptCommand } from "../inventory/index.js";

/** أمر الشراء lifecycle (docs/catalog/02 §Purchase Orders §Workflows/statuses). */
export type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "fully_received"
  | "cancelled";

/** إيصال الاستلام lifecycle (docs/catalog/02 §Goods Receipts). */
export type GoodsReceiptStatus = "draft" | "confirmed" | "cancelled";

/** فاتورة المشتريات lifecycle (docs/catalog/02 §Purchase Invoices). */
export type PurchaseInvoiceStatus = "draft" | "confirmed" | "cancelled";

/**
 * The two purchase-strictness gates (docs/catalog/02 — "the two strictness
 * gates exist as settings but default off"). Threaded through the create/confirm
 * use-cases; both default OFF so the manual paths work out of the box.
 */
export interface PurchasePolicy {
  /** Require a confirmed goods receipt before a purchase invoice may be created. */
  readonly requireReceiptForInvoice: boolean;
  /** Block a goods receipt from receiving more than the PO's outstanding qty. */
  readonly blockOverReceipt: boolean;
}

export const DEFAULT_PURCHASE_POLICY: PurchasePolicy = {
  requireReceiptForInvoice: false,
  blockOverReceipt: false,
};

// --- GL posting hook (no import of the accounting module) -------------------

export interface PurchaseGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
}

/**
 * A balanced posting the purchase-invoice confirm step hands to whoever posts
 * to the GL (Σ debit === Σ credit): Dr Inventory (+ Dr Freight for expense
 * lines) + Dr Input VAT / Cr Accounts Payable.
 */
export interface PurchaseGlPosting {
  readonly sourceDocType: "PURCHASE_INVOICE";
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly PurchaseGlPostingLine[];
}

export interface PurchaseGlPostingPort {
  post(posting: PurchaseGlPosting): Promise<void>;
}

/**
 * GL account mapping for a purchase-invoice posting. Supplied per confirm (the
 * API derives it from item/tenant defaults); the domain never hardcodes ids.
 */
export interface PurchaseGlAccounts {
  readonly inventoryAccountId: string;
  readonly payableAccountId: string;
  readonly taxAccountId: string;
  /** Booked for freight/expense lines (مصروف شحن); falls back to inventory when absent. */
  readonly freightAccountId?: string;
}

/**
 * The stock IN hook the chain uses for goods receipts and manual purchase
 * invoices. `StockLedgerService` satisfies this structurally via its
 * `postReceipt` method (the costing/stock-ledger engine).
 */
export interface PurchaseStockPostingPort {
  postReceipt(command: PostReceiptCommand): Promise<void>;
}
