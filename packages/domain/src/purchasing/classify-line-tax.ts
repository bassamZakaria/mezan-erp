import { recordSensitiveEvent } from "../audit/index.js";
import {
  planTaxClassification,
  TaxClassificationNotPostedError,
  type ClassifyPostedLineTaxRequest,
  type TaxClassificationPlan,
  type TaxRateRepository,
} from "../tax-rates/index.js";
import { atomically, type PurchaseAuditDeps } from "./audit.js";
import { PurchaseInvoiceNotFoundError } from "./errors.js";
import type { PurchaseInvoice, PurchaseInvoiceRepository } from "./purchase-invoice.js";

export const PURCHASE_INVOICE_STATUS_LABELS_AR: Readonly<Record<PurchaseInvoice["status"], string>> = {
  draft: "مسودة",
  confirmed: "مؤكدة",
  cancelled: "ملغاة",
};

/** Names the rate on the invoice's posted journal lines; the composition root knows which entry is the invoice's. */
export interface PurchaseInvoiceTaxTagPort {
  retagUnnamedTaxRate(invoiceId: string, taxRatePercent: number, taxRateId: string): Promise<number>;
}

export interface ClassifyPurchaseInvoiceLineTaxDeps extends PurchaseAuditDeps {
  readonly invoices: PurchaseInvoiceRepository;
  readonly taxRates?: Pick<TaxRateRepository, "list">;
  readonly taxTags?: PurchaseInvoiceTaxTagPort;
}

export interface ClassifyPurchaseInvoiceLineTaxResult {
  readonly invoice: PurchaseInvoice;
  readonly plan: TaxClassificationPlan;
  readonly journalLinesNamed: number;
}

/**
 * تصنيف ضريبة بند فاتورة المشتريات — the purchase twin of
 * `SalesInvoiceService.classifyLineTax`. A line is addressed by its index,
 * as a purchase return addresses it.
 *
 * INVARIANT: NULL → a rate at the line's own stored percent, on the invoice
 * line and its journal lines, in one transaction. No amount, account, date or
 * status moves, and a line that names a rate is never re-pointed.
 */
export async function classifyPurchaseInvoiceLineTax(
  id: string,
  request: ClassifyPostedLineTaxRequest,
  deps: ClassifyPurchaseInvoiceLineTaxDeps,
): Promise<ClassifyPurchaseInvoiceLineTaxResult> {
  const existing = await deps.invoices.findById(id);
  if (!existing) throw new PurchaseInvoiceNotFoundError(id);
  if (existing.status !== "confirmed") {
    throw new TaxClassificationNotPostedError(PURCHASE_INVOICE_STATUS_LABELS_AR[existing.status]);
  }
  const taxRates = deps.taxRates ? await deps.taxRates.list() : null;
  const plan = planTaxClassification(
    taxRates,
    existing.lines.map((line, index) => ({
      lineRef: String(index),
      label: line.description ?? line.itemId ?? `بند ${index + 1}`,
      stored: { taxRateId: line.taxRateId ?? null, taxRatePercent: line.taxRatePercent },
    })),
    request,
  );
  return atomically(deps, async () => {
    const classified = new Set(plan.lineRefs);
    const invoice: PurchaseInvoice = {
      ...existing,
      lines: existing.lines.map((line, index) => (classified.has(String(index)) ? { ...line, taxRateId: plan.after.taxRateId } : line)),
    };
    // ORDER MATTERS: the journal goes first — it is what refuses a filed VAT
    // period, and it must refuse before the invoice line is written.
    const journalLinesNamed = deps.taxTags
      ? await deps.taxTags.retagUnnamedTaxRate(existing.id, plan.before.taxRatePercent, request.taxRateId)
      : 0;
    await deps.invoices.update(invoice);
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: "purchases",
        entityType: "PURCHASE_INVOICE",
        entityId: invoice.id,
        action: "CLASSIFY_LINE_TAX",
        actor: deps.actor ?? "system",
        branchId: invoice.branchId ?? null,
        severity: "WARNING",
        details: {
          invoiceId: invoice.id,
          number: invoice.number,
          lineIds: plan.lineRefs,
          before: plan.before,
          after: plan.after,
          taxRateName: plan.taxRateName,
          journalLinesNamed,
        },
      });
    }
    return { invoice, plan, journalLinesNamed };
  });
}
