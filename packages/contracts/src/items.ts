import { z } from "zod";

/**
 * Wire contract for Items (docs/catalog/03-inventory.md "الأصناف"). Money
 * crosses the wire as an exact decimal string, never a float (mirrors
 * journal.ts) — the domain re-parses these strings into `Money`. The
 * alternate-unit conversion `factor` is a plain ratio, not a ledger amount,
 * so it stays a `number`.
 */
/**
 * The six item types (R5.1). `stock` is the stored identifier for منتج
 * (product) — it keeps its old value so existing rows need no migration. What
 * each type may do lives in the domain's capability table, not in checks
 * against these strings.
 */
export const itemTypeSchema = z.enum(["stock", "service", "raw_material", "finished_good", "consumable", "recipe"]);
export const costingMethodSchema = z.enum(["WAC", "FIFO"]);
export const itemStatusSchema = z.enum(["active", "inactive"]);
export const etaCodeTypeSchema = z.enum(["EGS", "GPC"]);

export const alternateUnitSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  factor: z.number().positive(),
});

export const itemSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  type: itemTypeSchema,
  baseUnitCode: z.string().min(1),
  alternateUnits: z.array(alternateUnitSchema),
  barcodes: z.array(z.string()),
  categoryId: z.string().nullable(),
  brand: z.string().nullable(),
  costingMethod: costingMethodSchema,
  salePrice: z.string().nullable(),
  costPrice: z.string().nullable(),
  taxRatePercent: z.number(),
  trackInventory: z.boolean(),
  trackBatches: z.boolean(),
  trackExpiry: z.boolean(),
  reorderPoint: z.number().nullable(),
  reorderQty: z.number().nullable(),
  revenueAccountId: z.string().nullable(),
  cogsAccountId: z.string().nullable(),
  inventoryAccountId: z.string().nullable(),
  etaCodeType: etaCodeTypeSchema.nullable(),
  etaItemCode: z.string().nullable(),
  gpcCode: z.string().nullable(),
  status: itemStatusSchema,
});

export const createItemSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  type: itemTypeSchema,
  baseUnitCode: z.string().min(1),
  alternateUnits: z.array(alternateUnitSchema).optional(),
  barcodes: z.array(z.string()).optional(),
  categoryId: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  costingMethod: costingMethodSchema.optional(),
  salePrice: z.string().nullable().optional(),
  costPrice: z.string().nullable().optional(),
  taxRatePercent: z.number().optional(),
  trackInventory: z.boolean().optional(),
  trackBatches: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  reorderPoint: z.number().nullable().optional(),
  reorderQty: z.number().nullable().optional(),
  revenueAccountId: z.string().nullable().optional(),
  cogsAccountId: z.string().nullable().optional(),
  inventoryAccountId: z.string().nullable().optional(),
  etaCodeType: etaCodeTypeSchema.nullable().optional(),
  etaItemCode: z.string().nullable().optional(),
  gpcCode: z.string().nullable().optional(),
});

/** All fields optional (and no `code`, which is immutable after creation) — a PATCH applies only what's supplied. */
export const updateItemSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  type: itemTypeSchema.optional(),
  baseUnitCode: z.string().min(1).optional(),
  alternateUnits: z.array(alternateUnitSchema).optional(),
  barcodes: z.array(z.string()).optional(),
  categoryId: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  costingMethod: costingMethodSchema.optional(),
  salePrice: z.string().nullable().optional(),
  costPrice: z.string().nullable().optional(),
  taxRatePercent: z.number().optional(),
  trackInventory: z.boolean().optional(),
  trackBatches: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  reorderPoint: z.number().nullable().optional(),
  reorderQty: z.number().nullable().optional(),
  revenueAccountId: z.string().nullable().optional(),
  cogsAccountId: z.string().nullable().optional(),
  inventoryAccountId: z.string().nullable().optional(),
  etaCodeType: etaCodeTypeSchema.nullable().optional(),
  etaItemCode: z.string().nullable().optional(),
  gpcCode: z.string().nullable().optional(),
  status: itemStatusSchema.optional(),
});

export type ItemTypeDTO = z.infer<typeof itemTypeSchema>;
export type CostingMethodDTO = z.infer<typeof costingMethodSchema>;
export type ItemStatusDTO = z.infer<typeof itemStatusSchema>;
export type EtaCodeTypeDTO = z.infer<typeof etaCodeTypeSchema>;
export type AlternateUnitDTO = z.infer<typeof alternateUnitSchema>;
export type ItemDTO = z.infer<typeof itemSchema>;
export type CreateItemDTO = z.infer<typeof createItemSchema>;
export type UpdateItemDTO = z.infer<typeof updateItemSchema>;
