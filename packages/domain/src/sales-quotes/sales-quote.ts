/**
 * Sales Quotation (عرض سعر, docs/archive/catalog/01-sales.md §"عروض الأسعار") — the
 * pre-sale document a customer is quoted before any invoice exists. It mirrors
 * the sales-invoice document shape (header + lines + a lifecycle) but is
 * strictly informational: a quote NEVER posts to the GL and NEVER moves stock.
 * Only once it is accepted and converted does a real sales invoice exist —
 * that conversion is implemented outside this module (it bridges two
 * modules), so `markConverted` here only records the fact it happened.
 *
 * Every monetary amount is a scaled-int `Money`; quantities are `Qty`.
 */

import { Money, Qty } from "../money/index.js";

export type SalesQuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "converted" | "cancelled";

/** One line of a sales quote — simpler than an invoice line: no stock/GL accounts. */
export interface SalesQuoteLine {
  readonly lineId: string;
  readonly itemId: string;
  /** Snapshot of the item name at quote time (for print / history). */
  readonly itemNameAr: string;
  readonly qty: Qty;
  readonly unitPrice: Money;
  /** Line-level discount percentage (0–100). */
  readonly discountPercent: number;
  /** Output VAT percentage applied to this line (0 for exempt). */
  readonly taxRatePercent: number;
}

export type SalesQuoteDiscountType = "percent" | "amount";

/** A quote-level discount: a percentage of the post-line-discount subtotal, or a fixed amount. */
export type SalesQuoteDiscount =
  | { readonly type: "percent"; readonly percent: number }
  | { readonly type: "amount"; readonly amount: Money };

export interface SalesQuote {
  readonly id: string;
  readonly docType: "SALES_QUOTE";
  /** Sequential number (QT-…) stamped on send; null while draft. */
  readonly docNo: string | null;
  readonly status: SalesQuoteStatus;
  /** ISO date (YYYY-MM-DD) the quote is dated into. */
  readonly date: string;
  /** ISO date the quote's pricing is valid until — drives {@link isQuoteExpired}. */
  readonly expiryDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  /** Whether the customer is tax-exempt — forces every line's tax to zero. */
  readonly customerTaxExempt: boolean;
  readonly branchId: string;
  readonly currency: string;
  /** Customer-facing notes (printed). */
  readonly notes: string | null;
  /** Internal notes (not printed). */
  readonly internalNotes: string | null;
  readonly discount: SalesQuoteDiscount;
  /** Optional price-list this quote's default prices were drawn from (informational; the Price Lists module resolves actual overrides). */
  readonly priceListId: string | null;
  /** كود الكوبون entered on the quote form. */
  readonly couponCode: string | null;
  readonly lines: readonly SalesQuoteLine[];
  readonly createdAt: string;
  readonly sentAt: string | null;
  /** Set on accept or reject. */
  readonly respondedAt: string | null;
  readonly convertedAt: string | null;
  /** Id of the sales invoice this quote was converted into (set once, on convert). */
  readonly convertedInvoiceId: string | null;
}

/**
 * Derived منتهي الصلاحية (expired) flag: a live (sent/accepted) quote whose
 * expiry date is before `today` (ISO YYYY-MM-DD). Never stored — presentation
 * / gate only, mirroring the invoice module's `isOverdue`.
 */
export function isQuoteExpired(quote: SalesQuote, today: string): boolean {
  return (quote.status === "sent" || quote.status === "accepted") && quote.expiryDate < today;
}

export const SALES_QUOTE_STATUS_LABELS_AR: Record<SalesQuoteStatus, string> = {
  draft: "مسودة",
  sent: "مرسل",
  accepted: "مقبول",
  rejected: "مرفوض",
  converted: "محول",
  cancelled: "ملغي",
};
