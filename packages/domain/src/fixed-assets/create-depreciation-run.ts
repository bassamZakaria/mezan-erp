import { Money } from "../money/index.js";
import type { AssetRepository } from "./asset.js";
import type { DepreciationRun, DepreciationRunRepository } from "./depreciation-run.js";
import { computeMonthlyDepreciation, type DepreciationPeriod } from "./depreciation.js";
import { DuplicateDepreciationPeriodError, NoDepreciableAssetsError } from "./errors.js";

export interface CreateDepreciationRunCommand {
  readonly id: string;
  /** "YYYY-MM" */
  readonly period: string;
  readonly branchId?: string | null;
  readonly now?: () => string;
}

export interface CreateDepreciationRunDeps {
  readonly runs: DepreciationRunRepository;
  readonly assets: AssetRepository;
}

function parsePeriod(period: string): DepreciationPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) {
    throw new RangeError(`Invalid depreciation period: "${period}"`);
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Builds a مسودة (draft) depreciation run for a period (+ optional branch
 * scope): rejects a duplicate non-cancelled run for the same period+branch,
 * computes each eligible active asset's due amount via
 * {@link computeMonthlyDepreciation}, keeps only non-zero lines, and rejects
 * an empty result.
 */
export async function createDepreciationRun(
  cmd: CreateDepreciationRunCommand,
  deps: CreateDepreciationRunDeps,
): Promise<DepreciationRun> {
  const branchId = cmd.branchId ?? null;

  const existingRun = await deps.runs.findByPeriod(cmd.period, branchId);
  if (existingRun && existingRun.status !== "cancelled") {
    throw new DuplicateDepreciationPeriodError(cmd.period, branchId);
  }

  const period = parsePeriod(cmd.period);
  const allAssets = await deps.assets.list();
  const eligible = allAssets.filter((asset) => {
    if (asset.status !== "active") return false;
    if (branchId === null) return true;
    if (asset.scope === "general") return true;
    if (asset.scope === "branch") return asset.branchId === branchId;
    return false;
  });

  const lines = eligible
    .map((asset) => {
      const result = computeMonthlyDepreciation(asset, period);
      return { assetId: result.assetId, amount: result.amount };
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
