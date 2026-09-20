import { Money } from "../money/index.js";
import { CashFlowDirection, type CashCommitment, type CommitmentSource, type CommitmentWindow } from "../cash-forecast/types.js";
import { duePeriods, journalDateForPeriod } from "./schedule.js";
import { RecurringJournalTemplateStatus, type RecurringJournalTemplate } from "./types.js";
import type { RecurringJournalRunRepository, RecurringJournalSkipRepository, RecurringJournalTemplateRepository } from "./store.js";

function netDirectionAndAmount(template: RecurringJournalTemplate): { direction: CashFlowDirection; amount: Money } | null {
  // A template nets to a cash-forecast commitment only through the lines that
  // touch a cash/bank account; every other line is the OTHER side of the same
  // balanced entry (an expense, a control account) and would double the
  // movement if it were summed too. Lines never name a treasury account here
  // (a template line is a plain GL account), so — being conservative about a
  // port — this reports the template's net P&L impact
  // (expense debits minus revenue credits) as the eventual cash effect,
  // which is exactly right for the common case this feature targets: a
  // recurring cash-settled expense (rent, subscriptions) with no cash line at
  // all is what a template holds, and its total debit IS the cash it will
  // take once posted and paid.
  let net = Money.zero();
  for (const line of template.lines) net = net.add(line.debit).add(line.credit.negate());
  if (net.equals(Money.zero())) return null;
  const negative = net.scaled < 0n;
  return { direction: negative ? CashFlowDirection.Inflow : CashFlowDirection.Outflow, amount: negative ? net.negate() : net };
}

export interface RecurringJournalCommitmentDeps {
  readonly templates: Pick<RecurringJournalTemplateRepository, "list">;
  readonly runs: Pick<RecurringJournalRunRepository, "findByTemplateAndPeriod">;
  /**
   * A period the operator skipped is not a future cash movement either — the
   * forecast fed on the run repository alone (D... ENH-E2-02) and would keep
   * projecting a rent accrual the owner had already waived.
   */
  readonly skips: Pick<RecurringJournalSkipRepository, "findByTemplateAndPeriod">;
}

/** Every future occurrence, of every active template, inside `window` — skipping periods already posted as a run OR deliberately skipped. */
export async function recurringJournalCommitments(
  deps: RecurringJournalCommitmentDeps,
  window: CommitmentWindow,
): Promise<readonly CashCommitment[]> {
  const templates = await deps.templates.list();
  const out: CashCommitment[] = [];
  for (const template of templates) {
    if (template.status !== RecurringJournalTemplateStatus.Active) continue;
    const netted = netDirectionAndAmount(template);
    if (!netted) continue;
    for (const period of duePeriods(template, window.to)) {
      const date = journalDateForPeriod(template, period);
      if (date < window.from || date > window.to) continue;
      if (await deps.runs.findByTemplateAndPeriod(template.id, period)) continue;
      if (await deps.skips.findByTemplateAndPeriod(template.id, period)) continue;
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
export function createRecurringJournalCommitmentSource(deps: RecurringJournalCommitmentDeps): CommitmentSource {
  return {
    id: "recurring-journals",
    commitments: (window) => recurringJournalCommitments(deps, window),
  };
}
