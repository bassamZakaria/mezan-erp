import { Money } from "../money/index.js";
import { CashFlowDirection, type CashCommitment, type CommitmentSource, type CommitmentWindow } from "../cash-forecast/types.js";
import { duePeriods, journalDateForPeriod } from "./schedule.js";
import { RecurringJournalTemplateStatus, type RecurringJournalTemplate } from "./types.js";
import type { RecurringJournalRunRepository, RecurringJournalSkipRepository, RecurringJournalTemplateRepository } from "./store.js";

/**
 * How a template's future occurrence reaches the cash forecast — which of its
 * lines the projected movement is read from.
 */
export enum CommitmentCashBasis {
  /** A line posting straight to a treasury account's own GL account: the cash moves on the entry's date. */
  CashAccount = "cash_account",
  /** No cash line, but a customer/supplier control line: the cash moves when that receivable or payable settles. */
  PartyControl = "party_control",
}

export interface CommitmentNet {
  readonly basis: CommitmentCashBasis;
  readonly direction: CashFlowDirection;
  readonly amount: Money;
}

/**
 * The cash a template's occurrence will move, and which way.
 *
 * A template BALANCES to save, so `debit − credit` over EVERY line is
 * mathematically always zero — the previous implementation summed exactly that,
 * always returned null, and `recurringJournalCommitments` therefore emitted
 * nothing for any template ever. Measured on the seeded tenant before the fix:
 * `GET /cash-forecast?horizon=90` returned `byKind.commitment: "0.000000"` and
 * zero commitment items across 90 days with «رسوم اشتراك سحابي شهرية»
 * (500 / 500, active since January) due three times inside the window.
 *
 * A commitment is a CASH movement, so the net is taken over the lines that
 * touch cash, and only when there are none over the lines that touch a party
 * control account — never over the whole entry, whose other side is the expense
 * or revenue that funds it. A template that touches neither (depreciation,
 * prepaid amortization, an accrual reclass) moves no cash at all and is
 * correctly projected as nothing rather than as its P&L effect.
 */
export function commitmentNet(
  template: RecurringJournalTemplate,
  cashAccountIds: ReadonlySet<string>,
  partyControlAccountIds: ReadonlySet<string>,
): CommitmentNet | null {
  const netOver = (accountIds: ReadonlySet<string>): Money => {
    let net = Money.zero();
    for (const line of template.lines) {
      if (!accountIds.has(line.accountId)) continue;
      net = net.add(line.debit).add(line.credit.negate());
    }
    return net;
  };
  const cash = netOver(cashAccountIds);
  if (!cash.equals(Money.zero())) return signed(CommitmentCashBasis.CashAccount, cash);
  const party = netOver(partyControlAccountIds);
  if (!party.equals(Money.zero())) return signed(CommitmentCashBasis.PartyControl, party);
  return null;
}

/**
 * Cash rising (a net debit) is money coming in; cash falling is money going
 * out. A party control line reads the same way one step later: a net debit to
 * receivables is cash the customer will hand over, a net credit to payables is
 * cash this tenant will hand over.
 */
function signed(basis: CommitmentCashBasis, net: Money): CommitmentNet {
  const outflow = net.scaled < 0n;
  return { basis, direction: outflow ? CashFlowDirection.Outflow : CashFlowDirection.Inflow, amount: outflow ? net.negate() : net };
}

/**
 * A template's branch is the branch its lines agree on. Lines that disagree, or
 * carry none, leave the commitment unattributed — a branch-narrowed forecast
 * then reports it as such rather than charging it to one branch.
 */
function templateBranch(template: RecurringJournalTemplate): string | null {
  const branches = new Set(template.lines.map((line) => line.branchId ?? null));
  if (branches.size !== 1) return null;
  return [...branches][0] ?? null;
}

export interface RecurringJournalCommitmentDeps {
  readonly templates: Pick<RecurringJournalTemplateRepository, "list">;
  readonly runs: Pick<RecurringJournalRunRepository, "findByTemplateAndPeriod">;
  /**
   * A period the operator skipped is not a future cash movement either — the
   * forecast fed on the run repository alone (ENH-E2-02) and would keep
   * projecting a rent accrual the owner had already waived.
   */
  readonly skips: Pick<RecurringJournalSkipRepository, "findByTemplateAndPeriod">;
  /**
   * The GL accounts cash actually sits in — every treasury account's own
   * `glAccountId`. It is deliberately the same set the forecast reads its
   * opening balance from, so a projected commitment and the balance it moves
   * are measured against the same accounts.
   */
  readonly cashAccountIds: () => Promise<ReadonlySet<string>>;
  /** The routed customer and supplier control accounts (`control.receivable` / `control.payable`). */
  readonly partyControlAccountIds: () => Promise<ReadonlySet<string>>;
}

/** Every future occurrence, of every active template, inside `window` — skipping periods already posted as a run OR deliberately skipped. */
export async function recurringJournalCommitments(
  deps: RecurringJournalCommitmentDeps,
  window: CommitmentWindow,
): Promise<readonly CashCommitment[]> {
  const [templates, cashAccountIds, partyControlAccountIds] = await Promise.all([
    deps.templates.list(),
    deps.cashAccountIds(),
    deps.partyControlAccountIds(),
  ]);
  const out: CashCommitment[] = [];
  for (const template of templates) {
    if (template.status !== RecurringJournalTemplateStatus.Active) continue;
    const netted = commitmentNet(template, cashAccountIds, partyControlAccountIds);
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
        branchId: templateBranch(template),
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
