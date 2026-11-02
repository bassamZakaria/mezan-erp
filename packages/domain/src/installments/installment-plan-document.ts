/**
 * Installment Plan as a document-framework consumer (docs/archive/catalog/05
 * §"خطط الأقساط"): splits an existing sales invoice's balance into a
 * scheduled series of payments. Posts nothing to the GL and moves no stock —
 * collecting an installment is a Treasury cash-voucher concern, out of this
 * PR's scope (docs/archive/catalog/01: "لا استرداد/تحصيل تلقائي" pattern repeats
 * here) — so this type declares neither `buildGlPosting` nor `buildStockPlan`
 * and plugs into the plain `DocumentService` directly (no wrapper service
 * needed, unlike landed cost).
 */

import { Money } from "../money/index.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import { InvalidDocumentError } from "../documents/errors.js";
import type { InstallmentFrequency } from "./schedule.js";

export const DOC_TYPE = "INSTALLMENT_PLAN";

/** docs/archive/catalog/05 status filter tabs, restricted to the per-installment (line-level) states. */
export const INSTALLMENT_LINE_STATUSES = ["pending", "paid", "overdue", "cancelled"] as const;
export type InstallmentLineStatus = (typeof INSTALLMENT_LINE_STATUSES)[number];

/** One scheduled installment. Denormalized with plan-wide fields — see `sales-returns/sales-return-document.ts`'s doc-comment for why. */
export interface InstallmentLine {
  readonly no: number;
  readonly customerId: string;
  readonly sourceInvoiceId: string;
  readonly sourceInvoiceNumber: string | null;
  readonly frequency: InstallmentFrequency;
  readonly downPayment: Money;
  readonly dueDate: string;
  readonly amount: Money;
  readonly paidAmount: Money;
  readonly status: InstallmentLineStatus;
  /** STUB — always zero until product defines the late-fee rule; see `overdue.ts`. */
  readonly lateFeeAmount: Money;
}

export type InstallmentPlanDocument = FrameworkDocument<InstallmentLine>;

function totals(lines: readonly InstallmentLine[]) {
  const scheduled = Money.sum(lines.map((l) => l.amount));
  const paid = Money.sum(lines.map((l) => l.paidAmount));
  const downPayment = lines[0]?.downPayment ?? Money.zero();
  return { scheduled, paid, downPayment, grandTotal: scheduled.add(downPayment) };
}

export const installmentPlanDocumentType: DocumentTypeDefinition<InstallmentLine> = {
  code: DOC_TYPE,
  labelAr: "خطة أقساط",
  confirmedStatus: "confirmed",
  numberingSequence: "INSTALLMENT_PLAN",
  gateActionType: null, // no dedicated gate action exists in the 26-entry catalog for installment plans

  validate(doc) {
    if (doc.lines.length === 0) {
      throw new InvalidDocumentError(DOC_TYPE, doc.id, "خطة الأقساط تتطلب قسطاً واحداً على الأقل.", "An installment plan needs at least one installment.");
    }
    const invoiceId = doc.lines[0]?.sourceInvoiceId;
    let previousDue = "";
    for (const line of doc.lines) {
      if (line.sourceInvoiceId !== invoiceId) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل أقساط الخطة يجب أن تنتمي لنفس الفاتورة.", "All installments of the plan must belong to the same invoice.");
      }
      if (line.amount.scaled <= 0n) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `القسط رقم ${line.no}: القيمة يجب أن تكون أكبر من صفر.`, `Installment no. ${line.no}: the amount must be greater than zero.`);
      }
      if (line.dueDate < previousDue) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, "تواريخ استحقاق الأقساط يجب أن تكون متتالية تصاعدياً.", "Installment due dates must be in ascending order.");
      }
      previousDue = line.dueDate;
    }
  },

  /**
   * Cancelling the plan cancels what is still OWED. A line the customer has
   * already paid stays paid — the money moved, and erasing it would drop the
   * paid total the treasury receipt reconciles against. Without this the
   * document read ملغاة while every one of its installments stayed
   * قيد الاستحقاق, so `/plans/stats` reported a dead plan's full scheduled
   * and remaining amounts as live money (D120).
   */
  onCancel(doc) {
    return doc.lines.map((line) =>
      line.status === "paid" || line.paidAmount.scaled > 0n ? line : { ...line, status: "cancelled" as const },
    );
  },

  describeEffects(doc): DocumentEffects {
    const { scheduled, downPayment, grandTotal } = totals(doc.lines);
    return buildEffects({
      blocked: doc.lines.length === 0,
      blockedReason: doc.lines.length === 0 ? "لا يوجد أقساط في الخطة." : undefined,
      blockedReasonEn: doc.lines.length === 0 ? "The plan has no installments." : undefined,
      effects: [
        {
          kind: "info",
          description: `ينشئ جدول سداد من ${doc.lines.length} قسط`,
          detail: `بإجمالي ${scheduled.toString()}${downPayment.scaled > 0n ? ` + دفعة مقدمة ${downPayment.toString()}` : ""} (إجمالي الفاتورة ${grandTotal.toString()})`,
        },
        {
          kind: "info",
          description: "لا يسجل أي تحصيل تلقائياً — كل قسط يحصَّل عبر سند قبض خزينة منفصل عند استحقاقه",
        },
      ],
    });
  },
};
