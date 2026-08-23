import { z } from "zod";

/**
 * Wire contract for the tenant-wide barcode configuration (default symbology,
 * item-barcode mode, embedded price/weight barcode parsing rules). Mirrors
 * `items.ts`'s style. No Money involved — values here are plain numbers.
 */
export const barcodeSymbologySchema = z.enum(["EAN13", "EAN8", "UPC_A", "CODE128", "CODE39"]);
export const itemBarcodeModeSchema = z.enum(["AUTO", "MANUAL"]);
export const embeddedValueTypeSchema = z.enum(["PRICE", "WEIGHT"]);

export const embeddedBarcodeRuleSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  prefix: z.string(),
  totalLength: z.number().int(),
  itemCodeStart: z.number().int(),
  itemCodeLength: z.number().int(),
  valueStart: z.number().int(),
  valueLength: z.number().int(),
  valueType: embeddedValueTypeSchema,
  valueDecimals: z.number().int(),
  active: z.boolean(),
});

export const barcodeConfigSchema = z.object({
  defaultSymbology: barcodeSymbologySchema,
  itemBarcodeMode: itemBarcodeModeSchema,
  autoGeneratePrefix: z.string().nullable(),
  embeddedRules: z.array(embeddedBarcodeRuleSchema),
});

/** All top-level fields optional; a PUT that supplies `embeddedRules` replaces the whole array. */
export const updateBarcodeConfigSchema = z.object({
  defaultSymbology: barcodeSymbologySchema.optional(),
  itemBarcodeMode: itemBarcodeModeSchema.optional(),
  autoGeneratePrefix: z.string().nullable().optional(),
  embeddedRules: z.array(embeddedBarcodeRuleSchema).optional(),
});

export const parseBarcodeRequestSchema = z.object({
  code: z.string().min(1),
});

export type BarcodeSymbologyDTO = z.infer<typeof barcodeSymbologySchema>;
export type ItemBarcodeModeDTO = z.infer<typeof itemBarcodeModeSchema>;
export type EmbeddedValueTypeDTO = z.infer<typeof embeddedValueTypeSchema>;
export type EmbeddedBarcodeRuleDTO = z.infer<typeof embeddedBarcodeRuleSchema>;
export type BarcodeConfigDTO = z.infer<typeof barcodeConfigSchema>;
export type UpdateBarcodeConfigDTO = z.infer<typeof updateBarcodeConfigSchema>;
export type ParseBarcodeRequestDTO = z.infer<typeof parseBarcodeRequestSchema>;
