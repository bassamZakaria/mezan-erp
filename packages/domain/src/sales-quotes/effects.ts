/**
 * "تأثيرات هذا العرض" — the sales-quote effects descriptor.
 *
 * Reuses the document framework's {@link buildEffects} / {@link DocumentEffects}
 * so the @mezan/ui effects panel renders it exactly as it does for sales
 * invoices. A quote is strictly informational: it never posts to the GL and
 * never moves stock, so this descriptor exists mainly to say so explicitly —
 * plus a "balance"-kind line showing the quoted total. Computing it is a pure
 * function of the quote + its totals: it drives the panel, the send gate (an
 * empty or zero-total quote is `blocked`), and the tests identically. It never
 * performs I/O.
 */

import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import type { SalesQuote } from "./sales-quote.js";
import type { SalesQuoteTotals } from "./totals.js";

export function describeQuoteEffects(quote: SalesQuote, totals: SalesQuoteTotals): DocumentEffects {
  const hasLines = quote.lines.length > 0;
  const positiveTotal = totals.grandTotal.scaled > 0n;
  const blocked = !hasLines || !positiveTotal;

  return buildEffects({
    blocked,
    blockedReason: !hasLines
      ? "العرض لا يحتوي على بنود."
      : !positiveTotal
        ? "إجمالي العرض يجب أن يكون أكبر من صفر."
        : undefined,
    effects: [
      {
        kind: "balance",
        description: `القيمة المعروضة على العميل: ${totals.grandTotal.toString()}`,
        detail: `${quote.customerNameAr}`,
      },
      {
        kind: "info",
        description: "لا يوجد تأثير على المخزون أو رصيد العميل — العرض لا يغير أي رصيد حتى يتم تحويله لفاتورة",
      },
    ],
  });
}
