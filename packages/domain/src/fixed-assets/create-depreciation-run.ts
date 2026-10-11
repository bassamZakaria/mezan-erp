import { Money } from "../money/index.js";
import type { Asset, AssetRepository } from "./asset.js";
import type { DepreciationRun, DepreciationRunRepository } from "./depreciation-run.js";
import { DEPRECIABLE_ASSET_STATUSES, computeMonthlyDepreciation, type DepreciationPeriod } from "./depreciation.js";

export { DEPRECIABLE_ASSET_STATUSES };
import { DuplicateDepreciationPeriodError, NoDepreciableAssetsError } from "./errors.js";
import { assertOpenForPosting, type FiscalPeriodRepository } from "../fiscal-periods/index.js";

export interface CreateDepreciationRunCommand {
  readonly id: string;
  /** "YYYY-MM" */
  readonly period: string;
  readonly branchId?: string | null;
  /** Settings §"الضريبة" → `depreciationProrate`. Defaults to the IFRS daily proration. */
  readonly prorate?: "DAILY" | "FULL_MONTH";
  readonly now?: () => string;
}

export interface CreateDepreciationRunDeps {
  readonly runs: DepreciationRunRepository;
  readonly assets: AssetRepository;
  /** When supplied, a run is not even drafted for a month that is closed or locked: it could never post. */
  readonly periods?: Pick<FiscalPeriodRepository, "findByDate">;
}

function parsePeriod(period: string): DepreciationPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) {
    throw new RangeError(`Invalid depreciation period: "${period}"`);
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Whether the period's runs account for every asset that has depreciation to
 * charge in it. A run is scoped to a branch, so "some run exists" was true as
 * soon as ONE branch had run and the reminder went quiet for all the others.
 */
export function depreciationRunsCoverPeriod(assets: readonly Asset[], runs: readonly DepreciationRun[], period: string): boolean {
  const periodRuns = runs.filter((run) => run.period === period && run.status !== "cancelled");
  if (periodRuns.length === 0) return false;
  const covered = new Set(periodRuns.flatMap((run) => run.lines.map((line) => line.assetId)));
  const month = parsePeriod(period);
  return assets.every(
    (asset) => covered.has(asset.id) || !DEPRECIABLE_ASSET_STATUSES.has(asset.status) || computeMonthlyDepreciation(asset, month).amount.scaled === 0n,
  );
}

/**
 * Builds a مسودة (draft) depreciation run for a period (+ optional branch
 * scope): rejects a second open draft for the same period+branch,
 * computes each eligible active asset's due amount via
 * {@link computeMonthlyDepreciation}, keeps only non-zero lines, and rejects
 * an empty result.
 */
export async function createDepreciationRun(
  cmd: CreateDepreciationRunCommand,
  deps: CreateDepreciationRunDeps,
): Promise<DepreciationRun> {
  const branchId = cmd.branchId ?? null;

  const periodRuns = (await deps.runs.list()).filter((run) => run.period === cmd.period && run.status !== "cancelled");
  // A posted run does not close the month to its scope: an asset it left out still gets a supplementary run.
  if (periodRuns.some((run) => run.branchId === branchId && run.status === "draft")) {
    throw new DuplicateDepreciationPeriodError(cmd.period, branchId);
  }

  const period = parsePeriod(cmd.period);
  if (deps.periods) {
    const fiscalPeriod = await deps.periods.findByDate(`${cmd.period}-01`);
    if (fiscalPeriod) assertOpenForPosting(fiscalPeriod);
  }
  const allAssets = await deps.assets.list();
  // A run is scoped to a branch, but an asset is charged once a month whichever run reaches it first.
  const alreadyOnARun = new Set(periodRuns.flatMap((run) => run.lines.map((line) => line.assetId)));
  const eligible = allAssets.filter((asset) => {
    if (!DEPRECIABLE_ASSET_STATUSES.has(asset.status) || alreadyOnARun.has(asset.id)) return false;
    if (branchId === null) return true;
    if (asset.scope === "general") return true;
    if (asset.scope === "branch") return asset.branchId === branchId;
    return false;
  });

  const lines = eligible
    .map((asset) => {
      const result = computeMonthlyDepreciation(asset, period, cmd.prorate ?? "DAILY");
      return {
        assetId: result.assetId,
        amount: result.amount,
        projectId: asset.projectId,
        costCategory: asset.projectId ? ("equipment" as const) : null,
      };
    })
    .filter((line) => line.amount.scaled > 0n);

  if (lines.length === 0) {
    throw new NoDepreciableAssetsError(cmd.period);
  }

  const run: DepreciationRun = {
    id: cmd.id,
    period: cmd.period,
    branchId,
    status: "draft",
    lines,
    totalAmount: Money.sum(lines.map((l) => l.amount)),
    journalEntryId: null,
    createdAt: cmd.now?.() ?? new Date().toISOString(),
    postedAt: null,
  };

  await deps.runs.create(run);
  return run;
}
