import { Money, Qty, computeQuoteTotals, type SalesQuoteDiscount, type SalesQuoteLine, type SalesQuoteTotals } from "@mezan/domain";
import type { ItemDTO, TaxRateDTO } from "@mezan/contracts";
import { NO_TAX_RATE, appliedTaxPercent } from "../tax-rate-field";
import type { SalesQuoteRecord } from "../../data/hooks";
import type { AppTranslationKey } from "../../i18n";
import type { PillTone } from "@mezan/ui";
import { todayIso } from "../../lib/dates";

export type QuoteStatus = SalesQuoteRecord["status"];
/** The list's own status axis: the stored statuses plus the derived منتهي (expired). */
export type QuoteFilterKey = "all" | QuoteStatus | "expired";

export const STATUS_KEY: Record<QuoteStatus, AppTranslationKey> = {
  draft: "quotes.status.draft",
  sent: "quotes.status.sent",
  accepted: "quotes.status.accepted",
  rejected: "quotes.status.rejected",
  converted: "quotes.status.converted",
  cancelled: "quotes.status.cancelled",
};

export const STATUS_TONE: Record<QuoteStatus, PillTone> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  converted: "success",
  cancelled: "neutral",
};

export const AR_ACCOUNT_ID = "1105";
export const TAX_ACCOUNT_ID = "2200";
export const REVENUE_ACCOUNT_ID = "4100";
export const COGS_ACCOUNT_ID = "5100";
export const INVENTORY_ACCOUNT_ID = "1200";

export function today(): string {
  return todayIso();
}

export function plusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** منتهي — a live quote whose pricing validity has lapsed (mirrors the domain's `isQuoteExpired`). */
export function isExpired(quote: SalesQuoteRecord, asOf = today()): boolean {
  return (quote.status === "sent" || quote.status === "accepted") && quote.expiryDate < asOf;
}

export function daysExpired(quote: SalesQuoteRecord, asOf = today()): number {
  const ms = new Date(asOf).getTime() - new Date(quote.expiryDate).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export interface LineDraft {
  key: string;
  itemId: string;
  qty: number;
  /** null until an item is chosen — then the item's sale price, editable. */
  unitPrice: number | null;
  discountPercent: number;
  /** The tax rate picked for this line; NO_TAX_RATE leaves the item's own percent to the server. */
  taxRateId: string;
  expanded: boolean;
}

let lineSeq = 0;
export function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", qty: 1, unitPrice: null, discountPercent: 0, taxRateId: NO_TAX_RATE, expanded: false };
}

/** The draft lines that carry a real item, as domain lines the totals engine can price. */
export function toDomainLines(
  lines: readonly LineDraft[],
  items: readonly ItemDTO[],
  taxRates: readonly TaxRateDTO[],
): SalesQuoteLine[] {
  const out: SalesQuoteLine[] = [];
  for (const l of lines) {
    const item = items.find((i) => i.id === l.itemId);
    if (!item) continue;
    out.push({
      lineId: l.key,
      itemId: item.id,
      itemNameAr: item.nameAr,
      qty: Qty.fromMajor(String(l.qty || 0)),
      unitPrice: Money.fromMajor(String(l.unitPrice ?? item.salePrice ?? 0)),
      discountPercent: l.discountPercent || 0,
      taxRatePercent: appliedTaxPercent(taxRates, l.taxRateId, item.taxRatePercent),
      taxRateId: l.taxRateId === NO_TAX_RATE ? null : l.taxRateId,
    });
  }
  return out;
}

export type DiscountKind = "percent" | "amount";

export function toDomainDiscount(kind: DiscountKind, value: number): SalesQuoteDiscount {
  return kind === "percent"
    ? { type: "percent", percent: value || 0 }
    : { type: "amount", amount: Money.fromMajor(String(value || 0)) };
}

export function previewTotals(
  lines: readonly SalesQuoteLine[],
  discount: SalesQuoteDiscount,
  taxExempt: boolean,
): SalesQuoteTotals {
  return computeQuoteTotals(lines, discount, { taxExempt });
}
