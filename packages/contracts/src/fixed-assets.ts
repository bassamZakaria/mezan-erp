import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contracts for Fixed Assets (docs/archive/catalog/07-mfg-projects-assets.md
 * "الأصول الثابتة"): Asset Categories, the Asset Register, and Depreciation
 * Runs. Money fields cross the wire as exact decimal strings, never a float —
 * the domain re-parses them via `Money.fromMajor`.
 */

export const depreciationMethodSchema = z.enum(["straight_line"]);
export const assetScopeSchema = z.enum(["general", "branch", "warehouse"]);
export const assetStatusSchema = z.enum(["active", "under_maintenance", "fully_depreciated", "disposed"]);

export const assetCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  defaultDepreciationMethod: depreciationMethodSchema,
  defaultUsefulLifeMonths: z.number().int().positive(),
  defaultSalvagePercent: z.number().min(0).max(100),
  assetAccountId: z.string().nullable(),
  depreciationExpenseAccountId: z.string().nullable(),
  accumulatedDepreciationAccountId: z.string().nullable(),
  gainOnDisposalAccountId: z.string().nullable(),
  lossOnDisposalAccountId: z.string().nullable(),
  active: z.boolean(),
});

export const createAssetCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  defaultDepreciationMethod: depreciationMethodSchema.optional(),
  defaultUsefulLifeMonths: z.number().int().positive(),
  defaultSalvagePercent: z.number().min(0).max(100),
  assetAccountId: z.string().nullable().optional(),
  depreciationExpenseAccountId: z.string().nullable().optional(),
  accumulatedDepreciationAccountId: z.string().nullable().optional(),
  gainOnDisposalAccountId: z.string().nullable().optional(),
  lossOnDisposalAccountId: z.string().nullable().optional(),
});

export const assetSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  categoryId: z.string().min(1),
  scope: assetScopeSchema,
  branchId: z.string().nullable(),
  warehouseId: z.string().nullable(),
  acquisitionDate: z.string(),
  acquisitionCost: z.string(),
  depreciationStartDate: z.string(),
  depreciationMethod: depreciationMethodSchema,
  usefulLifeMonths: z.number().int().positive(),
  salvageValue: z.string(),
  accumulatedDepreciation: z.string(),
  status: assetStatusSchema,
  assetAccountId: z.string().nullable(),
  depreciationExpenseAccountId: z.string().nullable(),
  accumulatedDepreciationAccountId: z.string().nullable(),
  notes: z.string().nullable(),
});

export const createAssetSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  categoryId: z.string().min(1),
  scope: assetScopeSchema.optional(),
  branchId: z.string().nullable().optional(),
  warehouseId: z.string().nullable().optional(),
  acquisitionDate: z.string(),
  acquisitionCost: z.string(),
  depreciationStartDate: z.string().optional(),
  depreciationMethod: depreciationMethodSchema.optional(),
  usefulLifeMonths: z.number().int().positive().optional(),
  salvageValue: z.string().optional(),
  assetAccountId: z.string().nullable().optional(),
  depreciationExpenseAccountId: z.string().nullable().optional(),
  accumulatedDepreciationAccountId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const depreciationRunStatusSchema = z.enum(["draft", "posted", "cancelled"]);

export const depreciationRunLineSchema = z.object({
  assetId: z.string().min(1),
  amount: moneyString,
});

export const depreciationRunSchema = z.object({
  id: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  branchId: z.string().nullable(),
  status: depreciationRunStatusSchema,
  lines: z.array(depreciationRunLineSchema),
  totalAmount: moneyString,
  journalEntryId: z.string().nullable(),
  createdAt: z.string(),
  postedAt: z.string().nullable(),
});

export const createDepreciationRunSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  branchId: z.string().nullable().optional(),
});

export type DepreciationMethodDTO = z.infer<typeof depreciationMethodSchema>;
export type AssetScopeDTO = z.infer<typeof assetScopeSchema>;
export type AssetStatusDTO = z.infer<typeof assetStatusSchema>;
export type AssetCategoryDTO = z.infer<typeof assetCategorySchema>;
export type CreateAssetCategoryDTO = z.infer<typeof createAssetCategorySchema>;
export type AssetDTO = z.infer<typeof assetSchema>;
export type CreateAssetDTO = z.infer<typeof createAssetSchema>;

/** التخلص من أصل — retire an asset, recognising the gain or loss against any proceeds. */
export const disposeAssetSchema = z.object({
  date: z.string().min(1),
  /** Sale price; omit or zero for a scrapped asset. */
  proceeds: z.string().optional(),
  /** Where the proceeds land — required when there are any. */
  proceedsAccountId: z.string().nullish(),
  notes: z.string().nullish(),
});
export type DisposeAssetDTO = z.infer<typeof disposeAssetSchema>;
export type DepreciationRunStatusDTO = z.infer<typeof depreciationRunStatusSchema>;
export type DepreciationRunLineDTO = z.infer<typeof depreciationRunLineSchema>;
export type DepreciationRunDTO = z.infer<typeof depreciationRunSchema>;
export type CreateDepreciationRunDTO = z.infer<typeof createDepreciationRunSchema>;
