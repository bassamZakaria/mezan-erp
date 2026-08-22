/**
 * Sales Invoice — the document that deducts stock and books a customer
 * receivable (docs/catalog/01-sales.md §"فواتير المبيعات").
 *
 * It builds ON the document framework: it reuses the framework's lifecycle
 * concepts (draft → confirmed → …), its GL / stock / numbering / workflow hook
 * ports, the journal-entry GL adapter and the workflow-gate adapter, and the
 * "تأثيرات هذا المستند" effects descriptor. What it can't borrow from the
 * generic `FrameworkDocument` is a home for its rich header (customer,
 * warehouse, due date, invoice-level discount, GL account mapping) and its
 * payment statuses (مدفوع جزئياً / مدفوع) — so the sales invoice is its own
 * aggregate with its own status set, orchestrated by {@link SalesInvoiceService}.
 *
 * Every monetary amount is a scaled-int `Money`; quantities are `Qty`. The
 * document layer never imports the GL or stock engines directly — the service
 * binds them behind the framework's hook ports.
 */

import { Money, Qty } from "../money/index.js";

/**
 * Sales-invoice lifecycle. A superset of the framework's document statuses: the
 * shared draft → confirmed → cancelled/reversed shape plus the sub-ledger
 * payment states the catalog documents (مدفوع جزئياً, مدفوع). `overdue` is NOT
 * a stored status — it's derived from the due date on an unpaid confirmed
 * invoice (see {@link isOverdue}).
 */
export type SalesInvoiceStatus =
  | "draft"
  | "pending"
  | "confirmed"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "reversed";

/** Statuses in which the invoice is live in the ledger / AR sub-ledger. */
export const SALES_INVOICE_ACTIVE_STATUSES: ReadonlySet<SalesInvoiceStatus> = new Set([
  "confirmed",
  "partially_paid",
  "paid",
]);

/** Terminal statuses — no further transition is possible. */
export const SALES_INVOICE_TERMINAL_STATUSES: ReadonlySet<SalesInvoiceStatus> = new Set([
  "cancelled",
  "reversed",
]);

export type SalesInvoiceDiscountType = "percent" | "amount";

/** An invoice-level discount: a percentage of the post-line-discount subtotal, or a fixed amount. */
export type SalesInvoiceDiscount =
  | { readonly type: "percent"; readonly percent: number }
  | { readonly type: "amount"; readonly amount: Money };

/** One line of a sales invoice. */
export interface SalesInvoiceLine {
  readonly lineId: string;
  readonly itemId: string;
  /** Snapshot of the item name at invoice time (for print / history). */
  readonly itemNameAr: string;
  /** Whether this line moves inventory (a stock item) vs. a service line. */
  readonly isStock: boolean;
  readonly qty: Qty;
  readonly unitPrice: Money;
  /** Line-level discount percentage (0–100). */
  readonly discountPercent: number;
  /** Output VAT percentage applied to this line (0 for exempt). */
  readonly taxRatePercent: number;
  /** Revenue GL account this line credits on confirm. */
  readonly revenueAccountId: string;
  /** COGS GL account (stock lines only). */
  readonly cogsAccountId: string | null;
  /** Inventory GL account credited for COGS (stock lines only). */
  readonly inventoryAccountId: string | null;
  /**
   * Moving-average unit cost captured when the line was issued on confirm
   * (null while draft). Retained so the detail view can show التكلفة / الربح.
   */
  readonly unitCost: Money | null;
}

export interface SalesInvoice {
  readonly id: string;
  readonly docType: "SALES_INVOICE";
  /** Sequential number (INV-…) stamped on confirm; null while draft/pending. */
  readonly docNo: string | null;
  readonly status: SalesInvoiceStatus;
  /** ISO date (YYYY-MM-DD) the invoice is dated into — drives the period gate. */
  readonly date: string;
  /** ISO date the balance is due (drives the overdue flag). */
  readonly dueDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  /** Whether the customer is tax-exempt — forces every line's tax to zero. */
  readonly customerTaxExempt: boolean;
  readonly warehouseId: string;
  readonly branchId: string;
  readonly currency: string;
  /** Customer-facing notes (printed). */
  readonly notes: string | null;
  /** Internal notes (not printed). */
  readonly internalNotes: string | null;
  readonly discount: SalesInvoiceDiscount;
  /** Accounts-receivable control account debited on confirm. */
  readonly arAccountId: string;
  /** Output-VAT payable account credited on confirm. */
  readonly taxAccountId: string;
  readonly lines: readonly SalesInvoiceLine[];
  /** Amount collected so far (drives partially_paid / paid). */
  readonly amountPaid: Money;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
  /** Journal entry posted on confirm (null while draft). */
  readonly journalEntryId: string | null;
  /** Workflow request id while held بانتظار الموافقة (pending). */
  readonly workflowRequestId: string | null;
  readonly reversesInvoiceId: string | null;
  readonly reversedByInvoiceId: string | null;
}

/** Whether the invoice is live (its effects have been applied to the ledger). */
export function isSalesInvoiceActive(status: SalesInvoiceStatus): boolean {
  return SALES_INVOICE_ACTIVE_STATUSES.has(status);
}

/** Whether the invoice is in a terminal (cancelled/reversed) status. */
export function isSalesInvoiceTerminal(status: SalesInvoiceStatus): boolean {
  return SALES_INVOICE_TERMINAL_STATUSES.has(status);
}

/**
 * Derived متأخر (overdue) flag: a live, not-fully-paid invoice whose due date is
 * before `today` (ISO YYYY-MM-DD). Overdue is presentation-only — never stored.
 */
export function isOverdue(invoice: SalesInvoice, today: string): boolean {
  return (
    (invoice.status === "confirmed" || invoice.status === "partially_paid") &&
    invoice.dueDate < today
  );
}

/** The Arabic status label shown on the status pill (docs/catalog/01). */
export const SALES_INVOICE_STATUS_LABELS_AR: Record<SalesInvoiceStatus, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  confirmed: "مؤكد",
  partially_paid: "مدفوع جزئياً",
  paid: "مدفوع",
  cancelled: "ملغي",
  reversed: "معكوس",
};
