import { DuplicateAssetCategoryCodeError, InvalidAssetCategoryError } from "./errors.js";
import type { BilingualReason } from "../collections/errors.js";

/**
 * Fixed Assets — Asset Categories (docs/archive/catalog/07-mfg-projects-assets.md
 * "تصنيفات الأصول"). A category carries the defaults (depreciation method,
 * useful life, salvage %) new assets inherit, plus optional default GL account
 * overrides used at posting time when an asset itself has none configured.
 */

export type DepreciationMethod = "straight_line";

/**
 * Documented system-default GL account CODES for the catalog's asset
 * categories (docs/archive/catalog/07-mfg-projects-assets.md "تصنيفات الأصول"). These
 * are for documentation/UI helper-text use only — this domain layer never
 * looks them up or enforces them; every entity here only ever stores explicit
 * account ids.
 */
export const DEFAULT_ASSET_GL_ACCOUNT_CODES = {
  asset: "1500",
  depreciationExpense: "5400",
  accumulatedDepreciation: "1590",
  gainOnDisposal: "4500",
  lossOnDisposal: "5450",
} as const;

export interface AssetCategory {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly defaultDepreciationMethod: DepreciationMethod;
  readonly defaultUsefulLifeMonths: number;
  /** Percent, 0-100. */
  readonly defaultSalvagePercent: number;
  readonly assetAccountId: string | null;
  readonly depreciationExpenseAccountId: string | null;
  readonly accumulatedDepreciationAccountId: string | null;
  readonly gainOnDisposalAccountId: string | null;
  readonly lossOnDisposalAccountId: string | null;
  readonly active: boolean;
}

/** Persistence port for asset categories. The domain depends on this interface only — no SQL, no driver. */
export interface AssetCategoryRepository {
  findById(id: string): Promise<AssetCategory | null>;
  findByCode(code: string): Promise<AssetCategory | null>;
  list(): Promise<AssetCategory[]>;
  create(category: AssetCategory): Promise<void>;
  update(category: AssetCategory): Promise<void>;
}

export interface CreateAssetCategoryCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly defaultDepreciationMethod?: DepreciationMethod;
  readonly defaultUsefulLifeMonths: number;
  readonly defaultSalvagePercent: number;
  readonly assetAccountId?: string | null;
  readonly depreciationExpenseAccountId?: string | null;
  readonly accumulatedDepreciationAccountId?: string | null;
  readonly gainOnDisposalAccountId?: string | null;
  readonly lossOnDisposalAccountId?: string | null;
}

function validate(category: Pick<AssetCategory, "defaultSalvagePercent" | "defaultUsefulLifeMonths">): BilingualReason[] {
  const reasons: BilingualReason[] = [];
  if (category.defaultSalvagePercent < 0 || category.defaultSalvagePercent > 100) {
    reasons.push({ ar: "نسبة القيمة التخريدية الافتراضية يجب أن تكون بين 0 و 100", en: "The default salvage percentage must be between 0 and 100" });
  }
  if (category.defaultUsefulLifeMonths <= 0) {
    reasons.push({ ar: "العمر الإنتاجي الافتراضي (بالأشهر) يجب أن يكون أكبر من صفر", en: "The default useful life (in months) must be greater than zero" });
  }
  return reasons;
}

/**
 * Validates a new-asset-category command (code uniqueness, salvage % in
 * [0,100], useful life > 0) and persists it. New categories always start
 * `active`.
 */
export async function createAssetCategory(
  command: CreateAssetCategoryCommand,
  repo: AssetCategoryRepository,
): Promise<AssetCategory> {
  const existing = await repo.list();
  if (existing.some((c) => c.code === command.code)) {
    throw new DuplicateAssetCategoryCodeError(command.code);
  }

  const category: AssetCategory = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    defaultDepreciationMethod: command.defaultDepreciationMethod ?? "straight_line",
    defaultUsefulLifeMonths: command.defaultUsefulLifeMonths,
    defaultSalvagePercent: command.defaultSalvagePercent,
    assetAccountId: command.assetAccountId ?? null,
    depreciationExpenseAccountId: command.depreciationExpenseAccountId ?? null,
    accumulatedDepreciationAccountId: command.accumulatedDepreciationAccountId ?? null,
    gainOnDisposalAccountId: command.gainOnDisposalAccountId ?? null,
    lossOnDisposalAccountId: command.lossOnDisposalAccountId ?? null,
    active: true,
  };

  const reasons = validate(category);
  if (reasons.length > 0) throw new InvalidAssetCategoryError(reasons);

  await repo.create(category);
  return category;
}
