import { Money, allocate } from "../money/index.js";
import type { EmployeeDirectory, EmployeeRef } from "../hr-shared/employee-ref.js";
import { getPayBasisLabel, getPayFrequencyLabel, type Contract, type ContractRepository } from "./contract.js";
import {
  amountDueBy,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
} from "./advance.js";
import {
  canTransitionPayrollRun,
  inclusiveDays,
  payrollPeriodBounds,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipLine,
  type PayslipRepository,
  type UnpaidLeaveDaysProvider,
} from "./payroll-run.js";
import {
  DuplicatePayrollPeriodError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  NegativeNetPayError,
  NoPayableEmployeesError,
  PayrollRunNotFoundError,
} from "./errors.js";

/**
 * The payroll calculation engine (docs/catalog/06 "الرواتب").
 *
 * WHAT IT COMPUTES — and nothing else:
 *   - gross = the active contract's monthly salary + its allowance lines,
 *     each PRORATED by the days the contract was actually live inside the
 *     period (hire mid-month, contract start/end mid-month);
 *   - deductions = the contract's own deduction lines (fixed monthly amounts,
 *     NOT prorated), an unpaid-leave deduction if and only if an unpaid-leave
 *     day source is bound, and advance-recovery instalments falling due;
 *   - net = gross − deductions.
 *
 * Every proration and split runs through `allocate` (largest remainder) so the
 * parts sum EXACTLY to the whole — payroll never loses or invents a unit.
 *
 * WHAT IT DOES NOT COMPUTE: income tax, social insurance (employee or
 * employer share), overtime, seniority bonuses, end-of-service. The catalog
 * specifies no formula for any of them, so this engine produces no line for
 * them rather than a plausible-looking wrong one. They slot in as additional
 * `PayslipLine`s when their rules are actually specified, and are enumerated
 * for the screens in `PAYROLL_UNIMPLEMENTED_RULES` (payroll-run.ts).
 */

export interface PayrollNumbering {
  next(code: string): Promise<{ readonly formatted: string }>;
}

export interface CreatePayrollRunCommand {
  readonly id: string;
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly branchId?: string | null;
  readonly currency?: string;
  readonly now?: () => string;
}

export interface PayrollCalculationDeps {
  readonly runs: PayrollRunRepository;
  readonly payslips: PayslipRepository;
  readonly employees: EmployeeDirectory;
  readonly contracts: Pick<ContractRepository, "listByEmployeeId">;
  readonly advances: Pick<EmployeeAdvanceRepository, "listByEmployeeId">;
  readonly numbering: PayrollNumbering;
  /** Bound by the attendance/leave side of HR; absent = no unpaid-leave day is deducted (recorded on the run). */
  readonly unpaidLeave?: UnpaidLeaveDaysProvider;
  readonly idGen?: () => string;
  readonly now?: () => string;
}

/** Opens a مسودة (draft) run for one month. Rejects a second live run for the same period + branch scope. */
export async function createPayrollRun(
  cmd: CreatePayrollRunCommand,
  deps: Pick<PayrollCalculationDeps, "runs" | "numbering">,
): Promise<PayrollRun> {
  const reasons: string[] = [];
  if (!Number.isInteger(cmd.year) || cmd.year < 1900) reasons.push("السنة مطلوبة");
  if (!Number.isInteger(cmd.month) || cmd.month < 1 || cmd.month > 12) reasons.push("الشهر يجب أن يكون بين 1 و 12");
  if (reasons.length > 0) throw new InvalidPayrollRunError(reasons);

  const branchId = cmd.branchId ?? null;
  const existing = await deps.runs.findByPeriod(cmd.year, cmd.month, branchId);
  if (existing && existing.status !== "cancelled") {
    throw new DuplicatePayrollPeriodError(cmd.year, cmd.month, branchId);
  }

  const bounds = payrollPeriodBounds(cmd.year, cmd.month);
  const number = (await deps.numbering.next("PAYROLL_RUN")).formatted;
  const run: PayrollRun = {
    id: cmd.id,
    number,
    year: cmd.year,
    month: cmd.month,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    branchId,
    currency: cmd.currency ?? "EGP",
    status: "draft",
    employeeCount: 0,
    totalGross: Money.zero(),
    totalDeductions: Money.zero(),
    totalEmployerContributions: Money.zero(),
    totalNet: Money.zero(),
    unpaidLeaveSource: "none",
    warnings: [],
    journalEntryId: null,
    disbursementVoucherId: null,
    calculatedAt: null,
    approvedAt: null,
    approvedBy: null,
    disbursedAt: null,
    cancelledAt: null,
    createdAt: cmd.now?.() ?? new Date().toISOString(),
  };
  await deps.runs.create(run);
  return run;
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/** The contract in force for the period: active, and overlapping [periodStart, periodEnd]. Latest start wins. */
function pickContract(contracts: readonly Contract[], periodStart: string, periodEnd: string): Contract | null {
  const candidates = contracts.filter(
    (c) => c.status === "active" && c.startDate <= periodEnd && (c.endDate === null || c.endDate >= periodStart),
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0] ?? null;
}

/** Prorates a monthly amount over the days the contract was live. Exact — the two parts always sum to `amount`. */
function prorate(amount: Money, paidDays: number, periodDays: number): Money {
  if (paidDays >= periodDays) return amount;
  return allocate(amount, [paidDays, periodDays - paidDays])[0] as Money;
}

interface EmployeePayrollInput {
  readonly employee: EmployeeRef;
  readonly contract: Contract;
  readonly paidDays: number;
}

/**
 * Calculates (or recalculates) a run: replaces its payslips wholesale and
 * moves it to محتسب (calculated). Advance balances are NOT touched here — a
 * recalculation must be free of side effects; recovery is applied when the run
 * is approved and its journal entry posts.
 */
export async function calculatePayrollRun(runId: string, deps: PayrollCalculationDeps): Promise<PayrollRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new PayrollRunNotFoundError(runId);
  if (!canTransitionPayrollRun(run.status, "calculated")) {
    throw new InvalidPayrollRunTransitionError(run.status, "calculated");
  }

  const now = deps.now?.() ?? new Date().toISOString();
  const idGen = deps.idGen ?? (() => `${runId}:${Math.random().toString(36).slice(2)}`);
  const periodDays = inclusiveDays(run.periodStart, run.periodEnd);
  const warnings: string[] = [];

  const employees = (await deps.employees.listActive()).filter((e) => run.branchId === null || e.branchId === run.branchId);

  const inputs: EmployeePayrollInput[] = [];
  for (const employee of employees) {
    const contract = pickContract(await deps.contracts.listByEmployeeId(employee.id), run.periodStart, run.periodEnd);
    if (!contract) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): لا يوجد عقد ساري خلال الفترة — تم استبعاده.`);
      continue;
    }
    if (contract.payBasis !== "monthly") {
      warnings.push(`${employee.fullNameAr} (${employee.code}): أساس الدفع "${getPayBasisLabel(contract.payBasis)}" يحتاج بيانات حضور — تم استبعاده.`);
      continue;
    }
    if (contract.currency !== run.currency) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): عملة العقد (${contract.currency}) تختلف عن عملة الدورة (${run.currency}) — تم استبعاده.`);
      continue;
    }
    if (contract.payFrequency !== "monthly") {
      warnings.push(`${employee.fullNameAr} (${employee.code}): تكرار الدفع "${getPayFrequencyLabel(contract.payFrequency)}" — احتُسب راتب شهر كامل للفترة.`);
    }
    const paidStart = maxDate(maxDate(run.periodStart, contract.startDate), employee.hireDate);
    const paidEnd = minDate(run.periodEnd, contract.endDate ?? run.periodEnd);
    const paidDays = inclusiveDays(paidStart, paidEnd);
    if (paidDays <= 0) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): لا توجد أيام مستحقة خلال الفترة — تم استبعاده.`);
      continue;
    }
    if (paidDays < periodDays) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): احتُسب ${paidDays} من ${periodDays} يوماً بالتناسب.`);
    }
    inputs.push({ employee, contract, paidDays });
  }

  if (inputs.length === 0) throw new NoPayableEmployeesError(runId);

  if (!deps.unpaidLeave) {
    warnings.push("لم يُربط مصدر أيام الإجازات بدون أجر — لم تُخصم أي أيام إجازة بدون أجر في هذه الدورة.");
  }

  const payslips: Payslip[] = [];
  for (const { employee, contract, paidDays } of inputs) {
    const lines: PayslipLine[] = [];

    lines.push({
      id: idGen(),
      kind: "earning",
      source: "contract_basic",
      nameAr: "الراتب الأساسي",
      amount: prorate(contract.monthlySalary, paidDays, periodDays),
      glAccountId: null,
      referenceId: null,
    });
    for (const allowance of contract.allowances) {
      lines.push({
        id: idGen(),
        kind: "earning",
        source: "contract_allowance",
        nameAr: allowance.name,
        amount: prorate(allowance.amount, paidDays, periodDays),
        glAccountId: null,
        referenceId: null,
      });
    }

    const grossEarnings = Money.sum(lines.filter((l) => l.kind === "earning").map((l) => l.amount));

    if (deps.unpaidLeave) {
      const reported = await deps.unpaidLeave.unpaidDaysFor(employee.id, run.periodStart, run.periodEnd);
      const unpaidDays = Math.min(Math.max(Math.round(reported), 0), paidDays);
      if (unpaidDays > 0) {
        lines.push({
          id: idGen(),
          kind: "deduction",
          source: "unpaid_leave",
          nameAr: `إجازة بدون أجر (${unpaidDays} يوم)`,
          amount: allocate(grossEarnings, [unpaidDays, paidDays - unpaidDays])[0] as Money,
          glAccountId: null,
          referenceId: null,
        });
      }
    }

    for (const deduction of contract.deductions) {
      lines.push({
        id: idGen(),
        kind: "deduction",
        source: "contract_deduction",
        nameAr: deduction.name,
        amount: deduction.amount,
        glAccountId: null,
        referenceId: null,
      });
    }

    const fixedDeductions = Money.sum(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
    let available = grossEarnings.scaled - fixedDeductions.scaled;
    if (available < 0n) {
      throw new NegativeNetPayError(employee.id, grossEarnings.toString(), fixedDeductions.toString());
    }

    const advances = (await deps.advances.listByEmployeeId(employee.id))
      .filter((a: EmployeeAdvance) => a.status === "disbursed")
      .sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
    for (const advance of advances) {
      if (available <= 0n) break;
      if (advance.currency !== run.currency) {
        warnings.push(`${employee.fullNameAr} (${employee.code}): السلفة ${advance.number} بعملة ${advance.currency} — لم تُخصم.`);
        continue;
      }
      const due = amountDueBy(advance, run.periodEnd).scaled;
      if (due <= 0n) continue;
      const take = due < available ? due : available;
      available -= take;
      if (take < due) {
        warnings.push(`${employee.fullNameAr} (${employee.code}): قسط السلفة ${advance.number} خُصم جزئياً بحدود صافي الراتب المتاح — يُرحّل الباقي.`);
      }
      lines.push({
        id: idGen(),
        kind: "deduction",
        source: "advance_recovery",
        nameAr: `سداد سلفة ${advance.number}`,
        amount: Money.fromScaled(take),
        glAccountId: null,
        referenceId: advance.id,
      });
    }

    const totalDeductions = Money.sum(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
    const employerContributions = Money.sum(lines.filter((l) => l.kind === "employer_contribution").map((l) => l.amount));
    const netPay = Money.fromScaled(grossEarnings.scaled - totalDeductions.scaled);

    payslips.push({
      id: idGen(),
      number: (await deps.numbering.next("PAYSLIP")).formatted,
      runId: run.id,
      employeeId: employee.id,
      contractId: contract.id,
      currency: run.currency,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      periodDays,
      paidDays,
      lines,
      grossEarnings,
      totalDeductions,
      employerContributions,
      netPay,
      createdAt: now,
    });
  }

  await deps.payslips.deleteByRunId(run.id);
  for (const payslip of payslips) await deps.payslips.create(payslip);

  const calculated: PayrollRun = {
    ...run,
    status: "calculated",
    employeeCount: payslips.length,
    totalGross: Money.sum(payslips.map((p) => p.grossEarnings)),
    totalDeductions: Money.sum(payslips.map((p) => p.totalDeductions)),
    totalEmployerContributions: Money.sum(payslips.map((p) => p.employerContributions)),
    totalNet: Money.sum(payslips.map((p) => p.netPay)),
    unpaidLeaveSource: deps.unpaidLeave ? "provider" : "none",
    warnings,
    calculatedAt: now,
  };
  await deps.runs.update(calculated);
  return calculated;
}

/** Cancels a run that has not been approved yet (ملغى). */
export async function cancelPayrollRun(runId: string, deps: Pick<PayrollCalculationDeps, "runs" | "payslips" | "now">): Promise<PayrollRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new PayrollRunNotFoundError(runId);
  if (!canTransitionPayrollRun(run.status, "cancelled")) {
    throw new InvalidPayrollRunTransitionError(run.status, "cancelled");
  }
  await deps.payslips.deleteByRunId(run.id);
  const cancelled: PayrollRun = {
    ...run,
    status: "cancelled",
    employeeCount: 0,
    totalGross: Money.zero(),
    totalDeductions: Money.zero(),
    totalEmployerContributions: Money.zero(),
    totalNet: Money.zero(),
    cancelledAt: deps.now?.() ?? new Date().toISOString(),
  };
  await deps.runs.update(cancelled);
  return cancelled;
}
