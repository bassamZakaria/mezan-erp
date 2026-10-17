import { z } from "zod";
import { moneyString } from "../money-string.js";

// CONTRACT: same string values as the field-sales enums in @mezan/domain, which contracts may not import.
export enum VanTripStatusDTO {
  Ongoing = "ongoing",
  AwaitingApproval = "awaiting_approval",
  Settled = "settled",
  Cancelled = "cancelled",
}

export enum VanTripCrewRoleDTO {
  Driver = "driver",
  Rep = "rep",
  Assistant = "assistant",
}

export enum VanTripCashMovementKindDTO {
  Sale = "sale",
  Collection = "collection",
}

export enum VanReconciliationStepKindDTO {
  CashVariance = "cash_variance",
  CashReturn = "cash_return",
  OverageAdjustment = "overage_adjustment",
  StockReturn = "stock_return",
  ShortageAdjustment = "shortage_adjustment",
}

export enum VanReconciliationStepStateDTO {
  Posted = "posted",
  Held = "held",
}

export const vanTripCashBreakdownSchema = z.object({
  openingFloat: moneyString,
  fieldSales: moneyString,
  fieldCollections: moneyString,
  voucherCollections: moneyString,
  other: moneyString,
});

export const vanTripReconciliationStepSchema = z.object({
  kind: z.nativeEnum(VanReconciliationStepKindDTO),
  documentId: z.string().min(1),
  state: z.nativeEnum(VanReconciliationStepStateDTO),
  value: moneyString.nullable(),
});

export const vanTripReconciliationSchema = z.object({
  approvedBy: z.string().min(1),
  startedAt: z.string().min(1),
  completedAt: z.string().nullable(),
  steps: z.array(vanTripReconciliationStepSchema),
});

export const vanTripExpectedLineSchema = z.object({
  itemId: z.string().min(1),
  expectedQty: moneyString,
  loadedQty: moneyString,
  soldQty: moneyString,
  returnedQty: moneyString,
  otherQty: moneyString,
  unitCost: moneyString,
});

/** `GET /field/van-trips/:id/expected` — what the books hold for the van now, so the count sheet never computes it. */
export const vanTripExpectationSchema = z.object({
  tripId: z.string().min(1),
  asOf: z.string().min(1),
  expectedCash: moneyString,
  cashBreakdown: vanTripCashBreakdownSchema,
  lines: z.array(vanTripExpectedLineSchema),
  invoicedSales: moneyString,
  returnsValue: moneyString,
});

export type VanTripCashBreakdownDTO = z.infer<typeof vanTripCashBreakdownSchema>;
export type VanTripReconciliationStepDTO = z.infer<typeof vanTripReconciliationStepSchema>;
export type VanTripReconciliationDTO = z.infer<typeof vanTripReconciliationSchema>;
export type VanTripExpectedLineDTO = z.infer<typeof vanTripExpectedLineSchema>;
export type VanTripExpectationDTO = z.infer<typeof vanTripExpectationSchema>;
