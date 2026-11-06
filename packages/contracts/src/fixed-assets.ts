import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { isoDateOrInstant } from "./iso-date.js";
import { clientSuppliedId } from "./client-supplied-id.js";

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
  id: clientSuppliedId,
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

export const assetInternalRateRowSchema = z.object({
  effectiveFrom: z.string(),
  hourlyRate: moneyString,
  setBy: z.string().nullable(),
  setAt: z.string(),
});
export type AssetInternalRateRowDTO = z.infer<typeof assetInternalRateRowSchema>;

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
  /** بُعد المشروع — the contracting project this asset is assigned to. */
  projectId: z.string().nullable(),
  /** سعر الساعة الداخلي — the rate in force TODAY. What a log is priced at comes from `rateHistory`. */
  internalHourlyRate: moneyString.nullable(),
  /** تاريخ سعر الساعة الداخلي, oldest first. A log resolves the row effective on its own date. */
  rateHistory: z.array(assetInternalRateRowSchema),
});

export const createAssetSchema = z.object({
  id: clientSuppliedId,
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
  projectId: z.string().nullable().optional(),
  internalHourlyRate: moneyString.nullable().optional(),
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
  skippedLines: z.array(z.object({ assetId: z.string().min(1), assetCode: z.string(), amount: moneyString })).optional(),
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
  date: isoDateOrInstant,
  /** Sale price; omit or zero for a scrapped asset. */
  proceeds: z.string().optional(),
  /** Where the proceeds land — required when there are any. */
  proceedsAccountId: z.string().nullish(),
  notes: z.string().nullish(),
});
export type DisposeAssetDTO = z.infer<typeof disposeAssetSchema>;

/** WIRE CONTRACT: mirrors @mezan/domain's `DisposalProceedsAccountKind`; the values must stay equal. */
export enum DisposalProceedsAccountKind {
  Cash = "cash",
  Receivable = "receivable",
}

/** An account a disposal's sale proceeds may land in — the cash set, or a receivable the buyer still owes. */
export const disposalProceedsAccountSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  kind: z.nativeEnum(DisposalProceedsAccountKind),
});
export type DisposalProceedsAccountDTO = z.infer<typeof disposalProceedsAccountSchema>;
export type DepreciationRunStatusDTO = z.infer<typeof depreciationRunStatusSchema>;
export type DepreciationRunLineDTO = z.infer<typeof depreciationRunLineSchema>;
export type DepreciationRunDTO = z.infer<typeof depreciationRunSchema>;
export type CreateDepreciationRunDTO = z.infer<typeof createDepreciationRunSchema>;

/**
 * سعر الساعة الداخلي — the ONLY writable path to the rate every سجل تشغيل
 * معدات charges to a project. It is a separate, permissioned, audited edit
 * because the number ends up in WIP, then in cost, then in the percentage of
 * completion, then in recognised revenue.
 */
/** شروط الإهلاك — editable until depreciation posts on the asset. Every field is optional; at least one is sent. */
export const updateDepreciationTermsSchema = z
  .object({
    depreciationStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب بصيغة YYYY-MM-DD").optional(),
    usefulLifeMonths: z.number().int().positive().optional(),
    salvageValue: nonNegativeMoneyString.optional(),
  })
  .refine((v) => v.depreciationStartDate !== undefined || v.usefulLifeMonths !== undefined || v.salvageValue !== undefined, "أرسل حقلاً واحداً على الأقل");
export type UpdateDepreciationTermsDTO = z.infer<typeof updateDepreciationTermsSchema>;

export const setInternalHourlyRateSchema = z.object({
  hourlyRate: moneyString.nullable(),
  /** `YYYY-MM-DD`; the tenant's today when omitted. Never the instant the edit was made. */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب بصيغة YYYY-MM-DD").optional(),
  reason: z.string().max(500).nullable().optional(),
});
export type SetInternalHourlyRateDTO = z.infer<typeof setInternalHourlyRateSchema>;
