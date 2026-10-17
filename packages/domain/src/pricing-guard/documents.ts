import type { SalesQuote } from "../sales-quotes/sales-quote.js";
import type { SalesQuoteTotals } from "../sales-quotes/totals.js";
import { Money } from "../money/index.js";
import { PricingGuardDocType, type PricingGuardDocumentInput } from "./types.js";

export function quotePricingGuardInput(quote: Pick<SalesQuote, "id" | "date" | "customerId" | "branchId" | "currency" | "lines">, totals: SalesQuoteTotals): PricingGuardDocumentInput {
  const netByLine = new Map(totals.lines.map((line) => [line.lineId, line.taxableBase]));
  return {
    docType: PricingGuardDocType.SalesQuote,
    docId: quote.id,
    date: quote.date,
    customerId: quote.customerId,
    branchId: quote.branchId,
    warehouseId: null,
    currency: quote.currency,
    lines: quote.lines.map((line) => ({ lineId: line.lineId, itemId: line.itemId, baseQty: line.qty, netAmount: netByLine.get(line.lineId) ?? Money.zero() })),
  };
}
