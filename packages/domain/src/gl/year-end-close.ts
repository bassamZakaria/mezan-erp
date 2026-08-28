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
import { YEAR_END_CLOSE_DOC_TYPE } from "../journal.js";
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

type PnlAccount = Account & { readonly type: "revenue" | "expense" };

function isPnl(account: Account): account is PnlAccount {
  return account.type === "revenue" || account.type === "expense";
}

export interface YearEndClosePlanLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountNameAr: string;
  readonly accountType: "revenue" | "expense";
  readonly debit: Money;
  readonly credit: Money;
}

export interface YearEndClosePlan {
  readonly year: number;
  readonly entryId: string;
  /** The date the entry will carry — the last day of the year being closed. */
  readonly date: string;
  readonly lines: readonly YearEndClosePlanLine[];
  readonly netResult: Money;
  readonly revenueClosed: Money;
  readonly expensesClosed: Money;
}

/**
 * What closing `cmd.year` would post, without posting it — the screen shows
 * this before the button is pressed. `closeFiscalYear` posts exactly this
 * plan, so the preview cannot drift from the entry.
 *
 * Throws the same refusals the close does, so a year that cannot be closed says
 * why while the button is still unpressed.
 */
export async function planYearEndClose(cmd: CloseYearCommand, deps: CloseYearDeps): Promise<YearEndClosePlan> {
  const entryId = cmd.entryId ?? `YEAR-CLOSE:${cmd.year}`;
  if (await deps.ledger.findById(entryId)) throw new YearAlreadyClosedError(cmd.year);

  const asOf = `${cmd.year}-12-31`;
  const accounts = (await deps.accounts.list()).filter(isPnl).filter((a) => !a.isHeader);

  const lines: YearEndClosePlanLine[] = [];
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

    lines.push({
      accountId: account.id,
      accountCode: account.code,
      accountNameAr: account.nameAr,
      accountType: account.type,
      debit: raw > 0n ? Money.zero() : Money.fromScaled(-raw),
      credit: raw > 0n ? Money.fromScaled(raw) : Money.zero(),
    });
  }

  if (lines.length === 0) throw new NothingToCloseError(cmd.year);

  return {
    year: cmd.year,
    entryId,
    date: asOf,
    lines,
    netResult: Money.fromScaled(revenue.scaled - expenses.scaled),
    revenueClosed: revenue,
    expensesClosed: expenses,
  };
}

export async function closeFiscalYear(cmd: CloseYearCommand, deps: CloseYearDeps): Promise<CloseYearResult> {
  const plan = await planYearEndClose(cmd, deps);

  const lines: { accountId: string; debit: Money; credit: Money }[] = plan.lines.map((line) => ({
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
  }));
  if (plan.netResult.scaled !== 0n) {
    lines.push(
      plan.netResult.scaled > 0n
        ? { accountId: cmd.retainedEarningsAccountId, debit: Money.zero(), credit: plan.netResult }
        : { accountId: cmd.retainedEarningsAccountId, debit: Money.fromScaled(-plan.netResult.scaled), credit: Money.zero() },
    );
  }

  const entry = await postJournalEntry(
    {
      id: plan.entryId,
      date: plan.date,
      memo: cmd.memo ?? `إقفال السنة المالية ${cmd.year} — ترحيل النتيجة إلى الأرباح المرحلة`,
      source: "system",
      // The entry is dated inside the year it closes, which is correct — and
      // it zeroes every P&L account. Without this stamp the year's own income
      // statement reads nil revenue and nil profit, and the result reappears
      // as a financing inflow in the cash-flow statement, because nothing
      // could tell a closing entry from trading.
      sourceDocType: YEAR_END_CLOSE_DOC_TYPE,
      sourceDocId: plan.entryId,
      lines,
    },
    deps,
  );

  return {
    journalEntryId: entry.id,
    netResult: plan.netResult,
    revenueClosed: plan.revenueClosed,
    expensesClosed: plan.expensesClosed,
    accountsClosed: plan.lines.length,
  };
}
