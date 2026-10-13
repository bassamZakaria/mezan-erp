import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { boqUnitSchema, vatBasisSchema } from "./contracting-contracts.js";
import { certificateComputationSchema } from "./contracting-certificates.js";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contract for عقود الباطن ومستخلصات مقاولي الباطن — slice 3 of
 * المقاولات (design §03 "THE MIRROR", D-04, D-05).
 *
 * Only two kinds of figure are accepted from a caller: this period's quantity
 * per subcontract line, and the four manual CUMULATIVE deduction amounts.
 * Everything else — the previous cumulative, the client's certified ceiling,
 * the whole deductions block, the advance paid and the retention held — is
 * derived by the server and is read-only on the wire.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ يجب أن يكون بصيغة YYYY-MM-DD");
const qtyString = z.string().regex(/^-?\d{1,18}(\.\d{1,6})?$/, "الكمية يجب أن تكون رقمًا عشريًا");
const percentString = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "النسبة يجب أن تكون رقمًا عشريًا موجبًا");

export const subcontractStatusSchema = z.enum(["draft", "active", "completed", "terminated"]);
export type SubcontractStatusDTO = z.infer<typeof subcontractStatusSchema>;

export const subcontractKindSchema = z.enum(["works", "labour_only"]);
export type SubcontractKindDTO = z.infer<typeof subcontractKindSchema>;

export const subCertificateStatusSchema = z.enum([
  "draft",
  "measured",
  "certified",
  "approved_for_payment",
  "invoiced",
  "cancelled",
]);
export type SubCertificateStatusDTO = z.infer<typeof subCertificateStatusSchema>;

/** `paid` is derived from the generated purchase invoice's remaining balance, never stored. */
export const subCertificateDerivedStatusSchema = z.enum([
  "draft",
  "measured",
  "certified",
  "approved_for_payment",
  "invoiced",
  "paid",
  "cancelled",
]);
export type SubCertificateDerivedStatusDTO = z.infer<typeof subCertificateDerivedStatusSchema>;

export const subcontractLineSchema = z.object({
  id: z.string(),
  subcontractId: z.string(),
  clientBoqLineId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  unit: boqUnitSchema,
  qty: qtyString,
  unitRate: moneyString,
  clientUnitRate: moneyString,
  marginVsClient: moneyString,
  estimatedUnitCost: moneyString.nullable(),
  sortOrder: z.number(),
});
export type SubcontractLineDTO = z.infer<typeof subcontractLineSchema>;

export const subcontractAdvanceSchema = z.object({
  voucherId: z.string(),
  voucherNo: z.string().nullable(),
  date: isoDate,
  amount: moneyString,
});
export type SubcontractAdvanceDTO = z.infer<typeof subcontractAdvanceSchema>;

export const subcontractRetentionReleaseKindSchema = z.enum(["provisional", "final"]);
export type SubcontractRetentionReleaseKindDTO = z.infer<typeof subcontractRetentionReleaseKindSchema>;

export const subcontractRetentionReleaseSchema = z.object({
  id: z.string(),
  date: isoDate,
  amount: moneyString,
  journalEntryId: z.string(),
  kind: subcontractRetentionReleaseKindSchema,
  /** completionDate for `provisional`, completionDate + فترة الضمان for `final`. */
  releaseEventDate: z.string().nullable(),
  earlyRelease: z.boolean(),
  /** The purchase invoice the release was raised as — what a voucher pays. */
  invoiceId: z.string().nullable(),
  invoiceDocNo: z.string().nullable(),
  releasedBy: z.string().nullable(),
  notes: z.string().nullable(),
});
export type SubcontractRetentionReleaseDTO = z.infer<typeof subcontractRetentionReleaseSchema>;

export const subcontractRetentionSchema = z.object({
  held: moneyString,
  released: moneyString,
  balance: moneyString,
  /** The completion date the release clock hangs on; null until the package is completed. */
  completionDate: z.string().nullable(),
  defectsLiabilityMonths: z.number().int(),
  provisionalReleaseEventDate: z.string().nullable(),
  finalReleaseEventDate: z.string().nullable(),
  releases: z.array(subcontractRetentionReleaseSchema),
});
export type SubcontractRetentionDTO = z.infer<typeof subcontractRetentionSchema>;

export const subcontractSchema = z.object({
  id: z.string(),
  docNo: z.string(),
  contractId: z.string(),
  contractDocNo: z.string(),
  contractTitleAr: z.string(),
  projectId: z.string(),
  supplierId: z.string(),
  supplierNameAr: z.string(),
  titleAr: z.string(),
  kind: subcontractKindSchema,
  disguisedEmploymentReviewed: z.boolean(),
  reviewNote: z.string().nullable(),
  signedDate: isoDate,
  startDate: isoDate,
  plannedEndDate: isoDate,
  currency: z.string(),
  status: subcontractStatusSchema,
  activatedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  terminatedAt: z.string().nullable(),
  notes: z.string().nullable(),
  retentionPercent: z.string(),
  retentionCapPercent: z.string().nullable(),
  advancePercent: z.string(),
  advanceRecoveryPercent: z.string(),
  withholdingTaxPercent: z.string(),
  deemedWagePercent: z.string(),
  socialInsuranceRatePercent: z.string(),
  withholdSocialInsurance: z.boolean(),
  socialInsuranceNote: z.string().nullable(),
  penaltyCapPercent: z.string(),
  paymentTermDays: z.number().int(),
  defectsLiabilityMonths: z.number().int(),
  vatBasis: vatBasisSchema,
  lines: z.array(subcontractLineSchema),
  advances: z.array(subcontractAdvanceSchema),
  /** Σ qty × the sub's rate. */
  value: moneyString,
  /** The same quantities at the CLIENT's rates. */
  clientValue: moneyString,
  margin: moneyString,
  advancePaid: moneyString,
  advanceRecovered: moneyString,
  advanceOutstanding: moneyString,
  retention: subcontractRetentionSchema,
  /** Cumulative net certified on the latest POSTED certificate. */
  certifiedToDate: moneyString,
  /** value − certifiedToDate — the commitment still ahead of the contractor. */
  remainingCommitment: moneyString,
  certificateCount: z.number().int(),
  /** Why the subcontract cannot be activated or certified yet. Empty when it can. */
  payabilityRefusals: z.array(z.string()),
});
export type SubcontractDTO = z.infer<typeof subcontractSchema>;

export const subcontractLineInputSchema = z.object({
  id: clientSuppliedId.nullish(),
  clientBoqLineId: z.string().min(1, "بند جدول الكميات مطلوب"),
  descriptionAr: z.string().nullish(),
  qty: qtyString,
  unitRate: nonNegativeMoneyString,
  estimatedUnitCost: nonNegativeMoneyString.nullish(),
});
export type SubcontractLineInputDTO = z.infer<typeof subcontractLineInputSchema>;

const termsShape = {
  retentionPercent: percentString.optional(),
  retentionCapPercent: percentString.nullish(),
  advancePercent: percentString.optional(),
  advanceRecoveryPercent: percentString.optional(),
  withholdingTaxPercent: percentString.optional(),
  deemedWagePercent: percentString.optional(),
  socialInsuranceRatePercent: percentString.optional(),
  withholdSocialInsurance: z.boolean().optional(),
  socialInsuranceNote: z.string().nullish(),
  penaltyCapPercent: percentString.optional(),
  paymentTermDays: z.number().int().min(0).max(3650).optional(),
  defectsLiabilityMonths: z.number().int().min(0).max(600).optional(),
  vatBasis: vatBasisSchema.optional(),
};

export const createSubcontractSchema = z.object({
  id: clientSuppliedId,
  contractId: z.string().min(1),
  supplierId: z.string().min(1, "مقاول الباطن مطلوب"),
  titleAr: z.string().min(1, "اسم عقد الباطن مطلوب"),
  kind: subcontractKindSchema.optional(),
  disguisedEmploymentReviewed: z.boolean().optional(),
  reviewNote: z.string().nullish(),
  signedDate: isoDate,
  startDate: isoDate,
  plannedEndDate: isoDate,
  notes: z.string().nullish(),
  lines: z.array(subcontractLineInputSchema).optional(),
  ...termsShape,
});
export type CreateSubcontractDTO = z.infer<typeof createSubcontractSchema>;

export const updateSubcontractSchema = z.object({
  supplierId: z.string().min(1).optional(),
  titleAr: z.string().min(1).optional(),
  kind: subcontractKindSchema.optional(),
  disguisedEmploymentReviewed: z.boolean().optional(),
  reviewNote: z.string().nullish(),
  signedDate: isoDate.optional(),
  startDate: isoDate.optional(),
  plannedEndDate: isoDate.optional(),
  notes: z.string().nullish(),
  ...termsShape,
});
export type UpdateSubcontractDTO = z.infer<typeof updateSubcontractSchema>;

export const replaceSubcontractLinesSchema = z.object({
  lines: z.array(subcontractLineInputSchema),
});
export type ReplaceSubcontractLinesDTO = z.infer<typeof replaceSubcontractLinesSchema>;

export const activateSubcontractSchema = z.object({ activatedAt: isoDate });
export const completeSubcontractSchema = z.object({ completedAt: isoDate });
export const terminateSubcontractSchema = z.object({
  terminatedAt: isoDate,
  reason: z.string().nullish(),
});

/** Links an ALREADY-CONFIRMED payment voucher; the server reads its amount. */
export const linkSubcontractAdvanceSchema = z.object({ voucherId: z.string().min(1) });
export type LinkSubcontractAdvanceDTO = z.infer<typeof linkSubcontractAdvanceSchema>;

export const releaseSubcontractRetentionSchema = z.object({
  amount: nonNegativeMoneyString,
  date: isoDate,
  kind: subcontractRetentionReleaseKindSchema.optional(),
  notes: z.string().nullish(),
});
export type ReleaseSubcontractRetentionDTO = z.infer<typeof releaseSubcontractRetentionSchema>;

export const subCertificateWorkLineSchema = z.object({
  id: z.string(),
  subcontractLineId: z.string(),
  clientBoqLineId: z.string(),
  /** What the consultant has certified to the EMPLOYER on the client line — the ceiling. */
  clientCertifiedCumulativeQty: qtyString,
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
export type SubCertificateWorkLineDTO = z.infer<typeof subCertificateWorkLineSchema>;

export const subCertificateInvoiceStatusSchema = z.object({
  invoiceId: z.string(),
  docNo: z.string().nullable(),
  total: moneyString,
  amountPaid: moneyString,
  remainingBalance: moneyString,
  dueDate: z.string().nullable(),
  status: z.string(),
});
export type SubCertificateInvoiceStatusDTO = z.infer<typeof subCertificateInvoiceStatusSchema>;

export const subCertificateSchema = z.object({
  id: z.string(),
  docNo: z.string(),
  subcontractId: z.string(),
  subcontractDocNo: z.string(),
  subcontractTitleAr: z.string(),
  contractId: z.string(),
  contractDocNo: z.string(),
  projectId: z.string(),
  supplierId: z.string(),
  supplierNameAr: z.string(),
  /** الرقم الضريبي لمقاول الباطن — both parties' numbers appear on the printed sheet. */
  supplierTaxNumber: z.string().nullable(),
  serial: z.number().int(),
  previousCertificateId: z.string().nullable(),
  periodFrom: isoDate,
  periodTo: isoDate,
  executionDate: isoDate,
  isFinal: z.boolean(),
  status: subCertificateStatusSchema,
  derivedStatus: subCertificateDerivedStatusSchema,
  preparedBy: z.string().nullable(),
  preparedAt: z.string().nullable(),
  measuredBy: z.string().nullable(),
  measuredAt: z.string().nullable(),
  certifiedBy: z.string().nullable(),
  certifiedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReasonAr: z.string().nullable(),
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
  workLines: z.array(subCertificateWorkLineSchema),
  computed: certificateComputationSchema,
  invoice: subCertificateInvoiceStatusSchema.nullable(),
  hasLaterCertificate: z.boolean(),
  payabilityRefusals: z.array(z.string()),
});
export type SubCertificateDTO = z.infer<typeof subCertificateSchema>;

export const subCertificateWorkLineInputSchema = z.object({
  subcontractLineId: z.string().min(1),
  thisPeriodQty: qtyString,
});
export type SubCertificateWorkLineInputDTO = z.infer<typeof subCertificateWorkLineInputSchema>;

const subDraftBody = {
  periodFrom: isoDate,
  periodTo: isoDate,
  executionDate: isoDate.nullish(),
  isFinal: z.boolean().optional(),
  workLines: z.array(subCertificateWorkLineInputSchema).optional(),
  penaltiesCumulative: nonNegativeMoneyString.optional(),
  suspendedCumulative: nonNegativeMoneyString.optional(),
  employerMaterialsCumulative: nonNegativeMoneyString.optional(),
  waterElectricityCumulative: nonNegativeMoneyString.optional(),
  notes: z.string().nullish(),
};

export const createSubCertificateSchema = z.object({
  id: clientSuppliedId,
  subcontractId: z.string().min(1),
  ...subDraftBody,
});
export type CreateSubCertificateDTO = z.infer<typeof createSubCertificateSchema>;

export const updateSubCertificateSchema = z.object({
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  executionDate: isoDate.nullish(),
  isFinal: z.boolean().optional(),
  workLines: z.array(subCertificateWorkLineInputSchema).optional(),
  penaltiesCumulative: nonNegativeMoneyString.optional(),
  suspendedCumulative: nonNegativeMoneyString.optional(),
  employerMaterialsCumulative: nonNegativeMoneyString.optional(),
  waterElectricityCumulative: nonNegativeMoneyString.optional(),
  notes: z.string().nullish(),
});
export type UpdateSubCertificateDTO = z.infer<typeof updateSubCertificateSchema>;

/** Nothing is persisted: the draft goes in, the computed block comes back. */
export const previewSubCertificateSchema = z.object({
  subcontractId: z.string().min(1),
  certificateId: z.string().nullish(),
  ...subDraftBody,
});
export type PreviewSubCertificateDTO = z.infer<typeof previewSubCertificateSchema>;

export const subCertificatePreviewSchema = z.object({
  serial: z.number().int(),
  executionDate: isoDate,
  workLines: z.array(subCertificateWorkLineSchema),
  computed: certificateComputationSchema,
  /** Why the certificate would be refused at حصر — shown live, never at the last click. */
  refusals: z.array(z.string()),
  /** Σ of the confirmed site consumptions that name this subcontract — overridable. */
  employerMaterialsPrefill: moneyString,
});
export type SubCertificatePreviewDTO = z.infer<typeof subCertificatePreviewSchema>;

export const approveSubCertificateSchema = z.object({ approvedAt: isoDate });
export type ApproveSubCertificateDTO = z.infer<typeof approveSubCertificateSchema>;

/** The date the measurement was actually taken; defaults to today when omitted. */
export const measureSubCertificateSchema = z.object({ measuredAt: isoDate.nullish() });
export type MeasureSubCertificateDTO = z.infer<typeof measureSubCertificateSchema>;

export const certifySubCertificateSchema = z.object({ certifiedAt: isoDate.nullish() });
export type CertifySubCertificateDTO = z.infer<typeof certifySubCertificateSchema>;

/** سبب الإلغاء is mandatory: a cancelled certificate with no reason is untraceable. */
export const cancelSubCertificateSchema = z.object({
  reasonAr: z.string().min(1, "سبب إلغاء المستخلص مطلوب"),
});
export type CancelSubCertificateDTO = z.infer<typeof cancelSubCertificateSchema>;
