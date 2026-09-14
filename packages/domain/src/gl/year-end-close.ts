/**
 * إقفال السنة المالية — Year-end close (docs/archive/catalog/04).
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
import { postJournalEntry, type JournalLineInput, type JournalPostingDeps } from "./post.js";

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
  /**
   * بُعد المشروع the closed balance came from — null for the part of the
   * account's balance no project ever carried. One account closes across as
   * many lines as it has projects, because a routed contracting slot refuses a
   * line with no project, and because a project's result is only readable from
   * the books if the close preserves the dimension it was earned under.
   */
  readonly projectId: string | null;
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
  if (accounts.length === 0) throw new NothingToCloseError(cmd.year);

  // Same bound as `accountBalance` below — `toDate` only, no lower bound — so
  // the per-project split sums to exactly the balance being closed even on a
  // tenant carrying unclosed earlier years.
  const posted = (await deps.ledger.listLines?.({ toDate: asOf, accountIds: accounts.map((a) => a.id) })) ?? [];
  const byAccount = new Map<string, Map<string, bigint>>();
  for (const line of posted) {
    let buckets = byAccount.get(line.accountId);
    if (!buckets) {
      buckets = new Map<string, bigint>();
      byAccount.set(line.accountId, buckets);
    }
    const key = line.projectId ?? "";
    buckets.set(key, (buckets.get(key) ?? 0n) + line.debit.scaled - line.credit.scaled);
  }

  const lines: YearEndClosePlanLine[] = [];
  let revenue = Money.zero();
  let expenses = Money.zero();

  for (const account of accounts) {
    const buckets = new Map(byAccount.get(account.id) ?? []);
    let covered = 0n;
    for (const value of buckets.values()) covered += value;
    const total = (await deps.ledger.accountBalance(account.id, asOf)).balance.scaled;
    // `listLines` is optional on the port, and a ledger that does not implement
    // it attributes nothing. Whatever the split could not account for closes
    // undimensioned, so the amount swept is the account's balance either way.
    const residual = total - covered;
    if (residual !== 0n) buckets.set("", (buckets.get("") ?? 0n) + residual);

    for (const key of [...buckets.keys()].sort()) {
      // `AccountBalance.balance` is debit − credit, sign convention-neutral. So a
      // revenue account that has earned reads NEGATIVE and an expense account
      // that has spent reads positive, and closing either one is simply the
      // mirror of its raw balance — no per-type branch, no sign to get backwards.
      const raw = buckets.get(key)!;
      if (raw === 0n) continue;

      if (account.type === "revenue") revenue = Money.fromScaled(revenue.scaled - raw);
      else expenses = Money.fromScaled(expenses.scaled + raw);

      lines.push({
        accountId: account.id,
        accountCode: account.code,
        accountNameAr: account.nameAr,
        accountType: account.type,
        projectId: key === "" ? null : key,
        debit: raw > 0n ? Money.zero() : Money.fromScaled(-raw),
        credit: raw > 0n ? Money.fromScaled(raw) : Money.zero(),
      });
    }
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

  const lines: JournalLineInput[] = plan.lines.map((line) => ({
    accountId: line.accountId,
    projectId: line.projectId,
    debit: line.debit,
    credit: line.credit,
  }));
  if (plan.netResult.scaled !== 0n) {
    for (const line of retainedEarningsLines(cmd.retainedEarningsAccountId, plan, deps)) lines.push(line);
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
    accountsClosed: new Set(plan.lines.map((line) => line.accountId)).size,
  };
}

/**
 * The balancing side. Retained earnings is equity, so normally it is one line
 * carrying the whole result. A chart that routes retained earnings through a
 * project-required slot would refuse that line, so it splits by project the
 * same way the P&L side did — each project's share is the mirror of what its
 * own closing lines moved, and the shares still sum to the year's result.
 */
function retainedEarningsLines(
  accountId: string,
  plan: YearEndClosePlan,
  deps: CloseYearDeps,
): readonly JournalLineInput[] {
  const asAmount = (projectId: string | null, scaled: bigint): JournalLineInput => ({
    accountId,
    projectId,
    debit: scaled > 0n ? Money.fromScaled(scaled) : Money.zero(),
    credit: scaled > 0n ? Money.zero() : Money.fromScaled(-scaled),
  });

  if (!deps.projectRequiredAccountIds?.has(accountId)) {
    return [asAmount(null, -plan.netResult.scaled)];
  }

  const byProject = new Map<string, bigint>();
  for (const line of plan.lines) {
    const key = line.projectId ?? "";
    byProject.set(key, (byProject.get(key) ?? 0n) + line.credit.scaled - line.debit.scaled);
  }
  const out: JournalLineInput[] = [];
  for (const key of [...byProject.keys()].sort()) {
    const scaled = byProject.get(key)!;
    if (scaled === 0n) continue;
    out.push(asAmount(key === "" ? null : key, scaled));
  }
  return out;
}
