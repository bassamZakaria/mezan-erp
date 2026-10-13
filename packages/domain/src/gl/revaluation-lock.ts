import type { AccountRepository } from "../accounts/account.js";
import { isMonetaryAccountType } from "../accounts/monetary.js";
import { isBaseCurrency } from "../exchange-rates/convert.js";
import type { JournalEntry } from "../journal.js";
import type { LedgerRepository } from "./ledger.js";

export const FX_REVALUATION_DOC_TYPE = "FX_REVALUATION";
export const FX_SHARE_RELEASE_ENTRY_PREFIX = "FXR:release:";

export class PostingBeforeRevaluationError extends Error {
  readonly code = "FX_POSTING_BEFORE_REVALUATION";
  readonly messageEn: string;
  constructor(
    readonly date: string,
    readonly currency: string,
    readonly runNo: string,
    readonly runDate: string,
    readonly earliestAllowedDate: string,
  ) {
    super(
      `لا يمكن ترحيل حركة بعملة ${currency} على حساب ذمم أو خزينة أو بنك بتاريخ ${date}: تشغيل إعادة تقييم العملات ${runNo} بتاريخ ${runDate} ما زال قائماً وقد أعاد تقييم أرصدة هذه العملة حتى ذلك اليوم. ` +
        `أرّخ المستند من ${earliestAllowedDate} فصاعداً، أو اعكس التشغيل أولاً ثم أعد الترحيل.`,
    );
    this.messageEn = `A ${currency} line on a receivable, payable, cash or bank account cannot be posted on ${date}: revaluation run ${runNo} dated ${runDate} still stands and restated this currency's balances as of that day. Date the document ${earliestAllowedDate} or later, or reverse the run first and post again.`;
    this.name = "PostingBeforeRevaluationError";
  }
}

/** ISO date (YYYY-MM-DD) one day after `date`, computed in UTC (no float, no TZ drift). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function latestStandingRevaluation(currencies: ReadonlySet<string>, ledger: Pick<LedgerRepository, "list">): Promise<{ run: JournalEntry; currency: string } | null> {
  if (currencies.size === 0) return null;
  let latest: { run: JournalEntry; currency: string } | null = null;
  for (const run of await ledger.list({ sourceDocTypes: [FX_REVALUATION_DOC_TYPE] })) {
    if (run.sourceDocType !== FX_REVALUATION_DOC_TYPE || run.status !== "posted" || run.reversesEntryId || run.reversedByEntryId) continue;
    const currency = run.lines.find((line) => line.currency && currencies.has(line.currency))?.currency;
    if (currency && (latest === null || run.date > latest.run.date)) latest = { run, currency };
  }
  return latest;
}

// INVARIANT: no wire contract carries these; a route that copies one from a request body reopens what it guards.
export interface JournalPostingInternals {
  readonly isRevaluationRun?: boolean;
  readonly mintedBySystem?: boolean;
}

export interface RevaluationLockDeps {
  readonly ledger: Pick<LedgerRepository, "list">;
  readonly accounts: Pick<AccountRepository, "findById">;
}

async function restatedCurrenciesOf(lines: readonly { readonly accountId: string; readonly currency?: string | null }[], accounts: Pick<AccountRepository, "findById">): Promise<Set<string>> {
  const currencies = new Set<string>();
  for (const line of lines) {
    if (!line.currency || isBaseCurrency(line.currency) || currencies.has(line.currency)) continue;
    const account = await accounts.findById(line.accountId);
    if (account && isMonetaryAccountType(account.type)) currencies.add(line.currency);
  }
  return currencies;
}

// INVARIANT: a standing non-reversing run restated every monetary balance in its currencies as of its own day; a line on such an account dated on or before that day would change what the run should have restated. Only the run's own entry and its reversal are let through, by an option no request body can set (fx-backdate-guard.test.ts).
export async function assertNotBeforeStandingRevaluation(
  posting: { readonly date: string; readonly lines: readonly { readonly accountId: string; readonly currency?: string | null }[] },
  deps: RevaluationLockDeps,
  internal: JournalPostingInternals = {},
): Promise<void> {
  if (internal.isRevaluationRun) return;
  const standing = await latestStandingRevaluation(await restatedCurrenciesOf(posting.lines, deps.accounts), deps.ledger);
  if (!standing) return;
  const day = posting.date.slice(0, 10);
  const runDay = standing.run.date.slice(0, 10);
  if (day <= runDay) throw new PostingBeforeRevaluationError(day, standing.currency, standing.run.entryNo ?? standing.run.id, runDay, nextDay(runDay));
}
