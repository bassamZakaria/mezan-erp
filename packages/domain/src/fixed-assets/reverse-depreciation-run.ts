import { reverseJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import type { Asset, AssetRepository } from "./asset.js";
import type { DepreciationRun, DepreciationRunRepository } from "./depreciation-run.js";
import { depreciableBase } from "./depreciation.js";
import { AssetNotFoundError, DepreciationRunNotFoundError, DepreciationRunNotPostedError } from "./errors.js";

export interface ReverseDepreciationRunDeps {
  readonly runs: DepreciationRunRepository;
  readonly assets: AssetRepository;
  readonly gl: JournalPostingDeps;
  readonly now?: () => string;
}

export interface ReverseDepreciationRunOptions {
  /** Id for the reversing journal entry (the caller generates ids; the domain stays pure). */
  readonly reversalId: string;
  /** Date the reversal posts into; defaults to the original entry's date. Period-gated and VAT-gated. */
  readonly date?: string;
  readonly memo?: string;
}

/**
 * عكس تشغيل الإهلاك — undo a posted depreciation run.
 *
 * Both halves come back together: the GL entry is reversed the only legal way
 * (a mirror-image posted entry, period-gated on its own date), and every
 * asset's `accumulatedDepreciation` is reduced by exactly the line that raised
 * it — an asset the run pushed to `fully_depreciated` returns to `active` when
 * it is no longer fully depreciated. A depreciation run that could only be
 * posted left a wrong month permanently in the books (B-9).
 *
 * A `disposed` asset is left alone: its disposal already closed the register
 * entry, and re-opening it here would contradict the disposal posting.
 */
export async function reverseDepreciationRun(
  runId: string,
  deps: ReverseDepreciationRunDeps,
  opts: ReverseDepreciationRunOptions,
): Promise<DepreciationRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new DepreciationRunNotFoundError(runId);
  if (run.status !== "posted" || !run.journalEntryId) {
    throw new DepreciationRunNotPostedError(runId, run.status);
  }

  const assetsById = new Map<string, Asset>();
  for (const line of run.lines) {
    const asset = await deps.assets.findById(line.assetId);
    if (!asset) throw new AssetNotFoundError(line.assetId);
    assetsById.set(line.assetId, asset);
  }

  return deps.gl.ledger.transaction(async () => {
    await reverseJournalEntry(run.journalEntryId as string, deps.gl, {
      reversalId: opts.reversalId,
      date: opts.date,
      memo: opts.memo ?? `عكس إهلاك الفترة ${run.period}`,
    });

    for (const line of run.lines) {
      const asset = assetsById.get(line.assetId) as Asset;
      if (asset.status === "disposed") continue;
      const restored = asset.accumulatedDepreciation.add(line.amount.negate());
      const stillFull = restored.scaled >= depreciableBase(asset).scaled;
      await deps.assets.update({
        ...asset,
        accumulatedDepreciation: restored,
        status: asset.status === "fully_depreciated" && !stillFull ? "active" : asset.status,
      });
    }

    const reversed: DepreciationRun = { ...run, status: "cancelled" };
    await deps.runs.update(reversed);
    return reversed;
  });
}
