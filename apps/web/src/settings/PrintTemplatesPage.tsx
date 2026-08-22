import { useMemo } from "react";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, PrintView, createSampleInvoiceDocument } from "@mezan/ui";
import { amountInWords, EGP_WORDS } from "@mezan/domain";

/**
 * قوالب الطباعة (Print templates) — docs/catalog/09 §"قوالب الطباعة".
 *
 * Phase 8 foundation scope: the 9-tab toggle/picker editor itself is out of
 * scope (tracked for the settings pass that builds every settings screen's
 * form UI); what this page proves is the actual print pipeline — the tenant
 * default `PrintTemplateConfig` rendering a real sample فاتورة مبيعات
 * through the one shared `PrintView` renderer, with the Arabic
 * amount-in-words line computed for real via @mezan/domain's
 * `amountInWords` (not hand-written). Every other document type (quotes,
 * GRNs, vouchers, ...) reuses this same renderer once its own document
 * model is mapped.
 */
export function PrintTemplatesPage() {
  const document = useMemo(() => {
    const base = createSampleInvoiceDocument();
    return {
      ...base,
      totals: { ...base.totals, amountInWords: amountInWords(base.totals.grandTotal, EGP_WORDS) },
    };
  }, []);

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-[21px] font-bold text-ink">قوالب الطباعة</h1>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">
          معاينة حية لفاتورة مبيعات نموذجية وفق إعدادات قالب الطباعة الافتراضي.
        </p>
      </div>
      <PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={document} />
    </div>
  );
}
