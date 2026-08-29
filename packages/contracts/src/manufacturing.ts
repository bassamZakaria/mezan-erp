import { z } from "zod";

/**
 * Wire contracts for the manufacturing module (docs/archive/catalog/07): قوائم المواد
 * (BOMs), أوامر التصنيع (Work Orders), المنتجات القابلة للتهيئة (Configurable
 * Products) and التصنيع المخصص (Custom Manufacturing). Money and Qty cross the
 * wire as EXACT decimal strings — never floats.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be an exact decimal string");
const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");
const isoDate = z.string().min(1);

export const activationStatusSchema = z.enum(["active", "inactive"]);
export const workOrderStatusSchema = z.enum(["planned", "in_progress", "completed", "cancelled"]);
export const workOrderStageSchema = z.enum([
  "not_started",
  "started",
  "materials_issued",
  "product_received",
  "completed",
]);
export const workOrderPrioritySchema = z.enum(["low", "normal", "high"]);
export const configInstanceStatusSchema = z.enum([
  "configured",
  "in_progress",
  "produced",
  "closed",
  "cancelled",
]);
export const pricingMethodSchema = z.enum(["manual", "formula"]);
export const itemPolicySchema = z.enum(["per_order", "per_spec"]);

// --- BOM -------------------------------------------------------------------

export const createBomLineSchema = z.object({
  itemId: z.string().min(1),
  qty: positiveDecimalString,
  wastePercent: z.number().min(0).optional(),
  optional: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export const createBomSchema = z.object({
  id: z.string().min(1),
  productItemId: z.string().min(1),
  standardQty: positiveDecimalString,
  unit: z.string().min(1),
  laborCost: positiveDecimalString.optional(),
  overheadCost: positiveDecimalString.optional(),
  versionNotes: z.string().nullable().optional(),
  lines: z.array(createBomLineSchema).min(1),
});

export const createBomVersionSchema = z.object({
  id: z.string().min(1),
  sourceBomId: z.string().min(1),
  standardQty: positiveDecimalString.optional(),
  unit: z.string().min(1).optional(),
  laborCost: positiveDecimalString.optional(),
  overheadCost: positiveDecimalString.optional(),
  versionNotes: z.string().nullable().optional(),
  lines: z.array(createBomLineSchema).min(1).optional(),
});

export const bomLineSchema = z.object({
  itemId: z.string(),
  qty: decimalString,
  wastePercent: z.number(),
  optional: z.boolean(),
  notes: z.string().nullable(),
});

export const bomSchema = z.object({
  id: z.string(),
  number: z.string(),
  productItemId: z.string(),
  version: z.number(),
  standardQty: decimalString,
  unit: z.string(),
  laborCost: decimalString,
  overheadCost: decimalString,
  versionNotes: z.string().nullable(),
  lines: z.array(bomLineSchema),
  status: activationStatusSchema,
  custom: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
});

// --- Work Order ------------------------------------------------------------

export const createWorkOrderSchema = z.object({
  id: z.string().min(1),
  bomId: z.string().min(1),
  plannedQty: positiveDecimalString,
  sourceWarehouseId: z.string().min(1),
  /**
   * مستودع التشغيل — the warehouse issued material physically stands in while
   * it is worked on. Required: without it صرف المواد has nowhere to put the
   * goods and a shop-floor count has no system quantity to reconcile against.
   */
  wipWarehouseId: z.string().min(1),
  destinationWarehouseId: z.string().min(1),
  priority: workOrderPrioritySchema.optional(),
  scheduledStartDate: isoDate,
  scheduledEndDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * محطة العمل + المشغّل on a shop-floor action (R9.1). Both are ids into their
 * own registries (`/work-stations`, `/employees`); the route resolves them
 * before the domain records anything, so a movement can never name a station
 * that does not exist.
 */
export const shopFloorAttributionSchema = z.object({
  stationId: z.string().min(1).nullable().optional(),
  operatorId: z.string().min(1).nullable().optional(),
});

export const workOrderLineActionSchema = shopFloorAttributionSchema.extend({
  lines: z.array(z.object({ itemId: z.string().min(1), qty: positiveDecimalString })).min(1),
});

export const receiveProductSchema = shopFloorAttributionSchema.extend({
  producedQty: positiveDecimalString,
});

export const issueMaterialsSchema = shopFloorAttributionSchema;

// --- Work Station ----------------------------------------------------------

export const workStationSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  notes: z.string().nullable(),
  status: activationStatusSchema,
  createdAt: z.string(),
});

export const createWorkStationSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const workOrderShopFloorEntrySchema = z.object({
  kind: z.enum(["issue", "extra_issue", "return", "waste", "receive"]),
  stationId: z.string().nullable(),
  operatorId: z.string().nullable(),
  /** The issue/receipt id whose movements this action produced; null for a waste log. */
  ref: z.string().nullable(),
  at: z.string(),
});

export const logCostSchema = z.object({
  kind: z.enum(["labor", "overhead", "other"]),
  amount: positiveDecimalString,
  notes: z.string().nullable().optional(),
});

export const logWasteSchema = shopFloorAttributionSchema.extend({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: positiveDecimalString,
        notes: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

// --- Configurable Product --------------------------------------------------

export const configInputSchema = z.object({
  id: z.string().min(1),
  labelAr: z.string().min(1),
  labelEn: z.string().nullable().optional(),
  type: z.literal("number").optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

export const materialFormulaSchema = z.object({
  itemId: z.string().min(1),
  qtyFormula: z.string().min(1),
  wastePercent: z.number().min(0).optional(),
});

export const upsertConfigurableProductSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  outputItemId: z.string().min(1),
  unit: z.string().min(1),
  description: z.string().nullable().optional(),
  inputs: z.array(configInputSchema).min(1),
  materials: z.array(materialFormulaSchema).min(1),
  pricingMethod: pricingMethodSchema.optional(),
  priceFormula: z.string().nullable().optional(),
  laborFormula: z.string().nullable().optional(),
  overheadFormula: z.string().nullable().optional(),
  itemPolicy: itemPolicySchema.optional(),
});

// --- Config Instance (Custom Manufacturing Order) --------------------------

export const createConfigInstanceSchema = z.object({
  id: z.string().min(1),
  configurableProductId: z.string().min(1),
  spec: z.record(z.string(), z.string()),
  qty: positiveDecimalString,
  customerId: z.string().nullable().optional(),
  sellUnitPrice: positiveDecimalString.nullable().optional(),
  notes: z.string().nullable().optional(),
  sourceWarehouseId: z.string().min(1),
  wipWarehouseId: z.string().min(1),
  destinationWarehouseId: z.string().min(1),
  scheduledStartDate: isoDate,
  scheduledEndDate: z.string().nullable().optional(),
});

/** Preview a configurable product's materials/cost/price for a spec (no persistence). */
export const previewConfigInstanceSchema = z.object({
  configurableProductId: z.string().min(1),
  spec: z.record(z.string(), z.string()),
});

export type ActivationStatusDTO = z.infer<typeof activationStatusSchema>;
export type WorkOrderStatusDTO = z.infer<typeof workOrderStatusSchema>;
export type WorkOrderStageDTO = z.infer<typeof workOrderStageSchema>;
export type WorkOrderPriorityDTO = z.infer<typeof workOrderPrioritySchema>;
export type ConfigInstanceStatusDTO = z.infer<typeof configInstanceStatusSchema>;
export type PricingMethodDTO = z.infer<typeof pricingMethodSchema>;
export type ItemPolicyDTO = z.infer<typeof itemPolicySchema>;
export type CreateBomDTO = z.infer<typeof createBomSchema>;
export type CreateBomVersionDTO = z.infer<typeof createBomVersionSchema>;
export type BomDTO = z.infer<typeof bomSchema>;
export type CreateWorkOrderDTO = z.infer<typeof createWorkOrderSchema>;
export type WorkOrderLineActionDTO = z.infer<typeof workOrderLineActionSchema>;
export type ReceiveProductDTO = z.infer<typeof receiveProductSchema>;
export type LogCostDTO = z.infer<typeof logCostSchema>;
export type LogWasteDTO = z.infer<typeof logWasteSchema>;
export type ShopFloorAttributionDTO = z.infer<typeof shopFloorAttributionSchema>;
export type IssueMaterialsDTO = z.infer<typeof issueMaterialsSchema>;
export type WorkStationDTO = z.infer<typeof workStationSchema>;
export type CreateWorkStationDTO = z.infer<typeof createWorkStationSchema>;
export type WorkOrderShopFloorEntryDTO = z.infer<typeof workOrderShopFloorEntrySchema>;
export type ConfigInputDTO = z.infer<typeof configInputSchema>;
export type MaterialFormulaDTO = z.infer<typeof materialFormulaSchema>;
export type UpsertConfigurableProductDTO = z.infer<typeof upsertConfigurableProductSchema>;
export type CreateConfigInstanceDTO = z.infer<typeof createConfigInstanceSchema>;
export type PreviewConfigInstanceDTO = z.infer<typeof previewConfigInstanceSchema>;
