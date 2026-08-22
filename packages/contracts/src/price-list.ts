import { z } from "zod";

/**
 * Wire contract for price lists (docs/catalog/01 "قوائم الأسعار"). Money is
 * always a decimal string on the wire — `price` here is an absolute
 * sell-price override for the line's item, not a discount percentage.
 */
export const priceListLineSchema = z.object({
  itemId: z.string().min(1),
  price: z.string(),
});

export const priceListSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  description: z.string().nullable(),
  isBase: z.boolean(),
  active: z.boolean(),
  lines: z.array(priceListLineSchema),
  createdAt: z.string(),
});

export const createPriceListSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  description: z.string().nullish(),
  isBase: z.boolean().optional(),
  lines: z.array(priceListLineSchema).optional(),
});

/** All fields optional — a PATCH applies only what's supplied. */
export const updatePriceListSchema = z.object({
  code: z.string().min(1).optional(),
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullish(),
  description: z.string().nullish(),
  isBase: z.boolean().optional(),
  active: z.boolean().optional(),
  lines: z.array(priceListLineSchema).optional(),
});

export type PriceListLineDTO = z.infer<typeof priceListLineSchema>;
export type PriceListDTO = z.infer<typeof priceListSchema>;
export type CreatePriceListDTO = z.infer<typeof createPriceListSchema>;
export type UpdatePriceListDTO = z.infer<typeof updatePriceListSchema>;
