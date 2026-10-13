import { z } from "zod";
import { moneyString } from "./money-string.js";
import { costingMethodSchema, settableCostingMethodSchema } from "./items.js";

/**
 * Wire contracts for Product Templates (docs/archive/catalog/03-inventory.md
 * §"قوالب المنتجات"): attribute-driven variant/SKU generation. Money fields
 * cross the wire as exact decimal strings, never a float.
 */

export const productTemplateStatusSchema = z.enum(["active", "inactive"]);

export const productTemplateAttributeSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  values: z.array(z.string().min(1)),
  /** المواصفات registry code this attribute was built from, or null for a one-off attribute. */
  specificationCode: z.string().nullable().optional(),
});

export const productTemplateSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  baseUnitCode: z.string().min(1),
  categoryId: z.string().nullable(),
  brandId: z.string().nullable(),
  costingMethod: costingMethodSchema,
  defaultSalePrice: moneyString.nullable(),
  defaultCost: z.string().nullable(),
  taxRatePercent: z.number(),
  attributes: z.array(productTemplateAttributeSchema),
  status: productTemplateStatusSchema,
});

export const createProductTemplateSchema = z.object({
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  baseUnitCode: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  costingMethod: settableCostingMethodSchema.optional(),
  defaultSalePrice: moneyString.nullable().optional(),
  defaultCost: z.string().nullable().optional(),
  taxRatePercent: z.number().optional(),
});

export const addTemplateAttributeSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  /**
   * Build the attribute from a المواصفات registry entry instead of typing it
   * out: its nameAr/nameEn/values are taken from the specification, and the
   * attribute keeps the code so the registry can count and guard its usage.
   */
  specificationCode: z.string().min(1).optional(),
});

export const addAttributeValueSchema = z.object({
  value: z.string().min(1),
});

export const productTemplateVariantSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  itemId: z.string().min(1),
  itemCode: z.string().min(1),
  values: z.record(z.string(), z.string()),
  createdAt: z.string(),
});

export const generateVariantsSchema = z.object({
  selections: z.array(z.object({ values: z.record(z.string(), z.string()) })).min(1),
});

export const generateVariantsResultSchema = z.object({
  created: z.array(productTemplateVariantSchema),
  skippedExisting: z.number().int().nonnegative(),
});

export type ProductTemplateStatusDTO = z.infer<typeof productTemplateStatusSchema>;
export type ProductTemplateAttributeDTO = z.infer<typeof productTemplateAttributeSchema>;
export type ProductTemplateDTO = z.infer<typeof productTemplateSchema>;
export type CreateProductTemplateDTO = z.infer<typeof createProductTemplateSchema>;
export type AddTemplateAttributeDTO = z.infer<typeof addTemplateAttributeSchema>;
export type AddAttributeValueDTO = z.infer<typeof addAttributeValueSchema>;
export type ProductTemplateVariantDTO = z.infer<typeof productTemplateVariantSchema>;
export type GenerateVariantsDTO = z.infer<typeof generateVariantsSchema>;
export type GenerateVariantsResultDTO = z.infer<typeof generateVariantsResultSchema>;
