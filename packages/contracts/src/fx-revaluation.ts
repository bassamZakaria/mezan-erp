import { z } from "zod";

/** Wire contract for FX revaluation (docs/archive/catalog/04 "إعادة تقييم العملات الأجنبية"). */

/** Request to preview/post a revaluation as of a closing date. */
export const fxRevaluationRequestSchema = z.object({
  /** Posting date (period end). */
  date: z.string().min(1),
  /** Optional currency filter; empty = revalue all open foreign currencies. */
  currencies: z.array(z.string().min(1)).optional(),
  /** العكس التلقائي — default true (auto-reverse next day). */
  autoReverse: z.boolean().optional(),
});

/** One revalued balance line in the preview. */
export const fxRevaluationDetailSchema = z.object({
  accountId: z.string(),
  currency: z.string(),
  label: z.string().nullable(),
  foreignAmount: z.string(),
  bookedBase: z.string(),
  closingRate: z.string(),
  revaluedBase: z.string(),
  delta: z.string(),
  gainLoss: z.string(),
});

export const fxRevaluationPreviewSchema = z.object({
  date: z.string(),
  autoReverse: z.boolean(),
  reversalDate: z.string(),
  details: z.array(fxRevaluationDetailSchema),
  totalGain: z.string(),
  totalLoss: z.string(),
  hasImpact: z.boolean(),
});

export const fxRevaluationPostResultSchema = z.object({
  preview: fxRevaluationPreviewSchema,
  entryId: z.string().nullable(),
  entryNo: z.string().nullable(),
  reversalId: z.string().nullable(),
  reversalNo: z.string().nullable(),
});

export type FxRevaluationRequestDTO = z.infer<typeof fxRevaluationRequestSchema>;
export type FxRevaluationDetailDTO = z.infer<typeof fxRevaluationDetailSchema>;
export type FxRevaluationPreviewDTO = z.infer<typeof fxRevaluationPreviewSchema>;
export type FxRevaluationPostResultDTO = z.infer<typeof fxRevaluationPostResultSchema>;
