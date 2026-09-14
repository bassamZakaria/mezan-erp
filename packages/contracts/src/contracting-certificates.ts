import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { boqUnitSchema, vatBasisSchema } from "./contracting-contracts.js";

/**
 * Wire contract for المستخلص — the progress certificate (design §04).
 *
 * Only two kinds of figure are accepted from a caller: this period's quantity
 * per BOQ line, and the four manual CUMULATIVE deduction amounts. Everything
 * else on these responses — the previous cumulative, the contracted quantity,
 * every deduction, the VAT and the net payable — is derived by the server and
 * is read-only on the wire.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ يجب أن يكون بصيغة YYYY-MM-DD");
const qtyString = z.string().regex(/^-?\d{1,18}(\.\d{1,6})?$/, "الكمية يجب أن تكون رقمًا عشريًا");

export const progressCertificateStatusSchema = z.enum([
  "draft",
  "measured",
  "certified",
  "approved_for_payment",
  "invoiced",
  "cancelled",
  "voided",
]);
export type ProgressCertificateStatusDTO = z.infer<typeof progressCertificateStatusSchema>;

/** `collected` is derived from the generated invoice's remaining balance, never stored. */
export const progressCertificateDerivedStatusSchema = z.enum([
  "draft",
  "measured",
  "certified",
  "approved_for_payment",
  "invoiced",
  "collected",
  "cancelled",
  "voided",
]);
export type ProgressCertificateDerivedStatusDTO = z.infer<typeof progressCertificateDerivedStatusSchema>;

export const certificateDeductionKeySchema = z.enum([
  "retention",
  "advanceRecovery",
  "socialInsurance",
  "withholdingTax",
  "penalties",
  "suspended",
  "employerMaterials",
  "waterElectricity",
  "stampDuty",
]);
export type CertificateDeductionKeyDTO = z.infer<typeof certificateDeductionKeySchema>;

export const certificateDeductionRowSchema = z.object({
  key: certificateDeductionKeySchema,
  labelAr: z.string(),
  percent: z.string().nullable(),
  cumulative: moneyString,
  previous: moneyString,
  thisCertificate: moneyString,
  posted: z.boolean(),
  capped: z.boolean(),
  /** «تأمين نهائي بخطاب ضمان» on a Law 182/2018 contract, where the row reads zero by design. */
  noteAr: z.string().nullable(),
});
export type CertificateDeductionRowDTO = z.infer<typeof certificateDeductionRowSchema>;

export const certificateComputationSchema = z.object({
  grossWorks: moneyString,
  materialsOnSite: moneyString,
  certificateTotal: moneyString,
  tenderDiscountPercent: z.string(),
  tenderDiscount: moneyString,
  netCertified: moneyString,
  previousNetCertified: moneyString,
  thisCertificateNetCertified: moneyString,
  deductions: z.array(certificateDeductionRowSchema),
  deductionsThisCertificate: moneyString,
  deductionsCumulative: moneyString,
  suspendedBalance: moneyString,
  invoiceBase: moneyString,
  vatBasis: vatBasisSchema,
  vatStatutoryRatePercent: z.string(),
  vatEffectiveRatePercent: z.string(),
  vat: moneyString,
  previousPayments: moneyString,
  netPayableThisCertificate: moneyString,
  cumulativeNetPayable: moneyString,
  contractValueAfterVariations: moneyString,
  completionPercent: z.string(),
  retentionHeldCumulative: moneyString,
  advanceReceived: moneyString,
  advanceOutstanding: moneyString,
});
export type CertificateComputationDTO = z.infer<typeof certificateComputationSchema>;

export const certificateWorkLineSchema = z.object({
  id: z.string(),
  boqLineId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  unit: boqUnitSchema,
  unitRate: moneyString,
  thisPeriodQty: qtyString,
  previousCumulativeQty: qtyString,
  cumulativeQty: qtyString,
  contractedQty: qtyString,
  completionPercent: z.string(),
  previousCumulativeValue: moneyString,
  cumulativeValue: moneyString,
  thisPeriodValue: moneyString,
  sortOrder: z.number(),
});
export type CertificateWorkLineDTO = z.infer<typeof certificateWorkLineSchema>;

export const certificateMaterialLineSchema = z.object({
  id: z.string(),
  materialKey: z.string(),
  descriptionAr: z.string(),
  unit: boqUnitSchema,
  qty: qtyString,
  unitRate: moneyString,
  previousCumulativeQty: qtyString,
  cumulativeQty: qtyString,
  value: moneyString,
  previousValue: moneyString,
  sortOrder: z.number(),
});
export type CertificateMaterialLineDTO = z.infer<typeof certificateMaterialLineSchema>;

export const certificateInvoiceStatusSchema = z.object({
  invoiceId: z.string(),
  docNo: z.string().nullable(),
  total: moneyString,
  amountPaid: moneyString,
  remainingBalance: moneyString,
  dueDate: z.string().nullable(),
  status: z.string(),
});
export type CertificateInvoiceStatusDTO = z.infer<typeof certificateInvoiceStatusSchema>;

export const progressCertificateSchema = z.object({
  id: z.string(),
  docNo: z.string(),
  contractId: z.string(),
  contractDocNo: z.string(),
  contractTitleAr: z.string(),
  customerId: z.string(),
  projectId: z.string(),
  serial: z.number().int(),
  previousCertificateId: z.string().nullable(),
  periodFrom: isoDate,
  periodTo: isoDate,
  executionDate: isoDate,
  isFinal: z.boolean(),
  status: progressCertificateStatusSchema,
  derivedStatus: progressCertificateDerivedStatusSchema,
  preparedBy: z.string().nullable(),
  preparedAt: z.string().nullable(),
  measuredBy: z.string().nullable(),
  measuredAt: z.string().nullable(),
  certifiedBy: z.string().nullable(),
  certifiedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelReasonAr: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidedBy: z.string().nullable(),
  voidReasonAr: z.string().nullable(),
  voidJournalEntryId: z.string().nullable(),
  invoiceId: z.string().nullable(),
  invoiceDocNo: z.string().nullable(),
  journalEntryId: z.string().nullable(),
  postedDeductionsTotal: moneyString,
  dueDate: z.string().nullable(),
  penaltiesCumulative: moneyString,
  suspendedCumulative: moneyString,
  employerMaterialsCumulative: moneyString,
  waterElectricityCumulative: moneyString,
  notes: z.string().nullable(),
  workLines: z.array(certificateWorkLineSchema),
  materialLines: z.array(certificateMaterialLineSchema),
  computed: certificateComputationSchema,
  invoice: certificateInvoiceStatusSchema.nullable(),
  daysOverdue: z.number(),
  latePaymentCompensation: moneyString,
  /** «غير مُعد» when the tenant has not set the CBE credit-and-discount rate. */
  cbeCreditDiscountRatePercent: z.string().nullable(),
  hasLaterCertificate: z.boolean(),
});
export type ProgressCertificateDTO = z.infer<typeof progressCertificateSchema>;

export const certificateWorkLineInputSchema = z.object({
  boqLineId: z.string().min(1),
  thisPeriodQty: qtyString,
});
export type CertificateWorkLineInputDTO = z.infer<typeof certificateWorkLineInputSchema>;

export const certificateMaterialLineInputSchema = z.object({
  materialKey: z.string().min(1),
  descriptionAr: z.string().min(1),
  unit: boqUnitSchema,
  qty: qtyString,
  unitRate: nonNegativeMoneyString,
});
export type CertificateMaterialLineInputDTO = z.infer<typeof certificateMaterialLineInputSchema>;

const draftBody = {
  periodFrom: isoDate,
  periodTo: isoDate,
  executionDate: isoDate.nullish(),
  isFinal: z.boolean().optional(),
  workLines: z.array(certificateWorkLineInputSchema).optional(),
  materialLines: z.array(certificateMaterialLineInputSchema).optional(),
  penaltiesCumulative: nonNegativeMoneyString.optional(),
  suspendedCumulative: nonNegativeMoneyString.optional(),
  employerMaterialsCumulative: nonNegativeMoneyString.optional(),
  waterElectricityCumulative: nonNegativeMoneyString.optional(),
  notes: z.string().nullish(),
};

export const createProgressCertificateSchema = z.object({
  id: z.string().min(1),
  contractId: z.string().min(1),
  ...draftBody,
});
export type CreateProgressCertificateDTO = z.infer<typeof createProgressCertificateSchema>;

export const updateProgressCertificateSchema = z.object({
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  executionDate: isoDate.nullish(),
  isFinal: z.boolean().optional(),
  workLines: z.array(certificateWorkLineInputSchema).optional(),
  materialLines: z.array(certificateMaterialLineInputSchema).optional(),
  penaltiesCumulative: nonNegativeMoneyString.optional(),
  suspendedCumulative: nonNegativeMoneyString.optional(),
  employerMaterialsCumulative: nonNegativeMoneyString.optional(),
  waterElectricityCumulative: nonNegativeMoneyString.optional(),
  notes: z.string().nullish(),
});
export type UpdateProgressCertificateDTO = z.infer<typeof updateProgressCertificateSchema>;

/** Nothing is persisted: the draft goes in, the computed block comes back. */
export const previewProgressCertificateSchema = z.object({
  contractId: z.string().min(1),
  certificateId: z.string().nullish(),
  ...draftBody,
});
export type PreviewProgressCertificateDTO = z.infer<typeof previewProgressCertificateSchema>;

export const progressCertificatePreviewSchema = z.object({
  serial: z.number().int(),
  executionDate: isoDate,
  workLines: z.array(certificateWorkLineSchema),
  materialLines: z.array(certificateMaterialLineSchema),
  computed: certificateComputationSchema,
  /** Why the certificate would be refused at حصر — shown live, never at the last click. */
  refusals: z.array(z.string()),
});
export type ProgressCertificatePreviewDTO = z.infer<typeof progressCertificatePreviewSchema>;

export const approveProgressCertificateSchema = z.object({
  approvedAt: isoDate,
});
export type ApproveProgressCertificateDTO = z.infer<typeof approveProgressCertificateSchema>;

/**
 * حصر / اعتماد الاستشاري carry their OWN date. Stamping today() made the three
 * signature dates unorderable — a certificate for August could be measured,
 * certified and cleared in an order the dates could not tell apart.
 */
export const measureProgressCertificateSchema = z.object({
  measuredAt: isoDate.optional(),
});
export type MeasureProgressCertificateDTO = z.infer<typeof measureProgressCertificateSchema>;

export const certifyProgressCertificateSchema = z.object({
  certifiedAt: isoDate.optional(),
});
export type CertifyProgressCertificateDTO = z.infer<typeof certifyProgressCertificateSchema>;

/** A cancelled certificate with no stated reason is unauditable. */
export const cancelProgressCertificateSchema = z.object({
  reasonAr: z.string().min(1, "سبب الإلغاء مطلوب"),
});
export type CancelProgressCertificateDTO = z.infer<typeof cancelProgressCertificateSchema>;

/** إلغاء مستخلص معتمد — a reversal, and it carries the date it posts into. */
export const voidProgressCertificateSchema = z.object({
  date: isoDate,
  reasonAr: z.string().min(1, "سبب الإلغاء مطلوب"),
});
export type VoidProgressCertificateDTO = z.infer<typeof voidProgressCertificateSchema>;

export const internalCertificateRowSchema = z.object({
  boqLineId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  unit: boqUnitSchema,
  cumulativeQty: qtyString,
  estimatedUnitCost: moneyString.nullable(),
  estimatedCost: moneyString,
  sellingValue: moneyString,
  lineMargin: moneyString,
  lineMarginPercent: z.string(),
});
export type InternalCertificateRowDTO = z.infer<typeof internalCertificateRowSchema>;

export const internalCertificateSchema = z.object({
  contractId: z.string(),
  contractDocNo: z.string(),
  projectId: z.string(),
  asOfCertificateId: z.string().nullable(),
  asOfDocNo: z.string().nullable(),
  asOfSerial: z.number().nullable(),
  rows: z.array(internalCertificateRowSchema),
  totals: z.object({
    estimatedCost: moneyString,
    sellingValue: moneyString,
    margin: moneyString,
    marginPercent: z.string(),
  }),
  projectActual: z
    .object({
      cost: moneyString,
      revenue: moneyString,
      byCategory: z.record(z.string(), moneyString),
    })
    .nullable(),
  actualCostNoteAr: z.string(),
});
export type InternalCertificateDTO = z.infer<typeof internalCertificateSchema>;
