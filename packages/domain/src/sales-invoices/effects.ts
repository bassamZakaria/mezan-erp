/**
 * "تأثيرات هذه الفاتورة" — the sales-invoice effects descriptor.
 *
 * Reuses the document framework's {@link buildEffects} / {@link DocumentEffects}
 * so the @mezan/ui effects panel renders it exactly as it does for journal
 * entries. Computing it is a pure function of the invoice + its totals: it drives
 * the panel, the confirm gate (an empty or zero-total invoice is `blocked`), and
 * the tests identically. It never performs I/O.
 */

import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import type { SalesInvoice } from "./sales-invoice.js";
import type { SalesInvoiceTotals } from "./totals.js";

export function describeSalesInvoiceEffects(
  invoice: SalesInvoice,
  totals: SalesInvoiceTotals,
): DocumentEffects {
  const hasLines = invoice.lines.length > 0;
  const positiveTotal = totals.grandTotal.scaled > 0n;
  const blocked = !hasLines || !positiveTotal;
  const stockLineCount = invoice.lines.filter((l) => l.isStock).length;

  return buildEffects({
    blocked,
    blockedReason: !hasLines
      ? "الفاتورة لا تحتوي على بنود."
      : !positiveTotal
        ? "إجمالي الفاتورة يجب أن يكون أكبر من صفر."
        : undefined,
    effects: [
      {
        kind: "balance",
        description: `زيادة رصيد العميل (المدينون) بمبلغ ${totals.grandTotal.toString()}`,
        detail: `${invoice.customerNameAr}`,
      },
      {
        kind: "gl",
        description: "ترحيل قيد محاسبي: مدين المدينون / دائن الإيرادات" +
          (totals.taxTotal.scaled !== 0n ? " وضريبة القيمة المضافة" : ""),
        detail: `إيرادات ${totals.taxableTotal.toString()}` +
          (totals.taxTotal.scaled !== 0n ? ` + ضريبة ${totals.taxTotal.toString()}` : ""),
      },
      ...(stockLineCount > 0
        ? [
            {
              kind: "stock" as const,
              description: `خصم المخزون وتسجيل تكلفة البضاعة المباعة لعدد ${stockLineCount} صنف`,
              detail: "مدين تكلفة البضاعة المباعة / دائن المخزون",
            },
          ]
        : []),
      {
        kind: "info",
        description: "لا يتم التحصيل تلقائياً — استخدم سند تحصيل لإنشاء دفعة",
      },
    ],
    totalDebit: totals.grandTotal,
    totalCredit: totals.grandTotal,
    balanced: true,
  });
}
