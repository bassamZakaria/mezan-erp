import { Money } from "../money/index.js";
import { postJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import { applyAdvanceRecovery, type EmployeeAdvanceRepository } from "./advance.js";
import {
  canTransitionPayrollRun,
  type PayrollGlAccounts,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipRepository,
} from "./payroll-run.js";
import {
  EmployeeAdvanceNotFoundError,
  InvalidPayrollRunTransitionError,
  NoPayableEmployeesError,
  PayrollRunNotFoundError,
} from "./errors.js";

/**
 * Posting a payroll run (docs/archive/catalog/06 "الرواتب" — معتمد). Approval is what
 * makes the run real in the books: ONE balanced journal entry for the whole
 * run, through the REAL GL posting engine, so the fiscal-period gate, the
 * postable/active-account checks and the balance assertion all apply exactly
 * as they do to every other document.
 *
 *   Dr  مصروف الرواتب (5120)          gross earnings
 *   Dr  مساهمات صاحب العمل (5130)     employer contributions (none configured yet)
 *   Cr  سلف الموظفين (1160)           advance recovery
 *   Cr  استقطاعات رواتب (2190)        other deductions
 *   Cr  رواتب مستحقة (2170)           net pay
 *
 * The credit side is the identity gross = deductions + net, so the entry is
 * balanced by construction; `postJournalEntry` re-asserts it and REJECTS the
 * run rather than post an unbalanced entry.
 */

export interface PostPayrollRunDeps {
  readonly runs: PayrollRunRepository;
  readonly payslips: Pick<PayslipRepository, "listByRunId">;
  readonly advances: Pick<EmployeeAdvanceRepository, "findById" | "update">;
  readonly gl: JournalPostingDeps;
  readonly accounts: PayrollGlAccounts;
  readonly now?: () => string;
}

function addTo(totals: Map<string, bigint>, accountId: string, amount: Money): void {
  totals.set(accountId, (totals.get(accountId) ?? 0n) + amount.scaled);
}

function buildJournalLines(payslips: readonly Payslip[], accounts: PayrollGlAccounts): JournalLineInput[] {
  const debits = new Map<string, bigint>();
  const credits = new Map<string, bigint>();

  for (const payslip of payslips) {
    for (const line of payslip.lines) {
      if (line.kind === "earning") {
        addTo(debits, line.glAccountId ?? accounts.salaryExpenseAccountId, line.amount);
      } else if (line.kind === "employer_contribution") {
        addTo(debits, line.glAccountId ?? accounts.employerContributionExpenseAccountId, line.amount);
        addTo(credits, accounts.employerContributionLiabilityAccountId, line.amount);
      } else if (line.source === "advance_recovery") {
        addTo(credits, accounts.employeeAdvanceAccountId, line.amount);
      } else {
        addTo(credits, line.glAccountId ?? accounts.deductionLiabilityAccountId, line.amount);
      }
    }
    addTo(credits, accounts.salariesPayableAccountId, payslip.netPay);
  }

  const lines: JournalLineInput[] = [];
  for (const [accountId, scaled] of debits) {
    if (scaled === 0n) continue;
    lines.push({ accountId, debit: Money.fromScaled(scaled), credit: Money.zero() });
  }
  for (const [accountId, scaled] of credits) {
    if (scaled === 0n) continue;
    lines.push({ accountId, debit: Money.zero(), credit: Money.fromScaled(scaled) });
  }
  return lines;
}

/**
 * Approves a محتسب (calculated) run: posts its journal entry, then applies each
 * payslip's advance-recovery lines to the underlying advances (an advance whose
 * outstanding reaches zero flips to مسددة). Recovery is applied only AFTER the
 * entry posts, so a rejected posting leaves advance balances untouched.
 */
export async function approvePayrollRun(runId: string, approvedBy: string, deps: PostPayrollRunDeps): Promise<PayrollRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new PayrollRunNotFoundError(runId);
  if (!canTransitionPayrollRun(run.status, "approved")) {
    throw new InvalidPayrollRunTransitionError(run.status, "approved");
  }

  const payslips = await deps.payslips.listByRunId(runId);
  if (payslips.length === 0) throw new NoPayableEmployeesError(runId);

  const lines = buildJournalLines(payslips, deps.accounts);
  const entry = await postJournalEntry(
    {
      id: `PAYROLL-JE:${run.id}`,
      date: run.periodEnd,
      memo: `رواتب ${run.number} — ${run.year}-${String(run.month).padStart(2, "0")}`,
      source: "system",
      sourceDocType: "PAYROLL_RUN",
      sourceDocId: run.id,
      sourceDocNumber: run.number,
      lines,
    },
    deps.gl,
  );

  const now = deps.now?.() ?? new Date().toISOString();
  const recoveryByAdvance = new Map<string, bigint>();
  for (const payslip of payslips) {
    for (const line of payslip.lines) {
      if (line.source !== "advance_recovery" || line.referenceId === null) continue;
      recoveryByAdvance.set(line.referenceId, (recoveryByAdvance.get(line.referenceId) ?? 0n) + line.amount.scaled);
    }
  }
  for (const [advanceId, scaled] of recoveryByAdvance) {
    const advance = await deps.advances.findById(advanceId);
    if (!advance) throw new EmployeeAdvanceNotFoundError(advanceId);
    await deps.advances.update(applyAdvanceRecovery(advance, Money.fromScaled(scaled), now));
  }

  const approved: PayrollRun = {
    ...run,
    status: "approved",
    journalEntryId: entry.id,
    approvedAt: now,
    approvedBy,
  };
  await deps.runs.update(approved);
  return approved;
}
