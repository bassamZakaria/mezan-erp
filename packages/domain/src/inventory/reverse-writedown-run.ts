import { recordSensitiveEvent } from "../audit/index.js";
import { ReversalDateBeforeOriginalError, reverseJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import { WritedownRunNotFoundError, WritedownRunNotPostedError } from "./errors.js";
import type { WritedownRun, WritedownRunRepository } from "./writedown-run.js";

export interface ReverseWritedownRunDeps {
  readonly runs: WritedownRunRepository;
  readonly gl: JournalPostingDeps;
}

export interface ReverseWritedownRunOptions {
  readonly reversalId: string;
  readonly date?: string;
  readonly memo?: string;
}

export async function reverseWritedownRun(runId: string, deps: ReverseWritedownRunDeps, opts: ReverseWritedownRunOptions): Promise<WritedownRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new WritedownRunNotFoundError(runId);
  if (run.status !== "posted" || !run.journalEntryId) throw new WritedownRunNotPostedError(runId, run.status);
  const entryId = run.journalEntryId;
  const original = await deps.gl.ledger.findById(entryId);
  const date = opts.date ?? original?.date.slice(0, 10);
  if (original && date !== undefined && date < original.date.slice(0, 10)) throw new ReversalDateBeforeOriginalError(entryId, date, original.date);

  return deps.gl.ledger.transaction(async () => {
    const { reversal } = await reverseJournalEntry(entryId, deps.gl, {
      reversalId: opts.reversalId,
      date,
      memo: opts.memo ?? `عكس مخصص هبوط المخزون الراكد ${run.period}`,
    });
    const cancelled: WritedownRun = { ...run, status: "cancelled" };
    await deps.runs.update(cancelled);
    if (deps.gl.audit) {
      await recordSensitiveEvent(deps.gl.audit, {
        module: "inventory",
        entityType: "WRITEDOWN_RUN",
        entityId: run.id,
        action: "REVERSE",
        actor: deps.gl.actor ?? "system",
        severity: "WARNING",
        details: { runId: run.id, period: run.period, warehouseId: run.warehouseId, totalAmount: run.totalAmount.toString(), journalEntryId: entryId, reversalId: reversal.id, reversalNo: reversal.entryNo ?? null, date: reversal.date },
      });
    }
    return cancelled;
  });
}
