import { z } from "zod";

/**
 * Shared shapes for Label Printing (docs/catalog/03-inventory.md
 * §"طباعة الملصقات"). This screen never crosses an HTTP boundary — it's a
 * stateless client-side builder over live item data the existing `/items`
 * API already serves — but the schemas still give the domain's pure
 * `buildLabelBatch`/`checkBarcodeFit` and the web layer one shared, validated
 * shape (docs/plan.md's "no floats" discipline: price crosses as a decimal
 * string, exactly like every other Money field in this codebase).
 */

export const labelTemplateCodeSchema = z.enum(["THERMAL_40x30", "SHELF_50x25", "PRODUCT_100x50"]);

export const labelTemplateSchema = z.object({
  code: labelTemplateCodeSchema,
  labelAr: z.string().min(1),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
});

export const labelBatchLineInputSchema = z.object({
  itemId: z.string().min(1),
  nameAr: z.string().min(1),
  code: z.string().min(1),
  barcode: z.string(),
  price: z.string(),
  copies: z.number().int().positive(),
});

export type LabelTemplateCodeDTO = z.infer<typeof labelTemplateCodeSchema>;
export type LabelTemplateDTO = z.infer<typeof labelTemplateSchema>;
export type LabelBatchLineInputDTO = z.infer<typeof labelBatchLineInputSchema>;
