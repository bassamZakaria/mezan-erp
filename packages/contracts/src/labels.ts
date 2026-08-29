import { z } from "zod";

/**
 * Wire contracts for تخطيطات الملصقات (label layouts, docs/archive/catalog/03
 * §"طباعة الباركود والملصقات") — the printable geometry of one sticker sheet.
 * Millimetre geometry crosses the wire as plain numbers: it is layout
 * configuration, not money or quantity.
 */

export const labelPageSizeSchema = z.enum(["A4", "A5"]);

const positiveMm = z.number().positive();
const nonNegativeMm = z.number().nonnegative();

export const labelLayoutSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  pageSize: labelPageSizeSchema,
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  labelWidthMm: positiveMm,
  labelHeightMm: positiveMm,
  columnGapMm: nonNegativeMm,
  rowGapMm: nonNegativeMm,
  marginBlockMm: nonNegativeMm,
  marginInlineMm: nonNegativeMm,
  showItemName: z.boolean(),
  showItemCode: z.boolean(),
  showPrice: z.boolean(),
  showUnit: z.boolean(),
  showBarcode: z.boolean(),
  showBarcodeText: z.boolean(),
  barcodeHeightMm: nonNegativeMm,
  active: z.boolean(),
});

export const createLabelLayoutSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  pageSize: labelPageSizeSchema.optional(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  labelWidthMm: positiveMm,
  labelHeightMm: positiveMm,
  columnGapMm: nonNegativeMm.optional(),
  rowGapMm: nonNegativeMm.optional(),
  marginBlockMm: nonNegativeMm.optional(),
  marginInlineMm: nonNegativeMm.optional(),
  showItemName: z.boolean().optional(),
  showItemCode: z.boolean().optional(),
  showPrice: z.boolean().optional(),
  showUnit: z.boolean().optional(),
  showBarcode: z.boolean().optional(),
  showBarcodeText: z.boolean().optional(),
  barcodeHeightMm: nonNegativeMm.optional(),
  active: z.boolean().optional(),
});

/** All fields optional (and no `code`, immutable after creation) — a PATCH applies only what's supplied. */
export const updateLabelLayoutSchema = createLabelLayoutSchema
  .omit({ id: true, code: true })
  .partial();

export type LabelPageSizeDTO = z.infer<typeof labelPageSizeSchema>;
export type LabelLayoutDTO = z.infer<typeof labelLayoutSchema>;
export type CreateLabelLayoutDTO = z.infer<typeof createLabelLayoutSchema>;
export type UpdateLabelLayoutDTO = z.infer<typeof updateLabelLayoutSchema>;
