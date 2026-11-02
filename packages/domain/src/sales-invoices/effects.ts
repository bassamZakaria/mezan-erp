/**
 * "تأثيرات هذه الفاتورة" — the sales-invoice effects descriptor.
 *
 * Reuses the document framework's {@link buildEffects} / {@link DocumentEffects}
 * so the @mezan/ui effects panel renders it exactly as it does for journal
 * entries. Computing it is a pure function of the invoice + its totals: it drives
 * the panel, the confirm gate (an empty or zero-total invoice is `blocked`), and
 * the tests identically. It never performs I/O.
 *
 * The list is exactly three effects, always in this order — stock, then the
 * journal entry, then what happens to the customer's balance — because the
 * screen renders one card per effect and a card that appears and disappears
 * between two invoices reads as a bug rather than as a difference. A
 * service-only invoice states that it moves no stock; it does not drop the
 * card. The balance card carries the "no automatic collection" wording: it is
 * the single most common misreading of a confirmed invoice.
 */

import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import { Qty } from "../money/index.js";
import type { SalesInvoice } from "./sales-invoice.js";
import type { SalesInvoiceTotals } from "./totals.js";

export function describeSalesInvoiceEffects(
  invoice: SalesInvoice,
  totals: SalesInvoiceTotals,
): DocumentEffects {
  const hasLines = invoice.lines.length > 0;
  const positiveTotal = totals.grandTotal.scaled > 0n;
  const blocked = !hasLines || !positiveTotal;
  const stockLines = invoice.lines.filter((l) => l.isStock);
  // Base units — what actually leaves the warehouse. A line entered in cartons
  // says "5 كرتونة" on the form and issues 60 pieces here.
  const baseUnits = Qty.sum(stockLines.map((l) => l.baseQty));

  return buildEffects({
    blocked,
    blockedReason: !hasLines
      ? "الفاتورة لا تحتوي على بنود."
      : !positiveTotal
        ? "إجمالي الفاتورة يجب أن يكون أكبر من صفر."
        : undefined,
    blockedReasonEn: !hasLines
      ? "The invoice has no lines."
      : !positiveTotal
        ? "The invoice total must be greater than zero."
        : undefined,
    effects: [
      stockLines.length > 0
        ? {
            kind: "stock" as const,
            description: `خصم المخزون وتسجيل تكلفة البضاعة المباعة لعدد ${stockLines.length} صنف`,
            detail: `${baseUnits.toString()} بالوحدة الأساسية · مدين تكلفة البضاعة المباعة / دائن المخزون`,
          }
        : {
            kind: "stock" as const,
            description: "لا يتحرك المخزون — كل البنود خدمية",
          },
      {
        kind: "gl",
        description:
          "ترحيل قيد محاسبي: مدين المدينون / دائن الإيرادات" +
          (totals.taxTotal.scaled !== 0n ? " وضريبة القيمة المضافة" : ""),
        detail:
          `إيرادات ${totals.taxableTotal.toString()}` +
          (totals.taxTotal.scaled !== 0n ? ` + ضريبة ${totals.taxTotal.toString()}` : ""),
      },
      {
        kind: "balance",
        description: `زيادة رصيد العميل (المدينون) بمبلغ ${totals.grandTotal.toString()}`,
        detail: `${invoice.customerNameAr} — لا يتم التحصيل تلقائياً؛ استخدم سند تحصيل لتسجيل دفعة`,
      },
    ],
    totalDebit: totals.grandTotal,
    totalCredit: totals.grandTotal,
    balanced: true,
  });
}
