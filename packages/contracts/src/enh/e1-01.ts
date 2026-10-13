import { z } from "zod";
import { moneyString } from "../money-string.js";

export enum CockpitDirectionDTO {
  Up = "up",
  Down = "down",
  Level = "level",
}

export const cockpitQuerySchema = z.object({
  branchId: z.string().trim().max(120).default(""),
});
export type CockpitQueryDTO = z.infer<typeof cockpitQuerySchema>;

export const cockpitComparisonSchema = z.object({
  today: moneyString,
  sameWeekdayLastWeek: moneyString,
});
export type CockpitComparisonDTO = z.infer<typeof cockpitComparisonSchema>;

export const cockpitPercentComparisonSchema = z.object({
  today: z.string().nullable(),
  sameWeekdayLastWeek: z.string().nullable(),
});
export type CockpitPercentComparisonDTO = z.infer<typeof cockpitPercentComparisonSchema>;

export const cockpitPulseSchema = z.object({
  sales: cockpitComparisonSchema,
  collections: cockpitComparisonSchema,
  grossProfit: cockpitComparisonSchema.nullable(),
  grossMarginPercent: cockpitPercentComparisonSchema.nullable(),
});
export type CockpitPulseDTO = z.infer<typeof cockpitPulseSchema>;

export const cockpitDaySchema = z.object({
  date: z.string(),
  sales: moneyString,
  collections: moneyString,
  cogs: moneyString.nullable(),
  grossProfit: moneyString.nullable(),
  grossMarginPercent: z.string().nullable(),
});
export type CockpitDayDTO = z.infer<typeof cockpitDaySchema>;

export const cockpitMarginWeekSchema = z.object({
  from: z.string(),
  to: z.string(),
  revenue: moneyString,
  cogs: moneyString,
  grossProfit: moneyString,
  grossMarginPercent: z.string().nullable(),
});
export type CockpitMarginWeekDTO = z.infer<typeof cockpitMarginWeekSchema>;

export const cockpitMoverSchema = z.object({
  itemId: z.string(),
  code: z.string().nullable(),
  nameAr: z.string().nullable(),
  nameEn: z.string().nullable(),
  current: moneyString,
  previous: moneyString,
  change: moneyString,
  direction: z.nativeEnum(CockpitDirectionDTO),
});
export type CockpitMoverDTO = z.infer<typeof cockpitMoverSchema>;

export const cockpitTreasurySchema = z.object({
  treasuryAccountId: z.string(),
  code: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  type: z.string(),
  branchId: z.string().nullable(),
  glAccountId: z.string().nullable(),
  balance: moneyString.nullable(),
  /**
   * True when more than one branch's treasury account points at this GL
   * account. Under a branch filter the balance is then the branch-attributed
   * movement, not the account's company-wide total — the screen says so.
   */
  sharedAcrossBranches: z.boolean(),
});
export type CockpitTreasuryDTO = z.infer<typeof cockpitTreasurySchema>;

export const cockpitCashSchema = z.object({
  total: moneyString,
  accounts: z.array(cockpitTreasurySchema),
});
export type CockpitCashDTO = z.infer<typeof cockpitCashSchema>;

export const cockpitOverdueSchema = z.object({
  amount: moneyString,
  invoiceCount: z.number().int(),
  customerCount: z.number().int(),
  oldestDueDate: z.string().nullable(),
});
export type CockpitOverdueDTO = z.infer<typeof cockpitOverdueSchema>;

export const cockpitLowStockSchema = z.object({
  low: z.number().int(),
  out: z.number().int(),
  firstItemNameAr: z.string().nullable(),
  firstItemNameEn: z.string().nullable(),
});
export type CockpitLowStockDTO = z.infer<typeof cockpitLowStockSchema>;

export const cockpitUnattributedSchema = z.object({
  salesToday: moneyString,
  sales7d: moneyString,
  collections7d: moneyString,
});
export type CockpitUnattributedDTO = z.infer<typeof cockpitUnattributedSchema>;

export const cockpitSchema = z.object({
  generatedAt: z.string(),
  today: z.string(),
  compareDate: z.string(),
  windowFrom: z.string(),
  bookVersion: z.string(),
  branchId: z.string(),
  branchNarrowed: z.boolean(),
  pulse: cockpitPulseSchema,
  days: z.array(cockpitDaySchema),
  marginTrend: z.array(cockpitMarginWeekSchema).nullable(),
  topMovers: z.array(cockpitMoverSchema).nullable(),
  cash: cockpitCashSchema.nullable(),
  overdueReceivables: cockpitOverdueSchema.nullable(),
  lowStock: cockpitLowStockSchema.nullable(),
  unattributed: cockpitUnattributedSchema,
});
export type CockpitDTO = z.infer<typeof cockpitSchema>;

export const cockpitVersionSchema = z.object({
  bookVersion: z.string(),
});
export type CockpitVersionDTO = z.infer<typeof cockpitVersionSchema>;
