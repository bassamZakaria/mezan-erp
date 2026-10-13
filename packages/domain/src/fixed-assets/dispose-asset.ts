import type { CostCategory } from "../contracting/cost-category.js";
/**
 * التخلص من أصل — Asset disposal (docs/archive/catalog/07 §الأصول الثابتة).
 *
 * Retiring an asset removes its remaining book value from the balance sheet and
 * recognises the gain or loss against the proceeds. The status value and the
 * permission both already existed; nothing could reach them (D13).
 *
 * The posting, for cost C, accumulated depreciation A and proceeds P:
 *
 *   Dr accumulated depreciation   A          (clearing the contra-asset)
 *   Dr treasury / receivable      P          (only when there are proceeds)
 *   Cr asset cost                 C
 *   Dr loss  or  Cr gain          |C − A − P|
 *
 * Disposal is terminal: a disposed asset cannot be disposed again, and it stops
 * depreciating because `post-depreciation-run.ts` skips anything not active.
 */

import { Money } from "../money/index.js";
import type { Asset, AssetRepository } from "./asset.js";
import type { AssetCategory, AssetCategoryRepository } from "./asset-category.js";
import { AssetNotFoundError } from "./errors.js";
import type { WarehouseBranchLookup } from "../gl/index.js";
import { branchOfAsset } from "./asset-branch.js";

export interface DisposeAssetGlAccounts {
  /** Where the asset's cost sits when no category or asset override applies. */
  readonly assetAccountId: string;
  readonly accumulatedDepreciationAccountId: string;
  readonly gainAccountId: string;
  readonly lossAccountId: string;
}

export interface DisposeAssetPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly projectId?: string | null;
  readonly costCategory?: CostCategory | null;
  readonly branchId?: string | null;
}

export interface DisposeAssetPosting {
  readonly sourceDocType: "ASSET_DISPOSAL";
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly DisposeAssetPostingLine[];
}

export interface DisposeAssetGlPort {
  post(posting: DisposeAssetPosting): Promise<void>;
}

export interface DisposeAssetCommand {
  readonly assetId: string;
  readonly date: string;
  /** What the asset was sold for; zero for a scrapped asset. */
  readonly proceeds?: Money;
  /**
   * Where the proceeds land — a treasury GL account, or a receivable when the
   * buyer has not paid yet. Required when proceeds are nonzero.
   */
  readonly proceedsAccountId?: string | null;
  readonly notes?: string | null;
}

export interface DisposeAssetDeps {
  readonly assets: AssetRepository;
  readonly categories: Pick<AssetCategoryRepository, "findById">;
  readonly accounts: DisposeAssetGlAccounts;
  readonly gl?: DisposeAssetGlPort;
  /** Resolves a warehouse-scoped asset's branch through the warehouse it sits in. */
  readonly warehouses?: WarehouseBranchLookup;
}

export class AssetAlreadyDisposedError extends Error {
  readonly code = "ASSET_ALREADY_DISPOSED";
  constructor(readonly assetId: string) {
    super(`الأصل "${assetId}" تم التخلص منه بالفعل.`);
    this.name = "AssetAlreadyDisposedError";
  }
}

export class InvalidAssetDisposalError extends Error {
  readonly code = "INVALID_ASSET_DISPOSAL";
  constructor(message: string) {
    super(message);
    this.name = "InvalidAssetDisposalError";
  }
}

export interface DisposeAssetResult {
  readonly asset: Asset;
  readonly bookValue: Money;
  /** Positive is a gain, negative a loss. */
  readonly gainOrLoss: Money;
}

function resolveAccounts(asset: Asset, category: AssetCategory | null, fallback: DisposeAssetGlAccounts) {
  return {
    assetAccountId: asset.assetAccountId ?? category?.assetAccountId ?? fallback.assetAccountId,
    accumulatedDepreciationAccountId:
      asset.accumulatedDepreciationAccountId ??
      category?.accumulatedDepreciationAccountId ??
      fallback.accumulatedDepreciationAccountId,
  };
}

export async function disposeAsset(
  cmd: DisposeAssetCommand,
  deps: DisposeAssetDeps,
): Promise<DisposeAssetResult> {
  const asset = await deps.assets.findById(cmd.assetId);
  if (!asset) throw new AssetNotFoundError(cmd.assetId);
  if (asset.status === "disposed") throw new AssetAlreadyDisposedError(cmd.assetId);

  const proceeds = cmd.proceeds ?? Money.zero();
  if (proceeds.scaled < 0n) {
    throw new InvalidAssetDisposalError("قيمة البيع لا يمكن أن تكون سالبة.");
  }
  if (proceeds.scaled > 0n && !cmd.proceedsAccountId) {
    throw new InvalidAssetDisposalError("حساب تحصيل قيمة البيع مطلوب.");
  }
  if (cmd.date < asset.acquisitionDate) {
    throw new InvalidAssetDisposalError("تاريخ التخلص لا يمكن أن يسبق تاريخ الاقتناء.");
  }

  const bookValue = Money.fromScaled(asset.acquisitionCost.scaled - asset.accumulatedDepreciation.scaled);
  const gainOrLoss = Money.fromScaled(proceeds.scaled - bookValue.scaled);

  if (deps.gl) {
    const category = await deps.categories.findById(asset.categoryId);
    const accounts = resolveAccounts(asset, category, deps.accounts);
    const zero = Money.zero();
    const projectId = asset.projectId;
    const branchId = await branchOfAsset(asset, deps.warehouses);
    const lines: DisposeAssetPostingLine[] = [];
    if (asset.accumulatedDepreciation.scaled > 0n) {
      lines.push({ accountId: accounts.accumulatedDepreciationAccountId, debit: asset.accumulatedDepreciation, credit: zero, projectId, branchId });
    }
    if (proceeds.scaled > 0n) {
      lines.push({ accountId: cmd.proceedsAccountId as string, debit: proceeds, credit: zero, projectId, branchId });
    }
    lines.push({ accountId: accounts.assetAccountId, debit: zero, credit: asset.acquisitionCost, projectId, branchId });
    if (gainOrLoss.scaled > 0n) {
      lines.push({ accountId: deps.accounts.gainAccountId, debit: zero, credit: gainOrLoss, projectId, branchId });
    } else if (gainOrLoss.scaled < 0n) {
      lines.push({ accountId: deps.accounts.lossAccountId, debit: Money.fromScaled(-gainOrLoss.scaled), credit: zero, projectId, branchId });
    }
    await deps.gl.post({
      sourceDocType: "ASSET_DISPOSAL",
      sourceDocId: asset.id,
      sourceDocNumber: asset.code,
      date: cmd.date,
      memo: `التخلص من الأصل ${asset.code} — ${asset.nameAr}`,
      lines,
    });
  }

  const disposed: Asset = {
    ...asset,
    status: "disposed",
    notes: cmd.notes ?? asset.notes,
  };
  await deps.assets.update(disposed);
  return { asset: disposed, bookValue, gainOrLoss };
}
