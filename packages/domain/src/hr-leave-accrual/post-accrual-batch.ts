import { postJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import { Money } from "../money/index.js";
import type { LeaveAccrualBatch, LeaveAccrualBatchRepository } from "./accrual-batch.js";
import { LeaveAccrualBatchNotDraftError, LeaveAccrualBatchNotFoundError } from "./errors.js";

export interface PostAccrualBatchDeps {
  readonly batches: LeaveAccrualBatchRepository;
  readonly gl: JournalPostingDeps;
  readonly now?: () => string;
  /** Fallback GL accounts (accounts/coa-template.ts: 5300 Leave Accrual Expense / 2250 Accrued Leave Liability by default at the wiring layer). */
  readonly accounts: {
    readonly leaveExpenseAccountId: string;
    readonly accruedLeaveLiabilityAccountId: string;
  };
}

/**
 * Posts a draft accrual batch: when its total value is non-zero, posts ONE
 * balanced journal entry (Dr Leave Accrual Expense / Cr Accrued Leave
 * Liability) through the REAL GL posting engine. Balances themselves need no
 * separate write — `hr-leave-requests/leave-balance.ts`'s `entitledDays`
 * reads posted batches' lines directly, so "credits leave balances
 * immediately" (catalog) falls out of marking the batch posted, not a second
 * mutation. A batch whose total value is zero (no salary-rate source wired
 * yet) still posts — balances still update — it just skips the (would-be
 * zero-amount, non-postable) journal entry.
 */
export async function postAccrualBatch(batchId: string, deps: PostAccrualBatchDeps): Promise<LeaveAccrualBatch> {
  const batch = await deps.batches.findById(batchId);
  if (!batch) throw new LeaveAccrualBatchNotFoundError(batchId);
  if (batch.status !== "draft") throw new LeaveAccrualBatchNotDraftError(batchId, batch.status);

  let journalEntryId: string | null = null;
  if (batch.totalValue.scaled > 0n) {
    const entry = await postJournalEntry(
      {
        id: `LEAVE-ACCRUAL-JE:${batch.id}`,
        date: batch.runDate,
        memo: `استحقاق إجازات ${batch.period}`,
        source: "system",
        lines: [
          { accountId: deps.accounts.leaveExpenseAccountId, debit: batch.totalValue, credit: Money.zero() },
          { accountId: deps.accounts.accruedLeaveLiabilityAccountId, debit: Money.zero(), credit: batch.totalValue },
        ],
      },
      deps.gl,
    );
    journalEntryId = entry.id;
  }

  const posted: LeaveAccrualBatch = {
    ...batch,
    status: "posted",
    journalEntryId,
    postedAt: deps.now?.() ?? new Date().toISOString(),
  };
  await deps.batches.update(posted);
  return posted;
}
