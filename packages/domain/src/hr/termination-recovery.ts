import { postJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import { Money, allocate } from "../money/index.js";
import type { EmployeeAdvance, EmployeeAdvanceRepository } from "./advance.js";
import type { Contract, ContractRepository } from "./contract.js";
import type { Employee, EmployeeRepository } from "./employee.js";
import { EmployeeNotFoundError } from "./errors.js";
import {
  PAYROLL_RUN_FINAL_STATUSES,
  payrollDayDivisor,
  type PayrollDayDivisorBasis,
  type PayrollGlAccounts,
  type PayrollRunRepository,
  type Payslip,
  type PayslipLineSource,
  type PayslipRepository,
} from "./payroll-run.js";
import { terminateEmployee } from "./transition-employee.js";

const MS_PER_DAY = 86_400_000;
const TIME_BASED_EARNINGS: ReadonlySet<PayslipLineSource> = new Set<PayslipLineSource>(["contract_basic", "contract_allowance"]);
const MONTHLY_PAY_BASIS = "monthly";

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY) + 1;
}

function latest(...days: readonly string[]): string {
  return days.reduce((a, b) => (a > b ? a : b));
}

export interface PayslipPaidSpan {
  readonly paidStart: string;
  readonly paidThrough: string;
}

/**
 * The days a payslip paid for. A payslip stores how many days it paid, not
 * which: they start where the payroll population starts them — the later of
 * the period, the hire and the contract start — and run for `paidDays`.
 */
export function payslipPaidSpan(
  payslip: Pick<Payslip, "periodStart" | "periodEnd" | "paidDays">,
  hireDate: string,
  contractStartDate: string | null,
): PayslipPaidSpan {
  const paidStart = latest(payslip.periodStart, hireDate, contractStartDate ?? payslip.periodStart);
  const through = addDays(paidStart, Math.max(payslip.paidDays, 1) - 1);
  return { paidStart, paidThrough: through < payslip.periodEnd ? through : payslip.periodEnd };
}

export interface PayslipOverpayment {
  readonly payslipId: string;
  readonly days: number;
  readonly lines: readonly { readonly accountId: string | null; readonly amount: Money }[];
}

/**
 * What a payslip paid for days after `lastDay`, priced the way the run priced
 * them: on the tenant's day divisor, where a full month and thirty days of a
 * 31-day month are the same thirty units. Only a monthly contract's basic pay
 * and allowances are time-based; attendance-based pay stopped with attendance.
 */
export function payslipOverpaymentAfter(
  payslip: Pick<Payslip, "id" | "periodDays" | "paidDays" | "lines" | "basis">,
  span: PayslipPaidSpan,
  lastDay: string,
  divisorBasis: PayrollDayDivisorBasis,
): PayslipOverpayment | null {
  if (lastDay >= span.paidThrough) return null;
  if (payslip.basis && payslip.basis.payBasis !== MONTHLY_PAY_BASIS) return null;
  const divisor = payrollDayDivisor(divisorBasis, payslip.periodDays);
  const units = (days: number) => (days >= payslip.periodDays ? divisor : Math.min(days, divisor));
  const servedDays = lastDay < span.paidStart ? 0 : inclusiveDays(span.paidStart, lastDay);
  const paidUnits = units(payslip.paidDays);
  const servedUnits = units(servedDays);
  if (paidUnits <= servedUnits) return null;
  const lines = payslip.lines
    .filter((line) => line.kind === "earning" && TIME_BASED_EARNINGS.has(line.source) && line.amount.scaled > 0n)
    .map((line) => ({ accountId: line.glAccountId, amount: allocate(line.amount, [paidUnits - servedUnits, servedUnits])[0] as Money }))
    .filter((line) => line.amount.scaled > 0n);
  if (lines.length === 0) return null;
  return { payslipId: payslip.id, days: payslip.paidDays - servedDays, lines };
}

export interface TerminationPayRecovery {
  readonly advance: EmployeeAdvance;
  readonly days: number;
  readonly amount: Money;
  readonly journalEntryId: string;
  readonly paidThrough: string;
}

export interface TerminateEmployeeResult {
  readonly employee: Employee;
  readonly payRecovery: TerminationPayRecovery | null;
}

export interface TerminateEmployeeDeps {
  readonly employees: Pick<EmployeeRepository, "findById" | "update">;
  /** Absent = no payroll is bound, so nothing was paid and nothing can be owed back. */
  readonly payroll?: {
    readonly runs: Pick<PayrollRunRepository, "list">;
    readonly payslips: Pick<PayslipRepository, "listByEmployeeId">;
    readonly contracts: Pick<ContractRepository, "listByEmployeeId">;
    readonly advances: Pick<EmployeeAdvanceRepository, "create">;
    readonly gl: JournalPostingDeps;
    readonly accounts: PayrollGlAccounts;
    readonly numbering: { next(code: string): Promise<{ readonly formatted: string }> };
    readonly dayDivisorBasis: PayrollDayDivisorBasis;
  };
  readonly idGen?: () => string;
  readonly now?: () => string;
}

export interface TerminateEmployeeCommand {
  /** Last day of service; today when the caller names none. */
  readonly effectiveDate: string | null;
  readonly today: string;
}

/**
 * Ends an employee's service. The last day may be any day up to the later of
 * today and the last day an approved payroll already paid. When it falls
 * before that paid day, the pay for the days in between is not lost and not
 * silently kept: it posts as an employee advance (Dr سلف الموظفين, Cr the
 * expense the payroll charged), dated today, and the end-of-service statement
 * deducts it like any other advance.
 */
export async function terminateEmployeeService(employeeId: string, command: TerminateEmployeeCommand, deps: TerminateEmployeeDeps): Promise<TerminateEmployeeResult> {
  const current = await deps.employees.findById(employeeId);
  if (!current) throw new EmployeeNotFoundError(employeeId);

  const paid: { payslip: Payslip; span: PayslipPaidSpan }[] = [];
  if (deps.payroll) {
    const finalRuns = new Set((await deps.payroll.runs.list()).filter((run) => PAYROLL_RUN_FINAL_STATUSES.has(run.status)).map((run) => run.id));
    const contracts = new Map<string, Contract>((await deps.payroll.contracts.listByEmployeeId(employeeId)).map((contract) => [contract.id, contract]));
    for (const payslip of await deps.payroll.payslips.listByEmployeeId(employeeId)) {
      if (!finalRuns.has(payslip.runId)) continue;
      paid.push({ payslip, span: payslipPaidSpan(payslip, current.hireDate, contracts.get(payslip.contractId)?.startDate ?? null) });
    }
  }
  const paidThrough = paid.reduce<string | null>((max, { span }) => (max === null || span.paidThrough > max ? span.paidThrough : max), null);
  const latestAllowed = paidThrough !== null && paidThrough > command.today ? paidThrough : command.today;
  const effectiveDate = command.effectiveDate ?? command.today;
  const terminated = terminateEmployee(current, effectiveDate, latestAllowed);

  let payRecovery: TerminationPayRecovery | null = null;
  if (deps.payroll && paidThrough !== null) {
    const overpayments = paid
      .map(({ payslip, span }) => payslipOverpaymentAfter(payslip, span, effectiveDate, deps.payroll!.dayDivisorBasis))
      .filter((overpayment): overpayment is PayslipOverpayment => overpayment !== null);
    const amount = Money.sum(overpayments.flatMap((overpayment) => overpayment.lines.map((line) => line.amount)));
    if (amount.scaled > 0n) {
      const { accounts } = deps.payroll;
      const days = overpayments.reduce((total, overpayment) => total + overpayment.days, 0);
      const stamp = deps.now?.() ?? new Date().toISOString();
      const id = deps.idGen?.() ?? `TERM-ADV:${employeeId}:${effectiveDate}:${stamp}`;
      const number = (await deps.payroll.numbering.next("EMPLOYEE_ADVANCE")).formatted;
      const credits = new Map<string, bigint>();
      for (const line of overpayments.flatMap((overpayment) => overpayment.lines)) {
        const accountId = line.accountId ?? accounts.salaryExpenseAccountId;
        credits.set(accountId, (credits.get(accountId) ?? 0n) + line.amount.scaled);
      }
      const branchId = current.branchId ?? null;
      const lines: JournalLineInput[] = [
        { accountId: accounts.employeeAdvanceAccountId, debit: amount, credit: Money.zero(), branchId },
        ...[...credits].map(([accountId, scaled]) => ({ accountId, debit: Money.zero(), credit: Money.fromScaled(scaled), branchId })),
      ];
      const reason = `أجر ${days} يوم مدفوعة بعد آخر يوم عمل ${effectiveDate} (حتى ${paidThrough})`;
      const entry = await postJournalEntry(
        {
          id: `TERMINATION-RECOVERY-JE:${id}`,
          date: command.today,
          memo: `${reason} — ${number}`,
          source: "system",
          sourceDocType: "EMPLOYEE_ADVANCE",
          sourceDocId: id,
          sourceDocNumber: number,
          lines,
        },
        deps.payroll.gl,
      );
      const advance: EmployeeAdvance = {
        id,
        number,
        employeeId,
        amount,
        currency: overpaymentCurrency(paid),
        installmentCount: 1,
        firstDeductionDate: effectiveDate,
        reason,
        installments: [{ seq: 1, dueDate: effectiveDate, amount, recovered: Money.zero() }],
        status: "disbursed",
        requestedAt: stamp,
        decidedAt: stamp,
        decidedBy: null,
        disbursedAt: stamp,
        disbursementVoucherId: null,
        disbursementJournalEntryId: entry.id,
        repaidAt: null,
        createdAt: stamp,
      };
      await deps.payroll.advances.create(advance);
      payRecovery = { advance, days, amount, journalEntryId: entry.id, paidThrough };
    }
  }

  await deps.employees.update(terminated);
  return { employee: terminated, payRecovery };
}

function overpaymentCurrency(paid: readonly { payslip: Payslip }[]): string {
  return paid[paid.length - 1]?.payslip.currency ?? "EGP";
}
