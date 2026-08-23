import { z } from "zod";

/**
 * Wire contracts for the item master-data catalogs (docs/catalog/03
 * §"وحدة القياس" / §"تصنيفات الأصناف"): units of measure and item categories.
 * Both are tenant data, not fixed enums — an item's `baseUnitCode` and
 * `categoryId` point at these records.
 */

export const itemCatalogStatusSchema = z.enum(["active", "inactive"]);

export const itemUnitSchema = z.object({
  /** The unit code an item's `baseUnitCode` / alternate units refer to (e.g. "PCS"). */
  code: z.string().regex(/^[A-Z0-9_-]{1,12}$/),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  status: itemCatalogStatusSchema,
});

export const createItemUnitSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{1,12}$/),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
});

export const updateItemUnitSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  status: itemCatalogStatusSchema.optional(),
});

export const itemCategorySchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  parentId: z.string().min(1).nullable(),
  status: itemCatalogStatusSchema,
});

export const createItemCategorySchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
});

export const updateItemCategorySchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  status: itemCatalogStatusSchema.optional(),
});

export type ItemCatalogStatusDTO = z.infer<typeof itemCatalogStatusSchema>;
export type ItemUnitDTO = z.infer<typeof itemUnitSchema>;
export type CreateItemUnitDTO = z.infer<typeof createItemUnitSchema>;
export type UpdateItemUnitDTO = z.infer<typeof updateItemUnitSchema>;
export type ItemCategoryDTO = z.infer<typeof itemCategorySchema>;
export type CreateItemCategoryDTO = z.infer<typeof createItemCategorySchema>;
export type UpdateItemCategoryDTO = z.infer<typeof updateItemCategorySchema>;
