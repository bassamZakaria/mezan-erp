import { Money } from "../money/index.js";
import { postJournalEntry, type JournalPostingDeps, type WarehouseBranchLookup } from "../gl/index.js";
import { branchOfAsset } from "./asset-branch.js";
import type { Asset, AssetRepository } from "./asset.js";
import type { AssetCategoryRepository } from "./asset-category.js";
import type { DepreciationRun, DepreciationRunRepository } from "./depreciation-run.js";
import { depreciableBase, periodBounds } from "./depreciation.js";
import {
  AssetCategoryNotFoundError,
  AssetNotFoundError,
  DepreciationRunNotDraftError,
  DepreciationRunNotFoundError,
} from "./errors.js";

export interface PostDepreciationRunDeps {
  readonly runs: DepreciationRunRepository;
  readonly assets: AssetRepository;
  readonly categories: AssetCategoryRepository;
  readonly gl: JournalPostingDeps;
  /** Resolves a warehouse-scoped asset's branch through the warehouse it sits in. */
  readonly warehouses?: WarehouseBranchLookup;
  readonly now?: () => string;
  /** Fallback GL account ids used when neither the asset nor its category has an override configured. Required so posting never silently fails for under-configured data. */
  readonly defaultAccounts: {
    readonly depreciationExpenseAccountId: string;
    readonly accumulatedDepreciationAccountId: string;
  };
}

interface ResolvedAccounts {
  readonly depreciationExpenseAccountId: string;
  readonly accumulatedDepreciationAccountId: string;
}

/** Resolves an asset's posting accounts: the asset's own override → its category's default → the deps fallback. */
async function resolveAccounts(asset: Asset, deps: PostDepreciationRunDeps): Promise<ResolvedAccounts> {
  let depreciationExpenseAccountId = asset.depreciationExpenseAccountId;
  let accumulatedDepreciationAccountId = asset.accumulatedDepreciationAccountId;

  if (!depreciationExpenseAccountId || !accumulatedDepreciationAccountId) {
    const category = await deps.categories.findById(asset.categoryId);
    if (!category) throw new AssetCategoryNotFoundError(asset.categoryId);
    depreciationExpenseAccountId ??= category.depreciationExpenseAccountId;
    accumulatedDepreciationAccountId ??= category.accumulatedDepreciationAccountId;
  }

  return {
    depreciationExpenseAccountId: depreciationExpenseAccountId ?? deps.defaultAccounts.depreciationExpenseAccountId,
    accumulatedDepreciationAccountId:
      accumulatedDepreciationAccountId ?? deps.defaultAccounts.accumulatedDepreciationAccountId,
  };
}

function pairKey(accounts: ResolvedAccounts, projectId: string | null, branchId: string | null): string {
  return `${accounts.depreciationExpenseAccountId}::${accounts.accumulatedDepreciationAccountId}::${projectId ?? ""}::${branchId ?? ""}`;
}

/**
 * Posts a draft depreciation run: resolves each line's GL accounts, groups
 * lines by resolved account pair, posts ONE balanced journal entry (Dr
 * depreciation expense / Cr accumulated depreciation per pair) through the
 * REAL GL posting engine, updates each asset's running accumulated
 * depreciation (flipping to `fully_depreciated` when it reaches the
 * depreciable base), and marks the run `posted`.
 */
export async function postDepreciationRun(runId: string, deps: PostDepreciationRunDeps): Promise<DepreciationRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new DepreciationRunNotFoundError(runId);
  if (run.status !== "draft") throw new DepreciationRunNotDraftError(runId, run.status);

  const assetsById = new Map<string, Asset>();
  for (const line of run.lines) {
    const asset = await deps.assets.findById(line.assetId);
    if (!asset) throw new AssetNotFoundError(line.assetId);
    assetsById.set(line.assetId, asset);
  }

  const totalsByPair = new Map<
    string,
    { accounts: ResolvedAccounts; projectId: string | null; branchId: string | null; total: Money }
  >();
  for (const line of run.lines) {
    const asset = assetsById.get(line.assetId)!;
    const accounts = await resolveAccounts(asset, deps);
    // Use the asset's CURRENT project assignment, not whatever the draft line
    // captured — an asset reassigned between drafting and posting the run
    // should post equipment cost to the project it belongs to today.
    const projectId = asset.projectId;
    const branchId = await branchOfAsset(asset, deps.warehouses);
    const key = pairKey(accounts, projectId, branchId);
    const existing = totalsByPair.get(key);
    totalsByPair.set(key, {
      accounts,
      projectId,
      branchId,
      total: existing ? existing.total.add(line.amount) : line.amount,
    });
  }

  const journalLines = [...totalsByPair.values()].flatMap(({ accounts, projectId, branchId, total }) => [
    {
      accountId: accounts.depreciationExpenseAccountId,
      debit: total,
      credit: Money.zero(),
      projectId,
      costCategory: projectId ? ("equipment" as const) : null,
      branchId,
    },
    {
      accountId: accounts.accumulatedDepreciationAccountId,
      debit: Money.zero(),
      credit: total,
      projectId,
      branchId,
    },
  ]);

  const [yearStr, monthStr] = run.period.split("-");
  const { end } = periodBounds({ year: Number(yearStr), month: Number(monthStr) });

  // ONE TRANSACTION for the entry, every asset write and the run's own status
  // (B-9). A failure part-way used to leave the GL entry posted against assets
  // whose accumulated depreciation had not moved, and the run still `draft` —
  // so re-posting threw DuplicateJournalEntryError and the period could never
  // be closed.
  return deps.gl.ledger.transaction(async () => {
    const entry = await postJournalEntry(
      {
        id: `DEP-JE:${run.id}`,
        date: end,
        memo: `إهلاك الفترة ${run.period}`,
        source: "system",
        sourceDocType: "DEPRECIATION_RUN",
        sourceDocId: run.id,
        sourceDocNumber: run.period,
        lines: journalLines,
      },
      deps.gl,
    );

    for (const line of run.lines) {
      const asset = assetsById.get(line.assetId)!;
      const newAccumulated = asset.accumulatedDepreciation.add(line.amount);
      const fullyDepreciated = newAccumulated.scaled >= depreciableBase(asset).scaled;
      const updated: Asset = {
        ...asset,
        accumulatedDepreciation: newAccumulated,
        status: fullyDepreciated ? "fully_depreciated" : asset.status,
      };
      await deps.assets.update(updated);
    }

    const postedRun: DepreciationRun = {
      ...run,
      status: "posted",
      journalEntryId: entry.id,
      postedAt: deps.now?.() ?? new Date().toISOString(),
    };
    await deps.runs.update(postedRun);
    return postedRun;
  });
}
