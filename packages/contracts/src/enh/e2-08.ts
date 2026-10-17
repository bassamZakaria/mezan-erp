import { z } from "zod";
import { isoDay } from "../iso-date.js";
import { moneyString, nonNegativeMoneyString, quantityString } from "../money-string.js";

// CONTRACT: same string values as the pricing-guard enums in @mezan/domain, which contracts may not import.
export enum PricingGuardModeDTO {
  Block = "block",
  Approval = "approval",
}

export enum PricingGuardRuleStatusDTO {
  Active = "active",
  Inactive = "inactive",
}

export enum PricingGuardBreachKindDTO {
  BelowFloor = "below_floor",
  BelowMinMargin = "below_min_margin",
}

export enum PricingGuardLineOutcomeDTO {
  Pass = "pass",
  NeedsApproval = "needs_approval",
  Blocked = "blocked",
}

export enum PricingGuardCostBasisDTO {
  Wac = "wac",
  ItemCostPrice = "item_cost_price",
  None = "none",
}

export enum PricingGuardDocTypeDTO {
  SalesInvoice = "sales_invoice",
  SalesQuote = "sales_quote",
}

export enum PricingGuardOverrideKindDTO {
  ApprovedByChain = "approved_by_chain",
  AdminBypass = "admin_bypass",
  QuoteSentBelowFloor = "quote_sent_below_floor",
}

export enum PricingGuardDiscountTypeDTO {
  Percent = "percent",
  Amount = "amount",
}

const percentNumber = z.number().gt(-100).lt(100).refine((value) => Number.isFinite(value) && Math.round(value * 100) === value * 100, {
  message: "at most two decimal places",
});

export const pricingGuardRuleInputSchema = z.object({
  nameAr: z.string().trim().min(1).max(200),
  itemId: z.string().min(1).nullable(),
  categoryId: z.string().min(1).nullable(),
  customerCategory: z.string().trim().min(1).max(200).nullable(),
  floorPrice: nonNegativeMoneyString.nullable(),
  minMarginPercent: percentNumber.nullable(),
  mode: z.nativeEnum(PricingGuardModeDTO),
  note: z.string().max(1000).nullable(),
});
export type PricingGuardRuleInputDTO = z.infer<typeof pricingGuardRuleInputSchema>;

export const createPricingGuardRuleSchema = pricingGuardRuleInputSchema;
export type CreatePricingGuardRuleDTO = z.infer<typeof createPricingGuardRuleSchema>;

export const setPricingGuardRuleStatusSchema = z.object({ status: z.nativeEnum(PricingGuardRuleStatusDTO) });

export const pricingGuardRuleSchema = pricingGuardRuleInputSchema.extend({
  id: z.string(),
  status: z.nativeEnum(PricingGuardRuleStatusDTO),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
});
export type PricingGuardRuleDTO = z.infer<typeof pricingGuardRuleSchema>;

export const pricingGuardEvaluateLineSchema = z.object({
  lineId: z.string().min(1),
  itemId: z.string().min(1),
  qty: quantityString,
  unitFactor: z.number().positive().default(1),
  unitPrice: moneyString,
  discountType: z.nativeEnum(PricingGuardDiscountTypeDTO).default(PricingGuardDiscountTypeDTO.Percent),
  discountPercent: z.number().min(0).max(100).default(0),
  discountAmount: nonNegativeMoneyString.default("0"),
  taxRatePercent: z.number().min(0).max(100).default(0),
});

export const pricingGuardEvaluateRequestSchema = z.object({
  docType: z.nativeEnum(PricingGuardDocTypeDTO),
  date: isoDay,
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1).nullable().optional(),
  currency: z.string().min(1).default("EGP"),
  taxInclusive: z.boolean().default(false),
  discount: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal(PricingGuardDiscountTypeDTO.Percent), percent: z.number().min(0).max(100) }),
      z.object({ type: z.literal(PricingGuardDiscountTypeDTO.Amount), amount: nonNegativeMoneyString }),
    ])
    .default({ type: PricingGuardDiscountTypeDTO.Percent, percent: 0 }),
  lines: z.array(pricingGuardEvaluateLineSchema).max(500),
});
export type PricingGuardEvaluateRequestDTO = z.input<typeof pricingGuardEvaluateRequestSchema>;

export const pricingGuardBreachSchema = z.object({
  ruleId: z.string(),
  ruleNameAr: z.string(),
  kind: z.nativeEnum(PricingGuardBreachKindDTO),
  mode: z.nativeEnum(PricingGuardModeDTO),
  floorPrice: nonNegativeMoneyString.nullable(),
  minMarginPercent: z.number().nullable(),
});
export type PricingGuardBreachDTO = z.infer<typeof pricingGuardBreachSchema>;

// SECURITY: unitCost, costBasis and marginPercent reach only a caller holding sales.invoice.view_cost — omitted, never nulled.
export const pricingGuardLineEvaluationSchema = z.object({
  lineId: z.string(),
  itemId: z.string(),
  outcome: z.nativeEnum(PricingGuardLineOutcomeDTO),
  breaches: z.array(pricingGuardBreachSchema),
  netUnitPrice: moneyString.nullable(),
  unitCost: z.string().nullable().optional(),
  costBasis: z.nativeEnum(PricingGuardCostBasisDTO).optional(),
  marginPercent: z.string().nullable().optional(),
});
export type PricingGuardLineEvaluationDTO = z.infer<typeof pricingGuardLineEvaluationSchema>;

export const pricingGuardEvaluationSchema = z.object({
  outcome: z.nativeEnum(PricingGuardLineOutcomeDTO),
  costVisible: z.boolean(),
  lines: z.array(pricingGuardLineEvaluationSchema),
});
export type PricingGuardEvaluationDTO = z.infer<typeof pricingGuardEvaluationSchema>;

export const pricingGuardOverrideQuerySchema = z.object({
  fromDate: isoDay.optional(),
  toDate: isoDay.optional(),
  customerId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  docType: z.nativeEnum(PricingGuardDocTypeDTO).optional(),
});

export const pricingGuardOverrideSchema = z.object({
  id: z.string(),
  docType: z.nativeEnum(PricingGuardDocTypeDTO),
  docId: z.string(),
  docNo: z.string().nullable(),
  docDate: z.string(),
  customerId: z.string(),
  customerNameAr: z.string(),
  branchId: z.string(),
  lineId: z.string(),
  itemId: z.string(),
  baseQty: quantityString,
  netBase: z.string(),
  netUnitPrice: moneyString,
  unitCost: z.string().nullable().optional(),
  costBasis: z.nativeEnum(PricingGuardCostBasisDTO).optional(),
  marginPercent: z.string().nullable().optional(),
  breaches: z.array(pricingGuardBreachSchema),
  kind: z.nativeEnum(PricingGuardOverrideKindDTO),
  approvalRequestId: z.string().nullable(),
  submittedBy: z.string(),
  submittedByName: z.string().nullable(),
  approvedBy: z.array(z.string()),
  approvedByNames: z.array(z.string()),
  actor: z.string(),
  recordedAt: z.string(),
});
export type PricingGuardOverrideDTO = z.infer<typeof pricingGuardOverrideSchema>;

export const pricingGuardOverrideReportSchema = z.object({
  costVisible: z.boolean(),
  rows: z.array(pricingGuardOverrideSchema),
});
export type PricingGuardOverrideReportDTO = z.infer<typeof pricingGuardOverrideReportSchema>;

export const pricingGuardRefusalSchema = z.object({
  error: z.string(),
  message: z.string(),
  messageEn: z.string().optional(),
  lines: z.array(
    z.object({
      lineId: z.string(),
      itemId: z.string(),
      kinds: z.array(z.nativeEnum(PricingGuardBreachKindDTO)),
      ruleIds: z.array(z.string()),
    }),
  ),
});
