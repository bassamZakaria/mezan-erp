import { z } from "zod";
import { itemCatalogStatusSchema } from "./item-catalog.js";

/**
 * Wire contracts for المواصفات — the reusable specification/attribute registry
 * over the item catalog. Same shape as the other item master-data catalogs:
 * an uppercase `code` identity, `nameAr`/`nameEn`, and an active/inactive
 * `status`. `usageCount` is derived server-side (how many product templates
 * bind an attribute to this code), never written by a client.
 */

export const itemSpecificationTypeSchema = z.enum(["select", "number", "text"]);

export const itemSpecificationSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  type: itemSpecificationTypeSchema,
  values: z.array(z.string().min(1)),
  unit: z.string().nullable(),
  filterable: z.boolean(),
  status: itemCatalogStatusSchema,
  usageCount: z.number().int().nonnegative(),
});

export const createItemSpecificationSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  type: itemSpecificationTypeSchema,
  values: z.array(z.string().min(1)).optional(),
  unit: z.string().nullable().optional(),
  filterable: z.boolean().optional(),
});

export const updateItemSpecificationSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  values: z.array(z.string().min(1)).optional(),
  unit: z.string().nullable().optional(),
  filterable: z.boolean().optional(),
  status: itemCatalogStatusSchema.optional(),
});

export type ItemSpecificationTypeDTO = z.infer<typeof itemSpecificationTypeSchema>;
export type ItemSpecificationDTO = z.infer<typeof itemSpecificationSchema>;
export type CreateItemSpecificationDTO = z.infer<typeof createItemSpecificationSchema>;
export type UpdateItemSpecificationDTO = z.infer<typeof updateItemSpecificationSchema>;
