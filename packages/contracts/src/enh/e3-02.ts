import { z } from "zod";
import { isoDay } from "../iso-date.js";
import { moneyString } from "../money-string.js";
import { cockpitSchema } from "./e1-01.js";

export enum OwnerDigestCadence {
  Daily = "daily",
  Weekly = "weekly",
}

export enum OwnerDigestLanguage {
  Ar = "ar",
  En = "en",
}

export enum OwnerDigestExceptionKind {
  Void = "void",
  LargeDiscount = "large_discount",
  BelowFloor = "below_floor",
  CashVariance = "cash_variance",
  OverdueCollections = "overdue_collections",
  LowStock = "low_stock",
  ApprovalsWaiting = "approvals_waiting",
  FailedEta = "failed_eta",
  Backup = "backup",
}

export enum OwnerDigestSeverity {
  Notice = "notice",
  Warning = "warning",
  Critical = "critical",
}

export enum OwnerDigestCoverageState {
  Evaluated = "evaluated",
  NotPermitted = "not_permitted",
  NotReported = "not_reported",
}

export enum OwnerDigestMetricKey {
  Sales = "sales",
  Collections = "collections",
  GrossProfit = "gross_profit",
  Cash = "cash",
}

export enum OwnerDigestComparison {
  SameWeekdayLastWeek = "same_weekday_last_week",
  PreviousWeek = "previous_week",
  None = "none",
}

export enum OwnerDigestBackupState {
  Fresh = "fresh",
  Stale = "stale",
  Failed = "failed",
}

export enum OwnerDigestTrigger {
  Scheduled = "scheduled",
  Manual = "manual",
}

export enum OwnerDigestSkipReason {
  NoEmail = "no_email",
  NotPermitted = "not_permitted",
  Inactive = "inactive",
  UnknownUser = "unknown_user",
}

export const OWNER_DIGEST_EVENT = "OWNER_DIGEST_READY";

export const OWNER_DIGEST_MAX_RECIPIENTS = 20;

export const ownerDigestThresholdsSchema = z.object({
  largeDiscountPercent: z.number().min(0).max(100),
  voidCount: z.number().int().min(1).max(1000),
  belowFloorCount: z.number().int().min(1).max(1000),
  cashVarianceAmount: moneyString,
  overdueAmount: moneyString,
  lowStockItems: z.number().int().min(1).max(100000),
  approvalWaitingHours: z.number().int().min(1).max(720),
  failedEtaCount: z.number().int().min(1).max(1000),
  backupMaxAgeHours: z.number().int().min(1).max(720),
});
export type OwnerDigestThresholdsDTO = z.infer<typeof ownerDigestThresholdsSchema>;

export const ownerDigestSettingsSchema = z.object({
  scheduleEnabled: z.boolean(),
  cadence: z.nativeEnum(OwnerDigestCadence),
  sendWeekday: z.number().int().min(0).max(6),
  language: z.nativeEnum(OwnerDigestLanguage),
  recipientUserIds: z.array(z.string().trim().min(1).max(120)).max(OWNER_DIGEST_MAX_RECIPIENTS),
  thresholds: ownerDigestThresholdsSchema,
});
export type OwnerDigestSettingsInputDTO = z.infer<typeof ownerDigestSettingsSchema>;

export const ownerDigestSettingsResponseSchema = ownerDigestSettingsSchema.extend({
  scheduleSupported: z.boolean(),
  mailConfigured: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type OwnerDigestSettingsDTO = z.infer<typeof ownerDigestSettingsResponseSchema>;

export const ownerDigestPreviewQuerySchema = z.object({
  cadence: z.nativeEnum(OwnerDigestCadence).optional(),
  language: z.nativeEnum(OwnerDigestLanguage).optional(),
  branchId: z.string().trim().max(120).default(""),
  endingOn: isoDay.optional(),
});
export type OwnerDigestPreviewQueryDTO = z.infer<typeof ownerDigestPreviewQuerySchema>;

export const ownerDigestSendSchema = z.object({
  cadence: z.nativeEnum(OwnerDigestCadence).optional(),
  language: z.nativeEnum(OwnerDigestLanguage).optional(),
  endingOn: isoDay.optional(),
});
export type OwnerDigestSendInputDTO = z.infer<typeof ownerDigestSendSchema>;

export const ownerDigestPeriodSchema = z.object({
  cadence: z.nativeEnum(OwnerDigestCadence),
  from: z.string(),
  to: z.string(),
  key: z.string(),
});
export type OwnerDigestPeriodDTO = z.infer<typeof ownerDigestPeriodSchema>;

export const ownerDigestMetricSchema = z.object({
  key: z.nativeEnum(OwnerDigestMetricKey),
  current: moneyString,
  previous: moneyString.nullable(),
  change: moneyString.nullable(),
});
export type OwnerDigestMetricDTO = z.infer<typeof ownerDigestMetricSchema>;

export const ownerDigestExceptionItemSchema = z.object({
  reference: z.string().nullable(),
  party: z.string().nullable(),
  amount: moneyString.nullable(),
  detail: z.string().nullable(),
  on: z.string().nullable(),
});
export type OwnerDigestExceptionItemDTO = z.infer<typeof ownerDigestExceptionItemSchema>;

export const ownerDigestExceptionSchema = z.object({
  kind: z.nativeEnum(OwnerDigestExceptionKind),
  severity: z.nativeEnum(OwnerDigestSeverity),
  count: z.number().int(),
  secondaryCount: z.number().int().nullable(),
  amount: moneyString.nullable(),
  threshold: z.string().nullable(),
  items: z.array(ownerDigestExceptionItemSchema),
  backupState: z.nativeEnum(OwnerDigestBackupState).nullable(),
});
export type OwnerDigestExceptionDTO = z.infer<typeof ownerDigestExceptionSchema>;

export const ownerDigestCoverageSchema = z.object({
  kind: z.nativeEnum(OwnerDigestExceptionKind),
  state: z.nativeEnum(OwnerDigestCoverageState),
});
export type OwnerDigestCoverageDTO = z.infer<typeof ownerDigestCoverageSchema>;

export const ownerDigestSchema = z.object({
  period: ownerDigestPeriodSchema,
  generatedAt: z.string(),
  language: z.nativeEnum(OwnerDigestLanguage),
  companyName: z.string(),
  currency: z.string(),
  recipientName: z.string().nullable(),
  comparison: z.nativeEnum(OwnerDigestComparison),
  metrics: z.array(ownerDigestMetricSchema),
  cockpit: cockpitSchema,
  exceptions: z.array(ownerDigestExceptionSchema),
  coverage: z.array(ownerDigestCoverageSchema),
  thresholds: ownerDigestThresholdsSchema,
});
export type OwnerDigestDTO = z.infer<typeof ownerDigestSchema>;

export const ownerDigestPreviewSchema = z.object({
  digest: ownerDigestSchema,
  email: z.object({ subject: z.string(), html: z.string() }),
});
export type OwnerDigestPreviewDTO = z.infer<typeof ownerDigestPreviewSchema>;

export const ownerDigestSkippedSchema =z.object({
  userId: z.string(),
  name: z.string().nullable(),
  reason: z.nativeEnum(OwnerDigestSkipReason),
});
export type OwnerDigestSkippedDTO = z.infer<typeof ownerDigestSkippedSchema>;

export const ownerDigestSendResultSchema = z.object({
  period: ownerDigestPeriodSchema,
  queued: z.number().int(),
  alreadySent: z.number().int(),
  skipped: z.array(ownerDigestSkippedSchema),
  mailConfigured: z.boolean(),
});
export type OwnerDigestSendResultDTO = z.infer<typeof ownerDigestSendResultSchema>;

export const ownerDigestRunSchema = z.object({
  id: z.string(),
  cadence: z.nativeEnum(OwnerDigestCadence),
  periodKey: z.string(),
  periodFrom: z.string(),
  periodTo: z.string(),
  recipientUserId: z.string(),
  recipientName: z.string().nullable(),
  trigger: z.nativeEnum(OwnerDigestTrigger),
  notificationId: z.string(),
  createdAt: z.string(),
});
export type OwnerDigestRunDTO = z.infer<typeof ownerDigestRunSchema>;

export const ownerDigestRecipientOptionSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  mayReceive: z.boolean(),
});
export type OwnerDigestRecipientOptionDTO = z.infer<typeof ownerDigestRecipientOptionSchema>;
