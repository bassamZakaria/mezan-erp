import { z } from "zod";

/**
 * Wire contracts for Promotions (docs/catalog/01-sales.md §"العروض").
 *
 * Money and quantities cross the wire as exact decimal strings, never floats —
 * the boundary that keeps the "no floats, ever" ledger invariant true end to end
 * (docs/plan.md §2.3). The API re-parses these strings into `Money` / `Qty`.
 */

export const promotionTypeSchema = z.enum(["percentage", "fixed_amount", "special_price", "buy_x_get_y", "bundle"]);

export const promotionScopeSchema = z.object({
  type: z.enum(["all", "item", "category"]),
  ids: z.array(z.string().min(1)),
});

export const promotionBundleComponentSchema = z.object({
  itemId: z.string().min(1),
  qty: z.string(),
});

export const promotionDayHourRestrictionSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
});

export const promotionSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  priority: z.number().int(),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  description: z.string().nullable(),
  type: promotionTypeSchema,
  percentValue: z.number().nullable(),
  amountValue: z.string().nullable(),
  minInvoiceValue: z.string().nullable(),
  minQty: z.string().nullable(),
  maxDiscountAmount: z.string().nullable(),
  buyQty: z.number().int().nullable(),
  getQty: z.number().int().nullable(),
  bundleComponents: z.array(promotionBundleComponentSchema),
  requiresCoupon: z.boolean(),
  dayHourRestriction: promotionDayHourRestrictionSchema.nullable(),
  scope: promotionScopeSchema,
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  active: z.boolean(),
  createdAt: z.string().min(1),
});

export const createPromotionSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1),
  priority: z.number().int().optional(),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  description: z.string().nullish(),
  type: promotionTypeSchema,
  percentValue: z.number().nullish(),
  amountValue: z.string().nullish(),
  minInvoiceValue: z.string().nullish(),
  minQty: z.string().nullish(),
  maxDiscountAmount: z.string().nullish(),
  buyQty: z.number().int().nullish(),
  getQty: z.number().int().nullish(),
  bundleComponents: z.array(promotionBundleComponentSchema).optional(),
  requiresCoupon: z.boolean().optional(),
  dayHourRestriction: promotionDayHourRestrictionSchema.nullish(),
  scope: promotionScopeSchema.optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  active: z.boolean().optional(),
});

/** All fields optional — a PATCH applies only what's supplied. */
export const updatePromotionSchema = z.object({
  code: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullish(),
  description: z.string().nullish(),
  type: promotionTypeSchema.optional(),
  percentValue: z.number().nullish(),
  amountValue: z.string().nullish(),
  minInvoiceValue: z.string().nullish(),
  minQty: z.string().nullish(),
  maxDiscountAmount: z.string().nullish(),
  buyQty: z.number().int().nullish(),
  getQty: z.number().int().nullish(),
  bundleComponents: z.array(promotionBundleComponentSchema).optional(),
  requiresCoupon: z.boolean().optional(),
  dayHourRestriction: promotionDayHourRestrictionSchema.nullish(),
  scope: promotionScopeSchema.optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

/** Preview which promotion(s) apply to a cart, without persisting anything. */
export const evaluatePromotionsQuerySchema = z.object({
  lines: z.array(
    z.object({
      lineId: z.string().min(1),
      itemId: z.string().min(1),
      categoryId: z.string().nullish(),
      qty: z.string(),
      unitPrice: z.string(),
    }),
  ),
  couponCode: z.string().nullish(),
  date: z.string().optional(),
  hour: z.number().int().min(0).max(23).optional(),
});

export type PromotionTypeDTO = z.infer<typeof promotionTypeSchema>;
export type PromotionScopeDTO = z.infer<typeof promotionScopeSchema>;
export type PromotionBundleComponentDTO = z.infer<typeof promotionBundleComponentSchema>;
export type PromotionDayHourRestrictionDTO = z.infer<typeof promotionDayHourRestrictionSchema>;
export type PromotionDTO = z.infer<typeof promotionSchema>;
export type CreatePromotionDTO = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionDTO = z.infer<typeof updatePromotionSchema>;
export type EvaluatePromotionsQueryDTO = z.infer<typeof evaluatePromotionsQuerySchema>;
