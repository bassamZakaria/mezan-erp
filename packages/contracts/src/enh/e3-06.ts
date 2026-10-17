import { z } from "zod";
import { moneyString } from "../money-string.js";
import { opportunityLostReasonSchema } from "../crm.js";

export const lostReasonOptionSchema = z.object({
  code: opportunityLostReasonSchema,
  labelAr: z.string().min(1),
  labelEn: z.string().min(1),
});

export const crmOwnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const forecastFiguresSchema = z.object({
  count: z.number().int().nonnegative(),
  amount: moneyString,
  weighted: moneyString,
});

export const forecastOwnerRowSchema = forecastFiguresSchema.extend({
  ownerUserId: z.string().nullable(),
});

export const forecastMonthRowSchema = forecastFiguresSchema.extend({
  month: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  owners: z.array(forecastOwnerRowSchema),
});

export const weightedForecastSchema = z.object({
  months: z.array(forecastMonthRowSchema),
  owners: z.array(forecastOwnerRowSchema),
  total: forecastFiguresSchema,
  scope: z.enum(["all", "own"]),
});

export const crmForecastQuerySchema = z.object({
  branchId: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional(),
});

export const activityReminderRunSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notified: z.number().int().nonnegative(),
});

export type LostReasonOptionDTO = z.infer<typeof lostReasonOptionSchema>;
export type CrmOwnerDTO = z.infer<typeof crmOwnerSchema>;
export type ForecastFiguresDTO = z.infer<typeof forecastFiguresSchema>;
export type ForecastOwnerRowDTO = z.infer<typeof forecastOwnerRowSchema>;
export type ForecastMonthRowDTO = z.infer<typeof forecastMonthRowSchema>;
export type WeightedForecastDTO = z.infer<typeof weightedForecastSchema>;
export type CrmForecastQueryDTO = z.infer<typeof crmForecastQuerySchema>;
export type ActivityReminderRunDTO = z.infer<typeof activityReminderRunSchema>;
