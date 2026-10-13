import { z } from "zod";
import { moneyString, nonNegativeQuantityString, quantityString } from "./money-string.js";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contract for price lists (docs/archive/catalog/01 "قوائم الأسعار"). Money is
 * always a decimal string on the wire — `price` here is an absolute
 * sell-price override for the line's item, not a discount percentage.
 * An item may repeat across lines, once per `minQty` tier.
 */
export const priceListLineSchema = z.object({
  itemId: z.string().min(1),
  unitCode: z.string().nullish(),
  /** Volume threshold this tier's price applies from. Omitted means the base tier ("0"). */
  minQty: nonNegativeQuantityString.optional(),
  price: moneyString,
});

/** What the server serialises back: every tier carries its threshold explicitly. */
export const priceListLineViewSchema = z.object({
  itemId: z.string().min(1),
  unitCode: z.string().nullable(),
  minQty: quantityString,
  price: moneyString,
});

export const priceListSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  description: z.string().nullable(),
  isBase: z.boolean(),
  active: z.boolean(),
  lines: z.array(priceListLineViewSchema),
  createdAt: z.string(),
});

export const createPriceListSchema = z.object({
  id: clientSuppliedId.optional(),
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

/**
 * Resolves the tier that applies to a line — the server-side answer to "what
 * does this customer pay for this item at this quantity", so no screen has to
 * reimplement tier selection in the browser.
 */
export const resolvePriceListPriceSchema = z.object({
  priceListId: z.string().min(1).nullish(),
  customerId: z.string().min(1).nullish(),
  itemId: z.string().min(1),
  qty: nonNegativeQuantityString.optional(),
  fallback: z.string(),
});

export type PriceListLineDTO = z.infer<typeof priceListLineSchema>;
export type PriceListLineViewDTO = z.infer<typeof priceListLineViewSchema>;
export type ResolvePriceListPriceDTO = z.infer<typeof resolvePriceListPriceSchema>;
export type PriceListDTO = z.infer<typeof priceListSchema>;
export type CreatePriceListDTO = z.infer<typeof createPriceListSchema>;
export type UpdatePriceListDTO = z.infer<typeof updatePriceListSchema>;
