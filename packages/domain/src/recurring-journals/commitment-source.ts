import { Money } from "../money/index.js";
import { duePeriods, journalDateForPeriod } from "./schedule.js";
import { RecurringJournalTemplateStatus, type RecurringJournalTemplate } from "./types.js";
import type { RecurringJournalRunRepository, RecurringJournalTemplateRepository } from "./store.js";

/**
 * E1-02's cash-forecast `CommitmentSource` port, reproduced here rather than
 * imported: E1-02 (`packages/domain/src/cash-forecast/`) is being built in a
 * PARALLEL lane and had not landed on `main` as of this branch (its work lives
 * on `origin/feat/enh-e1-02-cash-runway`, commit f722ac88). Reading that
 * branch's `store.ts`/`types.ts` is where this exact shape comes from —
 *
 *   export interface CommitmentWindow { readonly from: string; readonly to: string; }
 *   export interface CommitmentSource { readonly id: string; commitments(window): Promise<readonly CashCommitment[]>; }
 *   export interface CashCommitment { id; date; direction; amount; label; reference?; documentId?; }
 *
 * — so this file exports a structurally-identical, dependency-free source
 * function/factory. Once E1-02 merges, its backend area only needs to import
 * `recurringJournalCommitmentSource` from here and register it with
 * `registerCashCommitmentSource` (see `packages/backend/src/enh/e2-02.ts`);
 * nothing in THIS module needs to change.
 */
export interface RecurringJournalCommitmentWindow {
  readonly from: string;
  readonly to: string;
}

export enum RecurringJournalCommitmentDirection {
  Inflow = "inflow",
  Outflow = "outflow",
}

export interface RecurringJournalCommitment {
  readonly id: string;
  readonly date: string;
  readonly direction: RecurringJournalCommitmentDirection;
  readonly amount: Money;
  readonly label: string;
  readonly reference?: string | null;
  readonly documentId?: string | null;
}

/** Structurally identical to E1-02's `CommitmentSource` — see the file header. */
export interface RecurringJournalCommitmentSource {
  readonly id: string;
  commitments(window: RecurringJournalCommitmentWindow): Promise<readonly RecurringJournalCommitment[]>;
}

function netDirectionAndAmount(template: RecurringJournalTemplate): { direction: RecurringJournalCommitmentDirection; amount: Money } | null {
  // A template nets to a cash-forecast commitment only through the lines that
  // touch a cash/bank account; every other line is the OTHER side of the same
  // balanced entry (an expense, a control account) and would double the
  // movement if it were summed too. Lines never name a treasury account here
  // (a template line is a plain GL account), so — being conservative about a
  // port that has not landed yet — this reports the template's net P&L impact
  // (expense debits minus revenue credits) as the eventual cash effect,
  // which is exactly right for the common case this feature targets: a
  // recurring cash-settled expense (rent, subscriptions) with no cash line at
  // all is what a template holds, and its total debit IS the cash it will
  // take once posted and paid.
  let net = Money.zero();
  for (const line of template.lines) net = net.add(line.debit).add(line.credit.negate());
  if (net.equals(Money.zero())) return null;
  const negative = net.scaled < 0n;
  return { direction: negative ? RecurringJournalCommitmentDirection.Inflow : RecurringJournalCommitmentDirection.Outflow, amount: negative ? net.negate() : net };
}

export interface RecurringJournalCommitmentDeps {
  readonly templates: Pick<RecurringJournalTemplateRepository, "list">;
  readonly runs: Pick<RecurringJournalRunRepository, "findByTemplateAndPeriod">;
}

/** Every future occurrence, of every active template, inside `window` — skipping periods already posted as a run. */
export async function recurringJournalCommitments(
  deps: RecurringJournalCommitmentDeps,
  window: RecurringJournalCommitmentWindow,
): Promise<readonly RecurringJournalCommitment[]> {
  const templates = await deps.templates.list();
  const out: RecurringJournalCommitment[] = [];
  for (const template of templates) {
    if (template.status !== RecurringJournalTemplateStatus.Active) continue;
    const netted = netDirectionAndAmount(template);
    if (!netted) continue;
    for (const period of duePeriods(template, window.to)) {
      const date = journalDateForPeriod(template, period);
      if (date < window.from || date > window.to) continue;
      if (await deps.runs.findByTemplateAndPeriod(template.id, period)) continue;
      out.push({
        id: `recurring-journal:${template.id}:${period}`,
        date,
        direction: netted.direction,
        amount: netted.amount,
        label: template.nameAr,
        documentId: template.id,
      });
    }
  }
  return out;
}

/** Factory for the port itself — `id` matches what a `CommitmentSource[]` registry keys on. */
export function createRecurringJournalCommitmentSource(deps: RecurringJournalCommitmentDeps): RecurringJournalCommitmentSource {
  return {
    id: "recurring-journals",
    commitments: (window) => recurringJournalCommitments(deps, window),
  };
}
