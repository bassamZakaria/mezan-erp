import { z } from "zod";
import { moneyString } from "../money-string.js";

export const LEADERBOARD_CARD_LIMIT = 5;

export const leaderboardCardQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchId: z.string().optional(),
});

export const leaderboardCardEntrySchema = z.object({
  rank: z.number().int().positive(),
  repId: z.string().min(1),
  nameAr: z.string(),
  nameEn: z.string(),
  invoiceCount: z.number().int().nonnegative(),
  revenue: moneyString,
  grossMargin: moneyString.optional(),
  conversionRate: z.number().min(0).max(100).nullable(),
  collected: moneyString,
});

export const leaderboardCardSchema = z.object({
  dateFrom: z.string(),
  dateTo: z.string(),
  totalRevenue: moneyString,
  entries: z.array(leaderboardCardEntrySchema),
});

export type LeaderboardCardEntryDTO = z.infer<typeof leaderboardCardEntrySchema>;
export type LeaderboardCardDTO = z.infer<typeof leaderboardCardSchema>;
