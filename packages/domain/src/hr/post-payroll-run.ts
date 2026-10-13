import { Money } from "../money/index.js";
import { nextEntryGenerationId, postJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import { applyAdvanceRecovery, type EmployeeAdvanceRepository } from "./advance.js";
import type { EmployeeDirectory } from "../hr-shared/employee-ref.js";
import { applyGarnishmentRecovery, type GarnishmentRepository } from "./garnishment.js";
import {
  canTransitionPayrollRun,
  PayslipLineKindCode,
  type PayrollGlAccounts,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipRepository,
} from "./payroll-run.js";
import {
  EmployeeAdvanceNotFoundError,
  GarnishmentNotFoundError,
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
 *   Dr  مساهمات صاحب العمل (5130)     employer contributions (social insurance when statutory is on)
 *   Cr  ضريبة كسب العمل مستحقة (2191) salary tax withheld
 *   Cr  التأمينات الاجتماعية (2192)   BOTH insurance shares
 *   Cr  حجوزات على الأجور (2193)      garnishments
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
  /** Absent = garnishment lines post to the ledger but no order is counted down. */
  readonly garnishments?: Pick<GarnishmentRepository, "findById" | "update">;
  /** Resolves each payslip's branch for the journal lines (DEC-20) when the run spans every branch; absent = those lines stay unattributed. */
  readonly employees?: Pick<EmployeeDirectory, "findById">;
  readonly gl: JournalPostingDeps;
  readonly accounts: PayrollGlAccounts;
  readonly now?: () => string;
}

type BranchedTotals = Map<string, { readonly accountId: string; readonly branchId: string | null; scaled: bigint }>;

function addTo(totals: BranchedTotals, accountId: string, branchId: string | null, amount: Money): void {
  const key = `${accountId}\u0000${branchId ?? ""}`;
  const bucket = totals.get(key);
  if (bucket) bucket.scaled += amount.scaled;
  else totals.set(key, { accountId, branchId, scaled: amount.scaled });
}

function buildJournalLines(
  payslips: readonly Payslip[],
  accounts: PayrollGlAccounts,
  branchOf: (payslip: Payslip) => string | null,
): JournalLineInput[] {
  const debits: BranchedTotals = new Map();
  const credits: BranchedTotals = new Map();

  for (const payslip of payslips) {
    const branchId = branchOf(payslip);
    for (const line of payslip.lines) {
      if (line.kind === "earning") {
        addTo(debits, line.glAccountId ?? accounts.salaryExpenseAccountId, branchId, line.amount);
      } else if (line.kind === "employer_contribution") {
        addTo(debits, line.glAccountId ?? accounts.employerContributionExpenseAccountId, branchId, line.amount);
        // The credit follows WHO the money is owed to: the insurance authority
        // for the employer's share, the general withholdings pool otherwise.
        addTo(
          credits,
          line.source === "social_insurance_employer" ? accounts.socialInsurancePayableAccountId : accounts.employerContributionLiabilityAccountId,
          branchId,
          line.amount,
        );
      } else if (line.kind === PayslipLineKindCode.TerminationAdjustment) {
        addTo(credits, accounts.salariesPayableAccountId, branchId, line.amount);
      } else if (line.source === "advance_recovery") {
        addTo(credits, accounts.employeeAdvanceAccountId, branchId, line.amount);
      } else {
        addTo(credits, line.glAccountId ?? accounts.deductionLiabilityAccountId, branchId, line.amount);
      }
    }
    addTo(credits, accounts.salariesPayableAccountId, branchId, payslip.netPay);
  }

  const lines: JournalLineInput[] = [];
  for (const { accountId, branchId, scaled } of debits.values()) {
    if (scaled === 0n) continue;
    lines.push({ accountId, debit: Money.fromScaled(scaled), credit: Money.zero(), branchId });
  }
  for (const { accountId, branchId, scaled } of credits.values()) {
    if (scaled === 0n) continue;
    lines.push({ accountId, debit: Money.zero(), credit: Money.fromScaled(scaled), branchId });
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

  const employeeBranch = new Map<string, string | null>();
  if (run.branchId === null && deps.employees) {
    for (const employeeId of new Set(payslips.map((p) => p.employeeId))) {
      employeeBranch.set(employeeId, (await deps.employees.findById(employeeId))?.branchId ?? null);
    }
  }
  const lines = buildJournalLines(payslips, deps.accounts, (p) => run.branchId ?? employeeBranch.get(p.employeeId) ?? null);
  const entry = await postJournalEntry(
    {
      id: await nextEntryGenerationId(deps.gl.ledger, `PAYROLL-JE:${run.id}`),
      date: run.periodEnd,
      memo: `رواتب ${run.number} — ${run.year}-${String(run.month).padStart(2, "0")}`,
      source: "system",
      sourceDocType: "PAYROLL_RUN",
      sourceDocId: run.id,
      sourceDocNumber: run.number,
      lines,
    },
    deps.gl,
    { mintedBySystem: true },
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

  if (deps.garnishments) {
    const withheldByOrder = new Map<string, bigint>();
    for (const payslip of payslips) {
      for (const line of payslip.lines) {
        if (line.source !== "garnishment" || line.referenceId === null) continue;
        withheldByOrder.set(line.referenceId, (withheldByOrder.get(line.referenceId) ?? 0n) + line.amount.scaled);
      }
    }
    for (const [orderId, scaled] of withheldByOrder) {
      const order = await deps.garnishments.findById(orderId);
      if (!order) throw new GarnishmentNotFoundError(orderId);
      await deps.garnishments.update(applyGarnishmentRecovery(order, Money.fromScaled(scaled), () => now));
    }
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
