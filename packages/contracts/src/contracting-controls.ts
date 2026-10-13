import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { finalSecurityStatusSchema } from "./contracting-contracts.js";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contracts for تقارير الاستثناءات السبعة، الإفراج عن المحتجزات وتقويمها —
 * slice 5B of المقاولات (docs/artifacts/mezan-contracting-designs.html §06).
 *
 * Every figure crosses as an exact decimal string. The reports carry their own
 * rule sentence, because an empty table has to say what it means.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب بصيغة YYYY-MM-DD");
const percentString = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "النسبة يجب أن تكون رقمًا عشريًا موجبًا");

export const contractingExceptionKeySchema = z.enum([
  "boq-overrun",
  "unreceived-issues",
  "consumption-variance",
  "equipment-without-certificate",
  "late-variation-approvals",
  "early-retention-release",
  "cost-overrun-vs-estimate",
]);
export type ContractingExceptionKeyDTO = z.infer<typeof contractingExceptionKeySchema>;

const reportEnvelope = {
  key: contractingExceptionKeySchema,
  labelAr: z.string(),
  /** The sentence under the table — what the rule is, printed whether or not it fired. */
  ruleAr: z.string(),
  asOfDate: z.string(),
  projectId: z.string().nullable(),
  olderThanDays: z.number().nullable(),
  thresholdPercent: z.string().nullable(),
  /** How many months an unrevised التكلفة الكلية المقدرة may stand — report 7 only. */
  stalenessMonths: z.number().nullable(),
};

export const boqOverrunRowSchema = z.object({
  contractId: z.string(),
  contractDocNo: z.string(),
  projectId: z.string(),
  boqLineId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  unitLabelAr: z.string(),
  certificateId: z.string(),
  certificateDocNo: z.string(),
  executionDate: z.string(),
  cumulativeQty: moneyString,
  contractedQty: moneyString,
  excessQty: moneyString,
});
export type BoqOverrunRowDTO = z.infer<typeof boqOverrunRowSchema>;

export const unreceivedIssueRowSchema = z.object({
  issueId: z.string(),
  docNo: z.string().nullable(),
  date: z.string(),
  projectId: z.string(),
  fromWarehouseId: z.string(),
  toWarehouseId: z.string(),
  transitWarehouseId: z.string().nullable(),
  issuedByUserId: z.string(),
  itemId: z.string(),
  qtyIssued: moneyString,
  qtyReceived: moneyString,
  qtyOutstanding: moneyString,
  ageDays: z.number(),
  /** `received_before_issue` is a confirmed receipt dated before the issue it closes. */
  kind: z.enum(["outstanding", "received_before_issue"]),
  receiptId: z.string().nullable(),
  receiptDocNo: z.string().nullable(),
  receiptDate: z.string().nullable(),
});
export type UnreceivedIssueRowDTO = z.infer<typeof unreceivedIssueRowSchema>;

export const consumptionVarianceRowSchema = z.object({
  contractId: z.string(),
  contractDocNo: z.string(),
  projectId: z.string(),
  boqLineId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  itemId: z.string(),
  theoreticalQtyPerUnit: moneyString,
  certifiedCumulativeQty: moneyString,
  theoreticalQty: moneyString,
  consumedQty: moneyString,
  consumedCost: moneyString,
  varianceQty: moneyString,
  /** Null when the theoretical quantity is zero — a percentage of nothing is undefined, not infinite. */
  variancePercent: z.string().nullable(),
});
export type ConsumptionVarianceRowDTO = z.infer<typeof consumptionVarianceRowSchema>;

export const equipmentExceptionRowSchema = z.object({
  contractId: z.string().nullable(),
  contractDocNo: z.string().nullable(),
  contractStatus: z.string().nullable(),
  projectId: z.string(),
  equipmentLogId: z.string(),
  docNo: z.string().nullable(),
  assetId: z.string(),
  date: z.string(),
  hours: moneyString,
  amount: moneyString,
  boqLineId: z.string().nullable(),
  code: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  certifiedCumulativeAtLog: moneyString,
  certifiedCumulativeNow: moneyString,
  ageDays: z.number(),
  reason: z.enum(["no_boq_line", "not_certified_since"]),
});
export type EquipmentExceptionRowDTO = z.infer<typeof equipmentExceptionRowSchema>;

export const lateVariationRowSchema = z.object({
  contractId: z.string(),
  contractDocNo: z.string(),
  projectId: z.string(),
  variationOrderId: z.string(),
  variationDocNo: z.string(),
  variationTitleAr: z.string(),
  approvedAt: z.string(),
  boqLineId: z.string(),
  code: z.string(),
  descriptionAr: z.string(),
  certificateId: z.string(),
  certificateDocNo: z.string(),
  executionDate: z.string(),
  cumulativeQty: moneyString,
  contractedQtyAtExecution: moneyString,
  reliedOnQty: moneyString,
});
export type LateVariationRowDTO = z.infer<typeof lateVariationRowSchema>;

export const earlyRetentionReleaseRowSchema = z.object({
  releaseId: z.string(),
  docNo: z.string(),
  /** Which half of the retention: the employer's، or a subcontractor's. */
  party: z.enum(["customer", "subcontractor"]),
  counterpartyNameAr: z.string().nullable(),
  contractId: z.string(),
  contractDocNo: z.string(),
  projectId: z.string(),
  kind: z.string(),
  date: z.string(),
  amount: moneyString,
  releaseEventDate: z.string().nullable(),
  status: z.string(),
  daysEarly: z.number(),
});
export type EarlyRetentionReleaseRowDTO = z.infer<typeof earlyRetentionReleaseRowSchema>;

export const costOverrunRowSchema = z.object({
  contractId: z.string(),
  contractDocNo: z.string(),
  contractTitleAr: z.string(),
  projectId: z.string(),
  status: z.string(),
  costToDate: moneyString,
  estimatedTotalCost: moneyString,
  certifiedGrossWorks: moneyString,
  contractValue: moneyString,
  /** estimatedTotalCost × certifiedGrossWorks / contractValue. */
  expectedCostToDate: moneyString,
  excessCost: moneyString,
  lastEstimateRevisionDate: z.string().nullable(),
  monthsSinceEstimateRevision: z.number().nullable(),
  costOverrun: z.boolean(),
  estimateStale: z.boolean(),
});
export type CostOverrunRowDTO = z.infer<typeof costOverrunRowSchema>;

export const boqOverrunReportSchema = z.object({ ...reportEnvelope, rows: z.array(boqOverrunRowSchema) });
export const unreceivedIssuesReportSchema = z.object({ ...reportEnvelope, rows: z.array(unreceivedIssueRowSchema) });
export const consumptionVarianceReportSchema = z.object({ ...reportEnvelope, rows: z.array(consumptionVarianceRowSchema) });
export const equipmentExceptionReportSchema = z.object({ ...reportEnvelope, rows: z.array(equipmentExceptionRowSchema) });
export const lateVariationReportSchema = z.object({ ...reportEnvelope, rows: z.array(lateVariationRowSchema) });
export const earlyRetentionReleaseReportSchema = z.object({ ...reportEnvelope, rows: z.array(earlyRetentionReleaseRowSchema) });
export const costOverrunReportSchema = z.object({ ...reportEnvelope, rows: z.array(costOverrunRowSchema) });

export type BoqOverrunReportDTO = z.infer<typeof boqOverrunReportSchema>;
export type UnreceivedIssuesReportDTO = z.infer<typeof unreceivedIssuesReportSchema>;
export type ConsumptionVarianceReportDTO = z.infer<typeof consumptionVarianceReportSchema>;
export type EquipmentExceptionReportDTO = z.infer<typeof equipmentExceptionReportSchema>;
export type LateVariationReportDTO = z.infer<typeof lateVariationReportSchema>;
export type EarlyRetentionReleaseReportDTO = z.infer<typeof earlyRetentionReleaseReportSchema>;
export type CostOverrunReportDTO = z.infer<typeof costOverrunReportSchema>;

export const contractingExceptionSummarySchema = z.object({
  asOfDate: z.string(),
  total: z.number(),
  reports: z.array(
    z.object({ key: contractingExceptionKeySchema, labelAr: z.string(), count: z.number() }),
  ),
});
export type ContractingExceptionSummaryDTO = z.infer<typeof contractingExceptionSummarySchema>;

// ----- الإفراج عن المحتجزات ---------------------------------------------------

export const retentionReleaseKindSchema = z.enum(["provisional", "final", "other"]);
export type RetentionReleaseKindDTO = z.infer<typeof retentionReleaseKindSchema>;

export const retentionReleaseStatusSchema = z.enum(["draft", "released", "cancelled"]);
export type RetentionReleaseStatusDTO = z.infer<typeof retentionReleaseStatusSchema>;

export const createRetentionReleaseSchema = z.object({
  id: clientSuppliedId,
  contractId: z.string().min(1),
  kind: retentionReleaseKindSchema,
  date: isoDate,
  amount: nonNegativeMoneyString,
  notes: z.string().nullish(),
});
export type CreateRetentionReleaseDTO = z.infer<typeof createRetentionReleaseSchema>;

/**
 * الإفراج. `approvedBy` is REQUIRED when the release date precedes the release
 * event, and must name a user who is neither the author nor the releaser.
 */
export const releaseRetentionSchema = z.object({
  approvedBy: z.string().min(1).nullable().optional(),
});
export type ReleaseRetentionDTO = z.infer<typeof releaseRetentionSchema>;

export const updateRetentionReleaseSchema = z.object({
  kind: retentionReleaseKindSchema.optional(),
  date: isoDate.optional(),
  amount: nonNegativeMoneyString.optional(),
  notes: z.string().nullish(),
});
export type UpdateRetentionReleaseDTO = z.infer<typeof updateRetentionReleaseSchema>;

export const retentionReleaseSchema = z.object({
  id: z.string(),
  docNo: z.string(),
  contractId: z.string(),
  contractDocNo: z.string(),
  contractTitleAr: z.string(),
  projectId: z.string(),
  customerId: z.string(),
  kind: retentionReleaseKindSchema,
  kindLabelAr: z.string(),
  date: z.string(),
  amount: moneyString,
  /** Server-derived from the contract's handover dates — never accepted from the client. */
  releaseEventDate: z.string().nullable(),
  earlyRelease: z.boolean(),
  status: retentionReleaseStatusSchema,
  statusLabelAr: z.string(),
  notes: z.string().nullable(),
  invoiceId: z.string().nullable(),
  invoiceDocNo: z.string().nullable(),
  releasedAt: z.string().nullable(),
  releasedBy: z.string().nullable(),
  /** The second signature an early release carries. Null on a release that is not early. */
  approvedBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  held: moneyString,
  released: moneyString,
  balance: moneyString,
  /** The most this document may release, recomputed on every read. */
  cap: moneyString,
  invoiceTotal: moneyString.nullable(),
  invoiceRemaining: moneyString.nullable(),
});
export type RetentionReleaseDTO = z.infer<typeof retentionReleaseSchema>;

export const retentionHeadroomSchema = z.object({
  contractId: z.string(),
  kind: retentionReleaseKindSchema,
  held: moneyString,
  released: moneyString,
  balance: moneyString,
  cap: moneyString,
  releaseEventDate: z.string().nullable(),
});
export type RetentionHeadroomDTO = z.infer<typeof retentionHeadroomSchema>;

export const retentionCalendarEventSchema = z.object({
  kind: retentionReleaseKindSchema.nullable(),
  date: z.string().nullable(),
  daysToEvent: z.number().nullable(),
  due: z.boolean(),
  /** Days since the event fell due — retention's only ageing. Null while the event is ahead. */
  ageDays: z.number().nullable(),
});

export const retentionCalendarRowSchema = z.object({
  contractId: z.string(),
  contractDocNo: z.string(),
  contractTitleAr: z.string(),
  contractStatus: z.string(),
  projectId: z.string(),
  projectNameAr: z.string().nullable(),
  customerId: z.string(),
  retentionPercent: z.string(),
  provisionalReleasePercent: z.string(),
  provisionalHandoverDate: z.string().nullable(),
  finalHandoverDate: z.string().nullable(),
  defectsLiabilityMonths: z.number(),
  held: moneyString,
  released: moneyString,
  balance: moneyString,
  provisionalReleasedToDate: moneyString,
  event: retentionCalendarEventSchema,
  /** التأمين النهائي — set on a Law 182/2018 contract, where the letter replaces held cash. */
  finalSecurity: finalSecurityStatusSchema.nullable(),
});
export type RetentionCalendarRowDTO = z.infer<typeof retentionCalendarRowSchema>;

export const retentionPayableSubcontractRowSchema = z.object({
  subcontractId: z.string(),
  subcontractDocNo: z.string(),
  titleAr: z.string(),
  supplierId: z.string(),
  status: z.string(),
  held: moneyString,
  released: moneyString,
  balance: moneyString,
  completionDate: z.string().nullable(),
  defectsLiabilityMonths: z.number().int(),
  releaseEventDate: z.string().nullable(),
  daysToEvent: z.number().nullable(),
  due: z.boolean(),
  ageDays: z.number().nullable(),
});
export type RetentionPayableSubcontractRowDTO = z.infer<typeof retentionPayableSubcontractRowSchema>;

export const retentionPayableRowSchema = z.object({
  projectId: z.string(),
  projectNameAr: z.string().nullable(),
  contractId: z.string().nullable(),
  contractDocNo: z.string().nullable(),
  held: moneyString,
  released: moneyString,
  balance: moneyString,
  /** The subcontracts behind the balance, each on its own release clock. */
  subcontracts: z.array(retentionPayableSubcontractRowSchema),
});
export type RetentionPayableRowDTO = z.infer<typeof retentionPayableRowSchema>;

export const retentionCalendarSchema = z.object({
  asOfDate: z.string(),
  receivable: z.array(retentionCalendarRowSchema),
  payable: z.array(retentionPayableRowSchema),
});
export type RetentionCalendarDTO = z.infer<typeof retentionCalendarSchema>;

export const recordHandoverSchema = z.object({
  provisionalHandoverDate: isoDate.nullish(),
  finalHandoverDate: isoDate.nullish(),
  provisionalReleasePercent: percentString.optional(),
});
export type RecordHandoverDTO = z.infer<typeof recordHandoverSchema>;

export const setTheoreticalQuantitiesSchema = z.object({
  lines: z.array(
    z.object({
      boqLineId: z.string().min(1),
      theoreticalQtyPerUnit: nonNegativeMoneyString.nullish(),
      theoreticalItemId: z.string().nullish(),
    }),
  ),
});
export type SetTheoreticalQuantitiesDTO = z.infer<typeof setTheoreticalQuantitiesSchema>;
