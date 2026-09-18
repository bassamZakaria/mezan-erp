/**
 * Sales Invoice — the document that deducts stock and books a customer
 * receivable (docs/archive/catalog/01-sales.md §"فواتير المبيعات").
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

/** A line-level discount is stated the same two ways the header one is. */
export type SalesInvoiceLineDiscountType = SalesInvoiceDiscountType;

/** One line of a sales invoice. */
export interface SalesInvoiceLine {
  readonly lineId: string;
  readonly itemId: string;
  /** Snapshot of the item name at invoice time (for print / history). */
  readonly itemNameAr: string;
  /** Whether this line moves inventory (a stock item) vs. a service line. */
  readonly isStock: boolean;
  /** The quantity as ENTERED, in {@link unitCode} — the figure the price multiplies. */
  readonly qty: Qty;
  /**
   * The unit the quantity was entered in. Empty on an invoice raised before
   * per-line units existed, which means "the item's base unit".
   */
  readonly unitCode: string;
  /** Base units per one {@link unitCode} — 1 when the line is in the base unit. */
  readonly unitFactor: number;
  /**
   * qty × unitFactor. The stock ledger moves THIS, never `qty`: a line sold in
   * cartons has to issue pieces, and COGS is derived from what actually left.
   */
  readonly baseQty: Qty;
  /** The price of one {@link unitCode}, not of one base unit. */
  readonly unitPrice: Money;
  /** Whether this line's discount is a percentage of its gross or a fixed amount. */
  readonly discountType: SalesInvoiceLineDiscountType;
  /** Line-level discount percentage (0–100) — read only when `discountType` is `percent`. */
  readonly discountPercent: number;
  /** Fixed line discount, capped at the line's gross — read only when `discountType` is `amount`. */
  readonly discountAmount: Money;
  /** Output VAT percentage applied to this line (0 for exempt). */
  readonly taxRatePercent: number;
  /** Revenue GL account this line credits on confirm. */
  readonly revenueAccountId: string;
  /** COGS GL account (stock lines only). */
  readonly cogsAccountId: string | null;
  /** Inventory GL account credited for COGS (stock lines only). */
  readonly inventoryAccountId: string | null;
  /** Cost centre this line's revenue and COGS are booked to — the Cost Centre P&L's input (D97). */
  readonly costCenterId: string | null;
  /**
   * Moving-average unit cost captured when the line was issued on confirm
   * (null while draft). Retained so the detail view can show التكلفة / الربح.
   * Stated per ENTERED unit, like `unitPrice`, so cost × qty and price × qty
   * are the same multiplication and the margin on screen ties to the GL.
   */
  readonly unitCost: Money | null;
}

/** One line's share of the promotion discount, as the engine allocated it. */
export interface AppliedPromotionLineDiscount {
  readonly lineId: string;
  /** Carried alongside `lineId` so a sales return — which references items, not line ids — can reverse the right share. */
  readonly itemId: string;
  readonly amount: Money;
}

/**
 * The promotion an invoice actually applied, captured at confirm.
 *
 * This is a VALUE SNAPSHOT, not a foreign key: `promotionId` is retained for
 * grouping only and is deliberately NOT a referential constraint. Editing or
 * deactivating a promotion — or deleting it outright — must never change what
 * a historical invoice says it granted, so every figure the usage report reads
 * (code, name, discount, per-line split) is stored here rather than resolved
 * from the live promotion row.
 */
export interface AppliedSalesInvoicePromotion {
  readonly promotionId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly couponCode: string | null;
  readonly discountTotal: Money;
  readonly lineDiscounts: readonly AppliedPromotionLineDiscount[];
  readonly appliedAt: string;
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
  /**
   * Whether this invoice's unit prices already contain the tax. Stamped from
   * the tenant's `taxCalculation` setting when the draft is raised and never
   * re-read: changing the setting must not restate an invoice that is already
   * in the books.
   */
  readonly taxInclusive: boolean;
  readonly warehouseId: string;
  readonly branchId: string;
  /**
   * The HR employee credited with the sale (`Employee.id`) — the same concept
   * a van trip's crew references. Null on invoices raised before the field
   * existed, and on any sale nobody is credited with.
   */
  readonly salespersonId: string | null;
  /** Name snapshot at draft time, like `customerNameAr` — print/history must not re-resolve it. */
  readonly salespersonNameAr: string | null;
  /** بُعد المشروع — the contracting project this invoice's revenue and COGS belong to; null when unattributed. */
  readonly projectId: string | null;
  readonly currency: string;
  /**
   * The rate this invoice was CONFIRMED at, when its currency is not the base
   * one. Stamped once, at confirm, so the receivable sub-ledger and every
   * report restate the figure the GL actually holds rather than re-deriving a
   * rate that has since moved (D24). Null for a base-currency invoice.
   */
  readonly fxRate?: string | null;
  /** Coupon the customer presented; feeds the promotion evaluation at confirm. */
  readonly couponCode: string | null;
  /** What the promotion engine actually granted at confirm; null when nothing applied. */
  readonly appliedPromotion: AppliedSalesInvoicePromotion | null;
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
  /**
   * Amount collected so far, in BASE currency (drives partially_paid / paid).
   * It mirrors the allocation sub-ledger, which is base, so it is compared with
   * `salesInvoiceBaseGrandTotal`, never with the document's own `grandTotal` (D202).
   */
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

/** The Arabic status label shown on the status pill (docs/archive/catalog/01). */
export const SALES_INVOICE_STATUS_LABELS_AR: Record<SalesInvoiceStatus, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  confirmed: "مؤكد",
  partially_paid: "مدفوع جزئياً",
  paid: "مدفوع",
  cancelled: "ملغي",
  reversed: "معكوس",
};
