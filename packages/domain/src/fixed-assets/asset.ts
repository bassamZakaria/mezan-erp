import type { Money } from "../money/index.js";
import type { DepreciationMethod } from "./asset-category.js";

/**
 * Fixed Assets — Asset Register (docs/archive/catalog/07-mfg-projects-assets.md
 * "سجل الأصول"). Each asset carries its own depreciation schedule inputs
 * (method/useful life/salvage, seeded from its category but overridable) and
 * tracks running `accumulatedDepreciation` as depreciation runs post against it.
 */

export type AssetScope = "general" | "branch" | "warehouse";
export type AssetStatus = "active" | "under_maintenance" | "fully_depreciated" | "disposed";

export interface Asset {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly categoryId: string;
  readonly scope: AssetScope;
  readonly branchId: string | null;
  readonly warehouseId: string | null;
  readonly acquisitionDate: string;
  readonly acquisitionCost: Money;
  readonly depreciationStartDate: string;
  readonly depreciationMethod: DepreciationMethod;
  readonly usefulLifeMonths: number;
  readonly salvageValue: Money;
  readonly accumulatedDepreciation: Money;
  readonly status: AssetStatus;
  /** GL account overrides; null falls back to the category's default at posting time. */
  readonly assetAccountId: string | null;
  readonly depreciationExpenseAccountId: string | null;
  readonly accumulatedDepreciationAccountId: string | null;
  readonly notes: string | null;
  /** بُعد المشروع — the contracting project this asset is assigned to, while assigned its depreciation is that project's equipment cost. */
  readonly projectId: string | null;
}

/** Persistence port for assets. The domain depends on this interface only — no SQL, no driver. */
export interface AssetRepository {
  findById(id: string): Promise<Asset | null>;
  findByCode(code: string): Promise<Asset | null>;
  list(): Promise<Asset[]>;
  create(asset: Asset): Promise<void>;
  update(asset: Asset): Promise<void>;
}
