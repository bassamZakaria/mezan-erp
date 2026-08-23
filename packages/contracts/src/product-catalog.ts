import { z } from "zod";

/**
 * Wire contracts for the specification registry (المواصفات) and the product
 * templates (منتجات بخيارات) built on top of it. Money crosses the wire as an
 * exact decimal string, never a float (mirrors items.ts).
 */
export const itemSpecificationTypeSchema = z.enum(["select", "number", "text"]);

export const itemSpecificationSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  type: itemSpecificationTypeSchema,
  values: z.array(z.string()),
  unit: z.string().nullable(),
  filterable: z.boolean(),
  active: z.boolean(),
  /** How many product templates pick this specification — read-only, server-computed. */
  usageCount: z.number().int().nonnegative(),
});

export const createItemSpecificationSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  type: itemSpecificationTypeSchema,
  values: z.array(z.string()).optional(),
  unit: z.string().nullable().optional(),
  filterable: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** `code` and `type` are immutable after creation — templates bind to both. */
export const updateItemSpecificationSchema = z.object({
  nameAr: z.string().min(1).optional(),
  values: z.array(z.string()).optional(),
  unit: z.string().nullable().optional(),
  filterable: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const productTemplateStatusSchema = z.enum(["draft", "generated"]);

export const productTemplateOptionSchema = z.object({
  specificationId: z.string().min(1),
  values: z.array(z.string().min(1)),
});

export const productTemplateVariantSchema = z.object({
  sku: z.string().min(1),
  values: z.array(z.string()),
  nameAr: z.string().min(1),
  salePrice: z.string().nullable(),
  itemId: z.string().nullable(),
});

export const productTemplateSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  baseUnitCode: z.string().min(1),
  categoryId: z.string().nullable(),
  basePrice: z.string().nullable(),
  taxRatePercent: z.number(),
  costingMethod: z.enum(["WAC", "FIFO"]),
  options: z.array(productTemplateOptionSchema),
  variants: z.array(productTemplateVariantSchema),
  status: productTemplateStatusSchema,
  createdAt: z.string().min(1),
  /** Combinations the option matrix would generate — read-only, server-computed. */
  combinationCount: z.number().int().nonnegative(),
});

export const createProductTemplateSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  baseUnitCode: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  taxRatePercent: z.number().nonnegative().optional(),
  costingMethod: z.enum(["WAC", "FIFO"]).optional(),
  options: z.array(productTemplateOptionSchema),
});

export const updateProductTemplateSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  taxRatePercent: z.number().nonnegative().optional(),
  costingMethod: z.enum(["WAC", "FIFO"]).optional(),
  options: z.array(productTemplateOptionSchema).optional(),
});

export const setProductTemplateVariantPriceSchema = z.object({
  salePrice: z.string().nullable(),
});

export type ItemSpecificationTypeDTO = z.infer<typeof itemSpecificationTypeSchema>;
export type ItemSpecificationDTO = z.infer<typeof itemSpecificationSchema>;
export type CreateItemSpecificationDTO = z.infer<typeof createItemSpecificationSchema>;
export type UpdateItemSpecificationDTO = z.infer<typeof updateItemSpecificationSchema>;
export type ProductTemplateStatusDTO = z.infer<typeof productTemplateStatusSchema>;
export type ProductTemplateOptionDTO = z.infer<typeof productTemplateOptionSchema>;
export type ProductTemplateVariantDTO = z.infer<typeof productTemplateVariantSchema>;
export type ProductTemplateDTO = z.infer<typeof productTemplateSchema>;
export type CreateProductTemplateDTO = z.infer<typeof createProductTemplateSchema>;
export type UpdateProductTemplateDTO = z.infer<typeof updateProductTemplateSchema>;
export type SetProductTemplateVariantPriceDTO = z.infer<typeof setProductTemplateVariantPriceSchema>;
