import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contract for Items (docs/archive/catalog/03-inventory.md "الأصناف"). Money
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
/**
 * What an item's costing method may READ BACK as.
 *
 * `FIFO` stays here because rows already carry it and a stored value the
 * contract refuses to parse would make those items unreadable.
 */
export const costingMethodSchema = z.enum(["WAC", "FIFO"]);

/**
 * What an item's costing method may be SET TO — WAC only (D146).
 *
 * The valuation engine is weighted-average end to end (`inventory/wac.ts`,
 * `wac-math.ts`, `WacSnapshot`); the cost layers beside it order batch draw-down
 * for FEFO and are not a second costing engine. Nothing anywhere reads
 * `costingMethod`, so an item set to FIFO was valued WAC, issued at a WAC unit
 * cost and reported at a WAC figure — while the item screen told the user it
 * was «الأقدم أولاً (FIFO)».
 *
 * Offering a choice the engine ignores is the failure this codebase keeps
 * shipping (DEC-1's `minAmount`, D72's purchasing toggles, D116's permissions):
 * on screen it is indistinguishable from one that works. So the choice is
 * withdrawn until the engine can honour it, rather than left as decoration.
 */
export const settableCostingMethodSchema = z.enum(["WAC"]);
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
  /** The brand's id (R5.10) — replaces the free-text `brand`. */
  brandId: z.string().nullable(),
  seasonId: z.string().nullable(),
  description: z.string().nullable(),
  defaultSupplierId: z.string().nullable(),
  specifications: z.array(z.object({ code: z.string(), value: z.string() })),
  costingMethod: costingMethodSchema,
  salePrice: moneyString.nullable(),
  costPrice: moneyString.nullable(),
  taxRatePercent: z.number(),
  trackInventory: z.boolean(),
  trackBatches: z.boolean(),
  trackExpiry: z.boolean(),
  reorderPoint: z.number().nullable(),
  imageAttachmentId: z.string().nullable(),
  reorderQty: z.number().nullable(),
  revenueAccountId: z.string().nullable(),
  cogsAccountId: z.string().nullable(),
  inventoryAccountId: z.string().nullable(),
  etaCodeType: etaCodeTypeSchema.nullable(),
  etaItemCode: z.string().nullable(),
  gpcCode: z.string().nullable(),
  status: itemStatusSchema,
  /**
   * On-hand quantity across every warehouse, and where it sits against the
   * reorder point (R5.2). Both are null for an item that does not hold stock:
   * reporting zero would file a service under "out of stock". Present on the
   * list; the detail carries the fuller `stock` block.
   */
  onHand: z.string().nullable().optional(),
  stockState: z.enum(["out", "low", "ok"]).nullable().optional(),
});

export const createItemSchema = z.object({
  id: z.string().min(1),
  /** Omitted or blank, the server allocates the next free ITM-###### code. */
  code: z.string().trim().min(1).optional(),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  type: itemTypeSchema,
  baseUnitCode: z.string().min(1),
  alternateUnits: z.array(alternateUnitSchema).optional(),
  barcodes: z.array(z.string()).optional(),
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  seasonId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  defaultSupplierId: z.string().nullable().optional(),
  specifications: z.array(z.object({ code: z.string().min(1), value: z.string() })).optional(),
  costingMethod: settableCostingMethodSchema.optional(),
  salePrice: moneyString.nullable().optional(),
  costPrice: moneyString.nullable().optional(),
  taxRatePercent: z.number().optional(),
  trackInventory: z.boolean().optional(),
  trackBatches: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  reorderPoint: z.number().nullable().optional(),
  imageAttachmentId: z.string().nullable().optional(),
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
  brandId: z.string().nullable().optional(),
  seasonId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  defaultSupplierId: z.string().nullable().optional(),
  specifications: z.array(z.object({ code: z.string().min(1), value: z.string() })).optional(),
  costingMethod: settableCostingMethodSchema.optional(),
  salePrice: moneyString.nullable().optional(),
  costPrice: moneyString.nullable().optional(),
  taxRatePercent: z.number().optional(),
  trackInventory: z.boolean().optional(),
  trackBatches: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  reorderPoint: z.number().nullable().optional(),
  imageAttachmentId: z.string().nullable().optional(),
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

// --- العلامات التجارية والمواسم (R5.10) ---------------------------------

export const itemCatalogStatusSchema = z.enum(["active", "inactive"]);

export const upsertItemBrandSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  status: itemCatalogStatusSchema.optional(),
});

export const upsertItemSeasonSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  status: itemCatalogStatusSchema.optional(),
});

export const itemBrandSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  status: itemCatalogStatusSchema,
});

export const itemSeasonSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: itemCatalogStatusSchema,
});

export type UpsertItemBrandDTO = z.infer<typeof upsertItemBrandSchema>;
export type UpsertItemSeasonDTO = z.infer<typeof upsertItemSeasonSchema>;
export type ItemBrandDTO = z.infer<typeof itemBrandSchema>;
export type ItemSeasonDTO = z.infer<typeof itemSeasonSchema>;
