import { z } from "zod";
import { moneyString, quantityString } from "./money-string.js";

export enum StockLevelStatusDTO {
  Out = "out",
  Low = "low",
  Normal = "normal",
}

export const stockLevelsAttentionRowSchema = z.object({
  itemId: z.string(),
  itemNameAr: z.string(),
  itemNameEn: z.string().nullable(),
  sku: z.string(),
  onHand: quantityString,
  status: z.nativeEnum(StockLevelStatusDTO),
});

export const stockLevelsSummarySchema = z.object({
  totalValue: moneyString,
  needsAttentionCount: z.number().int().nonnegative(),
  lowCount: z.number().int().nonnegative(),
  attention: z.array(stockLevelsAttentionRowSchema),
  firstLow: stockLevelsAttentionRowSchema.nullable(),
});

export type StockLevelsAttentionRowDTO = z.infer<typeof stockLevelsAttentionRowSchema>;
export type StockLevelsSummaryDTO = z.infer<typeof stockLevelsSummarySchema>;
