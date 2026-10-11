import { Money } from "../money/index.js";
import type { Asset, AssetRepository, AssetScope } from "./asset.js";
import type { AssetCategoryRepository, DepreciationMethod } from "./asset-category.js";
import { AssetCategoryNotFoundError, DuplicateAssetCodeError, InvalidAssetError } from "./errors.js";
import { assertRecordIdIsNew } from "../records/duplicate-record-id.js";

export interface CreateAssetCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly categoryId: string;
  readonly scope?: AssetScope;
  readonly branchId?: string | null;
  readonly warehouseId?: string | null;
  readonly acquisitionDate: string;
  readonly acquisitionCost: Money;
  readonly depreciationStartDate?: string;
  readonly depreciationMethod?: DepreciationMethod;
  readonly usefulLifeMonths?: number;
  readonly salvageValue?: Money;
  readonly assetAccountId?: string | null;
  readonly depreciationExpenseAccountId?: string | null;
  readonly accumulatedDepreciationAccountId?: string | null;
  readonly notes?: string | null;
  readonly projectId?: string | null;
  readonly internalHourlyRate?: Money | null;
}

export interface CreateAssetDeps {
  readonly assets: AssetRepository;
  readonly categories: AssetCategoryRepository;
}

/**
 * Validates a new-asset command (code uniqueness, scope/branch/warehouse
 * consistency, category existence), applies the category's defaults for
 * whatever the command omits — including computing the salvage value from the
 * category's `defaultSalvagePercent` with exact bigint math when not given
 * explicitly — and persists it. New assets always start `active` with zero
 * accumulated depreciation.
 */
export async function createAsset(command: CreateAssetCommand, deps: CreateAssetDeps): Promise<Asset> {
  const existing = await deps.assets.list();
  assertRecordIdIsNew(existing.find((row) => row.id === command.id), command.id);
  if (existing.some((a) => a.code === command.code)) {
    throw new DuplicateAssetCodeError(command.code);
  }

  const scope = command.scope ?? "general";
  const reasons: string[] = [];
  if (scope === "branch" && !command.branchId) {
    reasons.push("الأصول ذات النطاق (فرع) تتطلب تحديد الفرع");
  }
  if (scope === "warehouse" && !command.warehouseId) {
    reasons.push("الأصول ذات النطاق (مخزن) تتطلب تحديد المخزن");
  }
  if (reasons.length > 0) throw new InvalidAssetError(reasons);

  const category = await deps.categories.findById(command.categoryId);
  if (!category) throw new AssetCategoryNotFoundError(command.categoryId);

  const salvageValue =
    command.salvageValue ??
    Money.fromScaled(
      (command.acquisitionCost.scaled * BigInt(Math.round(category.defaultSalvagePercent * 100))) / 10000n,
    );

  const asset: Asset = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    categoryId: command.categoryId,
    scope,
    branchId: command.branchId ?? null,
    warehouseId: command.warehouseId ?? null,
    acquisitionDate: command.acquisitionDate,
    acquisitionCost: command.acquisitionCost,
    depreciationStartDate: command.depreciationStartDate ?? command.acquisitionDate,
    depreciationMethod: command.depreciationMethod ?? category.defaultDepreciationMethod,
    usefulLifeMonths: command.usefulLifeMonths ?? category.defaultUsefulLifeMonths,
    salvageValue,
    accumulatedDepreciation: Money.zero(),
    status: "active",
    assetAccountId: command.assetAccountId ?? null,
    depreciationExpenseAccountId: command.depreciationExpenseAccountId ?? null,
    accumulatedDepreciationAccountId: command.accumulatedDepreciationAccountId ?? null,
    notes: command.notes ?? null,
    projectId: command.projectId ?? null,
    internalHourlyRate: command.internalHourlyRate ?? null,
  };

  await deps.assets.create(asset);
  return asset;
}
