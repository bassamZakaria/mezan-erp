import { z } from "zod";

/**
 * Wire contracts for the two item reference catalogs (docs/catalog/03-inventory.md
 * "وحدات القياس" / "تصنيفات الأصناف"). Items reference a unit by `code` and a
 * category by `id`, so those are the identifiers that cross the wire.
 */
export const itemUnitSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  baseUnitCode: z.string().nullable(),
  factor: z.number().positive(),
  active: z.boolean(),
});

export const createItemUnitSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  baseUnitCode: z.string().nullable().optional(),
  factor: z.number().positive().optional(),
  active: z.boolean().optional(),
});

/** `code` is immutable after creation — items reference units by code. */
export const updateItemUnitSchema = z.object({
  nameAr: z.string().min(1).optional(),
  baseUnitCode: z.string().nullable().optional(),
  factor: z.number().positive().optional(),
  active: z.boolean().optional(),
});

export const itemCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  parentId: z.string().nullable(),
  active: z.boolean(),
});

export const createItemCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  parentId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export const updateItemCategorySchema = z.object({
  nameAr: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export type ItemUnitDTO = z.infer<typeof itemUnitSchema>;
export type CreateItemUnitDTO = z.infer<typeof createItemUnitSchema>;
export type UpdateItemUnitDTO = z.infer<typeof updateItemUnitSchema>;
export type ItemCategoryDTO = z.infer<typeof itemCategorySchema>;
export type CreateItemCategoryDTO = z.infer<typeof createItemCategorySchema>;
export type UpdateItemCategoryDTO = z.infer<typeof updateItemCategorySchema>;
