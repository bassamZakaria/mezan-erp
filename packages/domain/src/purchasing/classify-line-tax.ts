import { AuditSeverityCode, recordSensitiveEvent } from "../audit/index.js";
import {
  JournalLineSide,
  planTaxClassification,
  TaxClassificationAuditAction,
  TaxClassificationAuditEntity,
  TaxClassificationAuditModule,
  TaxClassificationJournalUntaggedError,
  TaxClassificationNotASupplyError,
  TaxClassificationNotPostedError,
  TaxClassificationStaleError,
  type ClassifyPostedLineTaxRequest,
  type UntaggedJournalLineSelector,
  type TaxClassificationPlan,
  type TaxRateRepository,
} from "../tax-rates/index.js";
import { isRetentionRelease } from "../documents/invoice-document-kind.js";
import { atomically, type PurchaseAuditDeps } from "./audit.js";
import { PurchaseInvoiceNotFoundError } from "./errors.js";
import type { PurchaseInvoice, PurchaseInvoiceRepository } from "./purchase-invoice.js";
import { PurchaseInvoiceStatusCode } from "./types.js";

export const PURCHASE_INVOICE_STATUS_LABELS_AR: Readonly<Record<PurchaseInvoiceStatusCode, string>> = {
  [PurchaseInvoiceStatusCode.Draft]: "مسودة",
  [PurchaseInvoiceStatusCode.Confirmed]: "مؤكدة",
  [PurchaseInvoiceStatusCode.Cancelled]: "ملغاة",
};

/** Names the rate on the invoice's posted journal lines; the composition root knows which entry is the invoice's. */
export interface PurchaseInvoiceTaxTagPort {
  retagUnnamedTaxRate(invoiceId: string, taxRatePercent: number, taxRateId: string, untagged?: UntaggedJournalLineSelector): Promise<number>;
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
  // INVARIANT: the read, the plan and both writes share ONE transaction, and
  // the invoice is written by `nameLineTaxRate` alone — never `update`.
  return atomically(deps, async () => {
    const existing = await deps.invoices.findById(id);
    if (!existing) throw new PurchaseInvoiceNotFoundError(id);
    if (existing.status !== PurchaseInvoiceStatusCode.Confirmed) {
      throw new TaxClassificationNotPostedError(PURCHASE_INVOICE_STATUS_LABELS_AR[existing.status]);
    }
    if (isRetentionRelease(existing)) throw new TaxClassificationNotASupplyError(existing.number);
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
    // ORDER MATTERS: the journal goes first — it is what refuses a filed VAT
    // period, and it must refuse before the invoice line is written.
    let journalLinesNamed = 0;
    if (deps.taxTags) {
      journalLinesNamed = await deps.taxTags.retagUnnamedTaxRate(
        existing.id,
        plan.before.taxRatePercent,
        request.taxRateId,
        plan.lineRefs.length === existing.lines.length ? { side: JournalLineSide.Debit } : undefined,
      );
      if (journalLinesNamed === 0) throw new TaxClassificationJournalUntaggedError(existing.number);
    }
    const linesNamed = await deps.invoices.nameLineTaxRate(existing.id, plan.lineRefs.map(Number), plan.before.taxRatePercent, request.taxRateId);
    if (linesNamed !== plan.lineRefs.length) throw new TaxClassificationStaleError(existing.number);
    const invoice = (await deps.invoices.findById(id)) as PurchaseInvoice;
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: TaxClassificationAuditModule.Purchases,
        entityType: TaxClassificationAuditEntity.PurchaseInvoice,
        entityId: invoice.id,
        action: TaxClassificationAuditAction.ClassifyLineTax,
        actor: deps.actor ?? "system",
        branchId: invoice.branchId ?? null,
        severity: AuditSeverityCode.Warning,
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
