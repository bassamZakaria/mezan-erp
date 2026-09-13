import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { costCategorySchema } from "./contracting.js";

/**
 * Wire contracts for العقد وجدول الكميات وأوامر التغيير — slice 1 of
 * المقاولات (docs/artifacts/mezan-contracting-designs.html §03, D-08, D-10).
 *
 * Money and quantities cross as exact decimal strings; percentages cross as
 * exact decimal strings too, because every one of them is multiplied into
 * Money on a certificate and a float here would land in a posted deduction.
 * The unit list mirrors `@mezan/domain`'s `BoqUnit` by hand — the contracts
 * package cannot import the domain.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب بصيغة YYYY-MM-DD");
const percentString = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "النسبة يجب أن تكون رقمًا عشريًا موجبًا");

export const boqUnitSchema = z.enum([
  "m",
  "m2",
  "m3",
  "linear_m",
  "ton",
  "kg",
  "piece",
  "lump_sum",
  "day",
  "hour",
  "bag",
  "litre",
  "set",
]);
export type BoqUnitDTO = z.infer<typeof boqUnitSchema>;

export const worksContractStatusSchema = z.enum(["draft", "active", "completed", "terminated"]);
export type WorksContractStatusDTO = z.infer<typeof worksContractStatusSchema>;

export const worksContractTypeSchema = z.enum(["private", "public"]);
export type WorksContractTypeDTO = z.infer<typeof worksContractTypeSchema>;

export const vatBasisSchema = z.enum(["standard", "transitional"]);
export type VatBasisDTO = z.infer<typeof vatBasisSchema>;

export const recognitionPolicySchema = z.enum(["cost_to_cost", "certified_value"]);
export type RecognitionPolicyDTO = z.infer<typeof recognitionPolicySchema>;

export const variationOrderStatusSchema = z.enum(["draft", "approved", "rejected"]);
export type VariationOrderStatusDTO = z.infer<typeof variationOrderStatusSchema>;

/** الشروط التجارية — every one a per-contract parameter with a default (design §09). */
const termsShape = {
  tenderDiscountPercent: percentString.optional(),
  retentionPercent: percentString.optional(),
  retentionCapPercent: percentString.nullish(),
  advancePercent: percentString.optional(),
  advanceRecoveryPercent: percentString.optional(),
  materialsOnSitePercent: percentString.optional(),
  deemedWagePercent: percentString.optional(),
  socialInsuranceRatePercent: percentString.optional(),
  socialInsuranceNote: z.string().nullish(),
  withholdingTaxPercent: percentString.optional(),
  vatBasis: vatBasisSchema.optional(),
  paymentTermDays: z.number().int().min(0).max(3650).optional(),
  defectsLiabilityMonths: z.number().int().min(0).max(600).optional(),
  recognitionPolicy: recognitionPolicySchema.optional(),
  stampDutyPercent: percentString.optional(),
  latePenaltyPercentPerPeriod: percentString.optional(),
  latePenaltyCapPercent: percentString.optional(),
  finalSecurityPercent: percentString.optional(),
};

export const createWorksContractSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  customerId: z.string().min(1),
  titleAr: z.string().min(1, "اسم العقد مطلوب"),
  titleEn: z.string().nullish(),
  contractType: worksContractTypeSchema,
  signedDate: isoDate,
  startDate: isoDate,
  plannedEndDate: isoDate,
  currency: z.string().optional(),
  notes: z.string().nullish(),
  estimatedTotalCost: nonNegativeMoneyString.nullish(),
  ...termsShape,
});
export type CreateWorksContractDTO = z.infer<typeof createWorksContractSchema>;

export const updateWorksContractSchema = z.object({
  projectId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  titleAr: z.string().min(1).optional(),
  titleEn: z.string().nullish(),
  contractType: worksContractTypeSchema.optional(),
  signedDate: isoDate.optional(),
  startDate: isoDate.optional(),
  plannedEndDate: isoDate.optional(),
  notes: z.string().nullish(),
  estimatedTotalCost: nonNegativeMoneyString.nullish(),
  /** Required whenever `estimatedTotalCost` changes; it is written into the budget-revision log. */
  reason: z.string().optional(),
  ...termsShape,
});
export type UpdateWorksContractDTO = z.infer<typeof updateWorksContractSchema>;

export const activateWorksContractSchema = z.object({ activatedAt: isoDate });
export type ActivateWorksContractDTO = z.infer<typeof activateWorksContractSchema>;

export const completeWorksContractSchema = z.object({ completedAt: isoDate });
export type CompleteWorksContractDTO = z.infer<typeof completeWorksContractSchema>;

export const terminateWorksContractSchema = z.object({
  terminatedAt: isoDate,
  reason: z.string().nullish(),
});
export type TerminateWorksContractDTO = z.infer<typeof terminateWorksContractSchema>;

export const budgetRevisionSchema = z.object({
  date: z.string(),
  previousValue: moneyString.nullable(),
  newValue: moneyString.nullable(),
  reason: z.string(),
  userId: z.string(),
});
export type BudgetRevisionDTO = z.infer<typeof budgetRevisionSchema>;

export const worksContractSchema = z.object({
  id: z.string(),
  docNo: z.string(),
  projectId: z.string(),
  customerId: z.string(),
  titleAr: z.string(),
  titleEn: z.string().nullable(),
  contractType: worksContractTypeSchema,
  signedDate: z.string(),
  startDate: z.string(),
  plannedEndDate: z.string(),
  currency: z.string(),
  status: worksContractStatusSchema,
  activatedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  terminatedAt: z.string().nullable(),
  notes: z.string().nullable(),
  estimatedTotalCost: moneyString.nullable(),
  budgetRevisions: z.array(budgetRevisionSchema),
  tenderDiscountPercent: z.string(),
  retentionPercent: z.string(),
  retentionCapPercent: z.string().nullable(),
  advancePercent: z.string(),
  advanceRecoveryPercent: z.string(),
  materialsOnSitePercent: z.string(),
  deemedWagePercent: z.string(),
  socialInsuranceRatePercent: z.string(),
  socialInsuranceNote: z.string().nullable(),
  withholdingTaxPercent: z.string(),
  vatBasis: vatBasisSchema,
  paymentTermDays: z.number(),
  defectsLiabilityMonths: z.number(),
  recognitionPolicy: recognitionPolicySchema,
  stampDutyPercent: z.string(),
  latePenaltyPercentPerPeriod: z.string(),
  latePenaltyCapPercent: z.string(),
  finalSecurityPercent: z.string(),
  /** Server-derived, never accepted from the client (design §06). */
  contractValue: moneyString,
  approvedVariationsValue: moneyString,
  contractValueAfterVariations: moneyString,
  boqLineCount: z.number(),
  variationCount: z.number(),
  canComplete: z.boolean(),
});
export type WorksContractDTO = z.infer<typeof worksContractSchema>;

export const boqLineInputSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1, "كود البند مطلوب"),
  descriptionAr: z.string().min(1, "وصف البند مطلوب"),
  descriptionEn: z.string().nullish(),
  unit: boqUnitSchema,
  qty: nonNegativeMoneyString,
  unitRate: nonNegativeMoneyString,
  estimatedUnitCost: nonNegativeMoneyString.nullish(),
  section: z.string().nullish(),
  costCategory: costCategorySchema.nullish(),
});
export type BoqLineInputDTO = z.infer<typeof boqLineInputSchema>;

export const putBoqSchema = z.object({ lines: z.array(boqLineInputSchema) });
export type PutBoqDTO = z.infer<typeof putBoqSchema>;

export const boqLineSchema = z.object({
  id: z.string(),
  contractId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  descriptionEn: z.string().nullable(),
  unit: boqUnitSchema,
  unitLabelAr: z.string(),
  qty: moneyString,
  unitRate: moneyString,
  lineValue: moneyString,
  estimatedUnitCost: moneyString.nullable(),
  section: z.string().nullable(),
  sortOrder: z.number(),
  origin: z.enum(["base", "variation"]),
  variationOrderId: z.string().nullable(),
  costCategory: costCategorySchema.nullable(),
});
export type BoqLineDTO = z.infer<typeof boqLineSchema>;

/** A row as the client parsed it out of the workbook — every cell still a string. */
export const boqImportRowSchema = z.object({
  code: z.string().nullish(),
  descriptionAr: z.string().nullish(),
  descriptionEn: z.string().nullish(),
  unit: z.string().nullish(),
  qty: z.string().nullish(),
  unitRate: z.string().nullish(),
  estimatedUnitCost: z.string().nullish(),
  section: z.string().nullish(),
  costCategory: z.string().nullish(),
});
export type BoqImportRowDTO = z.infer<typeof boqImportRowSchema>;

export const boqImportSchema = z.object({ rows: z.array(boqImportRowSchema) });
export type BoqImportDTO = z.infer<typeof boqImportSchema>;

export const boqImportReviewRowSchema = z.object({
  rowNumber: z.number(),
  accepted: z.boolean(),
  problems: z.array(z.string()),
  code: z.string(),
  descriptionAr: z.string(),
  unit: z.string(),
  qty: z.string(),
  unitRate: z.string(),
});
export type BoqImportReviewRowDTO = z.infer<typeof boqImportReviewRowSchema>;

export const boqImportReviewSchema = z.object({
  rows: z.array(boqImportReviewRowSchema),
  acceptedCount: z.number(),
  rejectedCount: z.number(),
});
export type BoqImportReviewDTO = z.infer<typeof boqImportReviewSchema>;

export const contractedQtyRowSchema = z.object({
  boqLineId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  baseQty: moneyString,
  adjustmentQty: moneyString,
  contractedQty: moneyString,
});
export type ContractedQtyRowDTO = z.infer<typeof contractedQtyRowSchema>;

export const variationOrderLineInputSchema = z.object({
  kind: z.enum(["add", "change"]),
  boqLineId: z.string().nullish(),
  newLine: boqLineInputSchema.nullish(),
  qtyDelta: moneyString.nullish(),
  unitRateOverride: nonNegativeMoneyString.nullish(),
});
export type VariationOrderLineInputDTO = z.infer<typeof variationOrderLineInputSchema>;

export const createVariationOrderSchema = z.object({
  id: z.string().min(1),
  contractId: z.string().min(1),
  date: isoDate,
  titleAr: z.string().min(1, "عنوان أمر التغيير مطلوب"),
  reason: z.string().min(1, "سبب أمر التغيير مطلوب"),
  requestedBy: z.string().min(1, "الجهة الطالبة مطلوبة"),
  lines: z.array(variationOrderLineInputSchema).min(1, "أمر التغيير بلا بنود"),
});
export type CreateVariationOrderDTO = z.infer<typeof createVariationOrderSchema>;

export const updateVariationOrderSchema = z.object({
  date: isoDate.optional(),
  titleAr: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  requestedBy: z.string().min(1).optional(),
  lines: z.array(variationOrderLineInputSchema).min(1).optional(),
});
export type UpdateVariationOrderDTO = z.infer<typeof updateVariationOrderSchema>;

export const approveVariationOrderSchema = z.object({ approvedAt: isoDate });
export type ApproveVariationOrderDTO = z.infer<typeof approveVariationOrderSchema>;

export const rejectVariationOrderSchema = z.object({ reason: z.string().min(1, "سبب الرفض مطلوب") });
export type RejectVariationOrderDTO = z.infer<typeof rejectVariationOrderSchema>;

export const variationOrderLineSchema = z.object({
  id: z.string(),
  kind: z.enum(["add", "change"]),
  boqLineId: z.string().nullable(),
  newLine: boqLineInputSchema.nullable(),
  qtyDelta: moneyString.nullable(),
  unitRateOverride: moneyString.nullable(),
  sortOrder: z.number(),
  lineValue: moneyString,
});
export type VariationOrderLineDTO = z.infer<typeof variationOrderLineSchema>;

export const variationOrderSchema = z.object({
  id: z.string(),
  docNo: z.string(),
  contractId: z.string(),
  contractDocNo: z.string(),
  date: z.string(),
  titleAr: z.string(),
  reason: z.string(),
  requestedBy: z.string(),
  status: variationOrderStatusSchema,
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  createdBy: z.string().nullable(),
  netValue: moneyString,
  lines: z.array(variationOrderLineSchema),
});
export type VariationOrderDTO = z.infer<typeof variationOrderSchema>;
