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
      `لا يمكن الترحيل بعملة ${currency} بتاريخ ${date}: تشغيل إعادة تقييم العملات ${runNo} بتاريخ ${runDate} ما زال قائماً وقد أعاد تقييم أرصدة هذه العملة حتى ذلك اليوم. ` +
        `أرّخ المستند من ${earliestAllowedDate} فصاعداً، أو اعكس التشغيل أولاً.`,
    );
    this.messageEn = `Nothing in ${currency} can be posted on ${date}: revaluation run ${runNo} dated ${runDate} still stands and restated this currency's balances as of that day. Date the document ${earliestAllowedDate} or later, or reverse the run first.`;
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

export async function earliestDayAfterRevaluation(currencies: ReadonlySet<string>, ledger: Pick<LedgerRepository, "list">): Promise<string | null> {
  const standing = await latestStandingRevaluation(currencies, ledger);
  return standing ? nextDay(standing.run.date.slice(0, 10)) : null;
}

// INVARIANT: a standing non-reversing run restated every balance in its currencies as of its own day; a posting dated on or before that day would change what the run should have restated (fx-late-runs.test.ts).
export async function assertNotBeforeStandingRevaluation(
  posting: { readonly id: string; readonly date: string; readonly sourceDocType?: string | null; readonly lines: readonly { readonly currency?: string | null }[] },
  ledger: Pick<LedgerRepository, "list">,
): Promise<void> {
  if (posting.sourceDocType === FX_REVALUATION_DOC_TYPE || posting.id.startsWith(FX_SHARE_RELEASE_ENTRY_PREFIX)) return;
  const standing = await latestStandingRevaluation(new Set(posting.lines.flatMap((line) => (line.currency ? [line.currency] : []))), ledger);
  if (!standing) return;
  const day = posting.date.slice(0, 10);
  const runDay = standing.run.date.slice(0, 10);
  if (day <= runDay) throw new PostingBeforeRevaluationError(day, standing.currency, standing.run.entryNo ?? standing.run.id, runDay, nextDay(runDay));
}
