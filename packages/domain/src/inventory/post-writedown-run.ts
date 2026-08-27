import { Money } from "../money/index.js";
import { postJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import { periodEndDate } from "./aging.js";
import { WritedownRunNotDraftError, WritedownRunNotFoundError } from "./errors.js";
import type { WritedownRun, WritedownRunRepository } from "./writedown-run.js";

export interface PostWritedownRunDeps {
  readonly runs: WritedownRunRepository;
  readonly gl: JournalPostingDeps;
  readonly now?: () => string;
  /** Dr the expense account / Cr the contra-asset provision account — Σ debit = Σ credit = run.totalAmount. */
  readonly accounts: {
    readonly writedownExpenseAccountId: string;
    readonly provisionAccountId: string;
  };
}

/**
 * Posts a draft write-down run: one balanced journal entry (Dr write-down
 * expense / Cr the 1190-style contra-asset provision) for the run's total,
 * dated the period's last day, through the REAL GL posting engine. Unlike
 * `postDepreciationRun`, this never updates any Item/cost-layer/WAC snapshot
 * — the provision sits entirely in the GL, so the item's recorded inventory
 * cost is untouched (docs/tasks.md: "does not touch recorded inventory cost").
 */
export async function postWritedownRun(runId: string, deps: PostWritedownRunDeps): Promise<WritedownRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new WritedownRunNotFoundError(runId);
  if (run.status !== "draft") throw new WritedownRunNotDraftError(runId, run.status);

  const entry = await postJournalEntry(
    {
      id: `WRITEDOWN-JE:${run.id}`,
      date: periodEndDate(run.period),
      memo: `Inventory aging write-down ${run.period}${run.warehouseId ? ` — warehouse ${run.warehouseId}` : ""}`,
      source: "system",
      sourceDocType: "WRITEDOWN_RUN",
      sourceDocId: run.id,
      sourceDocNumber: run.period,
      lines: [
        { accountId: deps.accounts.writedownExpenseAccountId, debit: run.totalAmount, credit: Money.zero() },
        { accountId: deps.accounts.provisionAccountId, debit: Money.zero(), credit: run.totalAmount },
      ],
    },
    deps.gl,
  );

  const postedRun: WritedownRun = {
    ...run,
    status: "posted",
    journalEntryId: entry.id,
    postedAt: deps.now?.() ?? new Date().toISOString(),
  };
  await deps.runs.update(postedRun);
  return postedRun;
}
