/**
 * إقفال السنة المالية — Year-end close (docs/catalog/04).
 *
 * Closing a year moves every revenue and expense balance into retained
 * earnings, so the P&L accounts start the new year at zero and the ledger
 * itself states last year's result. Without it the revenue account carried the
 * old year's total forever and GL 3900 was an account in the chart nothing ever
 * posted to; the balance sheet balanced only because the REPORT derived
 * retained earnings from the P&L accounts rather than reading a posted balance
 * (D34) — correct on screen, and unanswerable from the books.
 *
 * The entry is dated the last day of the year being closed, so the closing year
 * ends flat and the new one opens clean. It is an ordinary journal entry: it
 * passes the same period gate as everything else, so a locked December refuses
 * it, and it is corrected by reversal like any other posting.
 */

import { Money } from "../money/index.js";
import type { Account, AccountRepository } from "../accounts/account.js";
import type { LedgerRepository } from "./ledger.js";
import { postJournalEntry, type JournalPostingDeps } from "./post.js";

export class YearAlreadyClosedError extends Error {
  readonly code = "YEAR_ALREADY_CLOSED";
  constructor(readonly year: number) {
    super(`السنة المالية ${year} مقفلة بالفعل.`);
    this.name = "YearAlreadyClosedError";
  }
}

export class NothingToCloseError extends Error {
  readonly code = "NOTHING_TO_CLOSE";
  constructor(readonly year: number) {
    super(`لا توجد أرصدة إيرادات أو مصروفات لإقفالها في سنة ${year}.`);
    this.name = "NothingToCloseError";
  }
}

export interface CloseYearCommand {
  readonly year: number;
  /** Where the year's result lands — الأرباح المرحلة (3900 in the standard chart). */
  readonly retainedEarningsAccountId: string;
  /** Overridable for deterministic ids in tests; defaults to `YEAR-CLOSE:<year>`. */
  readonly entryId?: string;
  readonly memo?: string;
}

export interface CloseYearDeps extends JournalPostingDeps {
  readonly ledger: LedgerRepository;
  readonly accounts: Pick<AccountRepository, "findById" | "list">;
}

export interface CloseYearResult {
  readonly journalEntryId: string;
  /** Positive when the year made a profit. */
  readonly netResult: Money;
  readonly revenueClosed: Money;
  readonly expensesClosed: Money;
  readonly accountsClosed: number;
}

function isPnl(account: Account): boolean {
  return account.type === "revenue" || account.type === "expense";
}

export async function closeFiscalYear(cmd: CloseYearCommand, deps: CloseYearDeps): Promise<CloseYearResult> {
  const entryId = cmd.entryId ?? `YEAR-CLOSE:${cmd.year}`;
  if (await deps.ledger.findById(entryId)) throw new YearAlreadyClosedError(cmd.year);

  const asOf = `${cmd.year}-12-31`;
  const accounts = (await deps.accounts.list()).filter((a) => isPnl(a) && !a.isHeader);

  const lines: { accountId: string; debit: Money; credit: Money }[] = [];
  let revenue = Money.zero();
  let expenses = Money.zero();

  for (const account of accounts) {
    const balance = await deps.ledger.accountBalance(account.id, asOf);
    // `AccountBalance.balance` is debit − credit, sign convention-neutral. So a
    // revenue account that has earned reads NEGATIVE and an expense account
    // that has spent reads positive, and closing either one is simply the
    // mirror of its raw balance — no per-type branch, no sign to get backwards.
    const raw = balance.balance.scaled;
    if (raw === 0n) continue;

    if (account.type === "revenue") revenue = Money.fromScaled(revenue.scaled - raw);
    else expenses = Money.fromScaled(expenses.scaled + raw);

    lines.push(
      raw > 0n
        ? { accountId: account.id, debit: Money.zero(), credit: Money.fromScaled(raw) }
        : { accountId: account.id, debit: Money.fromScaled(-raw), credit: Money.zero() },
    );
  }

  if (lines.length === 0) throw new NothingToCloseError(cmd.year);

  const netResult = Money.fromScaled(revenue.scaled - expenses.scaled);
  if (netResult.scaled !== 0n) {
    lines.push(
      netResult.scaled > 0n
        ? { accountId: cmd.retainedEarningsAccountId, debit: Money.zero(), credit: netResult }
        : { accountId: cmd.retainedEarningsAccountId, debit: Money.fromScaled(-netResult.scaled), credit: Money.zero() },
    );
  }

  const entry = await postJournalEntry(
    {
      id: entryId,
      date: asOf,
      memo: cmd.memo ?? `إقفال السنة المالية ${cmd.year} — ترحيل النتيجة إلى الأرباح المرحلة`,
      source: "system",
      lines,
    },
    deps,
  );

  return {
    journalEntryId: entry.id,
    netResult,
    revenueClosed: revenue,
    expensesClosed: expenses,
    accountsClosed: lines.length - (netResult.scaled === 0n ? 0 : 1),
  };
}
