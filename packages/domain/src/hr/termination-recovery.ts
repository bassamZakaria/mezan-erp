import { postJournalEntry, reverseJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import { Money, allocateScaled } from "../money/index.js";
import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import { EmployeeAdvanceStatusCode, advanceRecovered, type EmployeeAdvance, type EmployeeAdvanceRepository } from "./advance.js";
import { PayBasis, type Contract, type ContractRepository } from "./contract.js";
import type { Employee, EmployeeRepository } from "./employee.js";
import { EmployeeNotFoundError, EmployeeNotTerminatedError, TerminationRecoveryAlreadyCollectedError } from "./errors.js";
import {
  PAYROLL_RUN_FINAL_STATUSES,
  PayrollRunStatusCode,
  PayslipLineKindCode,
  PayslipLineSourceCode,
  payrollDayDivisor,
  type PayrollDayDivisorBasis,
  type PayrollGlAccounts,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipLine,
  type PayslipLineSource,
  type PayslipRepository,
} from "./payroll-run.js";
import { terminateEmployee, withTerminationDate } from "./transition-employee.js";

const MS_PER_DAY = 86_400_000;
const PIASTRE = 10_000n;
const TIME_BASED_EARNINGS: ReadonlySet<PayslipLineSource> = new Set<PayslipLineSource>([PayslipLineSourceCode.ContractBasic, PayslipLineSourceCode.ContractAllowance]);
const TERMINATION_RECOVERY_DOC_TYPE = "TERMINATION_RECOVERY";
const EMPLOYEE_ADVANCE_DOC_TYPE = "EMPLOYEE_ADVANCE";

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY) + 1;
}

function latest(...days: readonly string[]): string {
  return days.reduce((a, b) => (a > b ? a : b));
}

function piastreShare(amount: bigint, part: number, whole: number): bigint {
  const numerator = amount * BigInt(part);
  const denominator = BigInt(whole) * PIASTRE;
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? (quotient + 1n) * PIASTRE : quotient * PIASTRE;
}

export interface PayslipPaidSpan {
  readonly paidStart: string;
  readonly paidThrough: string;
}

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
  readonly divisor: number;
  readonly lines: readonly { readonly accountId: string | null; readonly amount: Money }[];
  readonly gross: Money;
  readonly incomeTax: Money;
  readonly incomeTaxAccountId: string | null;
}

/**
 * What a payslip paid for days after `lastDay`, priced the way the run priced
 * them: on the tenant's day divisor, where a full month and thirty days of a
 * 31-day month are the same thirty units. Only a monthly contract's basic pay
 * and allowances are time-based; attendance-based pay stopped with attendance.
 * INVARIANT: every figure is a whole number of piastres, split by largest
 * remainder, so the entry it posts balances without a rounding line.
 */
export function payslipOverpaymentAfter(
  payslip: Pick<Payslip, "id" | "periodDays" | "paidDays" | "lines" | "basis">,
  span: PayslipPaidSpan,
  lastDay: string,
  divisorBasis: PayrollDayDivisorBasis,
): PayslipOverpayment | null {
  if (lastDay >= span.paidThrough) return null;
  if (payslip.basis && payslip.basis.payBasis !== PayBasis.Monthly) return null;
  const divisor = payrollDayDivisor(divisorBasis, payslip.periodDays);
  const units = (days: number) => (days >= payslip.periodDays ? divisor : Math.min(days, divisor));
  const servedDays = lastDay < span.paidStart ? 0 : inclusiveDays(span.paidStart, lastDay);
  const paidUnits = units(payslip.paidDays);
  const unworked = paidUnits - units(servedDays);
  if (unworked <= 0) return null;
  const earnings = payslip.lines.filter((line) => line.kind === "earning" && TIME_BASED_EARNINGS.has(line.source) && line.amount.scaled > 0n);
  const gross = piastreShare(earnings.reduce((sum, line) => sum + line.amount.scaled, 0n), unworked, paidUnits);
  if (gross <= 0n) return null;
  const parts = allocateScaled(gross / PIASTRE, earnings.map((line) => line.amount.scaled));
  const lines = earnings.map((line, index) => ({ accountId: line.glAccountId, amount: Money.fromScaled((parts[index] as bigint) * PIASTRE) })).filter((line) => line.amount.scaled > 0n);
  const taxLines = payslip.lines.filter((line) => line.kind === "deduction" && line.source === PayslipLineSourceCode.IncomeTax);
  const incomeTax = piastreShare(taxLines.reduce((sum, line) => sum + line.amount.scaled, 0n), unworked, paidUnits);
  return {
    payslipId: payslip.id,
    days: unworked,
    divisor,
    lines,
    gross: Money.fromScaled(gross),
    incomeTax: Money.fromScaled(incomeTax),
    incomeTaxAccountId: taxLines[0]?.glAccountId ?? null,
  };
}

export interface TerminationPayRecovery {
  readonly id: string;
  readonly advance: EmployeeAdvance | null;
  readonly days: number;
  readonly gross: Money;
  readonly amount: Money;
  readonly payableReduced: Money;
  readonly taxRelief: Money;
  readonly journalEntryId: string;
  readonly paidThrough: string;
}

export interface TerminateEmployeeResult {
  readonly employee: Employee;
  readonly payRecovery: TerminationPayRecovery | null;
}

export interface TerminationPayrollDeps {
  readonly runs: Pick<PayrollRunRepository, "list" | "update">;
  readonly payslips: Pick<PayslipRepository, "listByEmployeeId" | "create">;
  readonly contracts: Pick<ContractRepository, "listByEmployeeId">;
  readonly advances: Pick<EmployeeAdvanceRepository, "create" | "findById" | "update">;
  readonly gl: JournalPostingDeps;
  readonly accounts: PayrollGlAccounts;
  readonly numbering: { next(code: string): Promise<{ readonly formatted: string }> };
  readonly dayDivisorBasis: PayrollDayDivisorBasis;
}

export interface TerminateEmployeeDeps {
  readonly employees: Pick<EmployeeRepository, "findById" | "update">;
  readonly payroll?: TerminationPayrollDeps;
  readonly now?: () => string;
}

export interface TerminateEmployeeCommand {
  readonly effectiveDate: string | null;
  readonly today: string;
}

function recoveryId(employeeId: string, effectiveDate: string, attempt: number): string {
  return `TERM-ADV:${employeeId}:${effectiveDate}${attempt === 0 ? "" : `:${attempt}`}`;
}

function recoveryEntryId(id: string): string {
  return `TERMINATION-RECOVERY-JE:${id}`;
}

function isAdjustment(line: PayslipLine): boolean {
  return line.source === PayslipLineSourceCode.TerminationAdjustment;
}

interface PaidPayslip {
  readonly payslip: Payslip;
  readonly run: PayrollRun;
  readonly span: PayslipPaidSpan;
}

async function paidPayslips(employee: Employee, payroll: TerminationPayrollDeps): Promise<PaidPayslip[]> {
  const runs = new Map((await payroll.runs.list()).filter((run) => PAYROLL_RUN_FINAL_STATUSES.has(run.status)).map((run) => [run.id, run]));
  const contracts = new Map<string, Contract>((await payroll.contracts.listByEmployeeId(employee.id)).map((contract) => [contract.id, contract]));
  const paid: PaidPayslip[] = [];
  for (const payslip of await payroll.payslips.listByEmployeeId(employee.id)) {
    const run = runs.get(payslip.runId);
    if (!run) continue;
    paid.push({ payslip, run, span: payslipPaidSpan(payslip, employee.hireDate, contracts.get(payslip.contractId)?.startDate ?? null) });
  }
  return paid;
}

function paidThroughOf(paid: readonly PaidPayslip[]): string | null {
  return paid.reduce<string | null>((max, { span }) => (max === null || span.paidThrough > max ? span.paidThrough : max), null);
}

async function bookPayRecovery(employee: Employee, effectiveDate: string, today: string, paid: readonly PaidPayslip[], payroll: TerminationPayrollDeps, stamp: string): Promise<TerminationPayRecovery | null> {
  const paidThrough = paidThroughOf(paid);
  if (paidThrough === null) return null;
  const { accounts } = payroll;
  const debits = new Map<string, bigint>();
  const credits = new Map<string, bigint>();
  const add = (side: Map<string, bigint>, accountId: string, amount: bigint) => side.set(accountId, (side.get(accountId) ?? 0n) + amount);
  let days = 0;
  let divisor = 0;
  let gross = 0n;
  let receivable = 0n;
  let payableReduced = 0n;
  let taxRelief = 0n;
  const adjusted: { payslip: Payslip; run: PayrollRun; amount: bigint; standing: PayslipLine | null }[] = [];

  let attempt = 0;
  while (await payroll.gl.ledger.findById(recoveryEntryId(recoveryId(employee.id, effectiveDate, attempt)))) attempt += 1;
  const id = recoveryId(employee.id, effectiveDate, attempt);

  for (const { payslip, run, span } of paid) {
    const overpayment = payslipOverpaymentAfter(payslip, span, effectiveDate, payroll.dayDivisorBasis);
    if (!overpayment) continue;
    days += overpayment.days;
    divisor = overpayment.divisor;
    gross += overpayment.gross.scaled;
    for (const line of overpayment.lines) add(credits, line.accountId ?? accounts.salaryExpenseAccountId, line.amount.scaled);
    if (overpayment.incomeTax.scaled > 0n) {
      taxRelief += overpayment.incomeTax.scaled;
      add(debits, overpayment.incomeTaxAccountId ?? accounts.salaryTaxPayableAccountId, overpayment.incomeTax.scaled);
    }
    const owedBack = overpayment.gross.scaled - overpayment.incomeTax.scaled;
    const standing = payslip.lines.find(isAdjustment) ?? null;
    const unpaid = run.status === PayrollRunStatusCode.Approved ? payslip.netPay.scaled : (standing?.amount.scaled ?? 0n);
    const fromPayable = owedBack < unpaid ? owedBack : unpaid < 0n ? 0n : unpaid;
    if (fromPayable > 0n) {
      payableReduced += fromPayable;
      add(debits, accounts.salariesPayableAccountId, fromPayable);
      adjusted.push({ payslip, run, amount: fromPayable, standing });
    }
    receivable += owedBack - fromPayable;
  }
  if (gross === 0n) return null;
  if (receivable > 0n) add(debits, accounts.employeeAdvanceAccountId, receivable);

  const number = receivable > 0n ? (await payroll.numbering.next("EMPLOYEE_ADVANCE")).formatted : null;
  const branchId = employee.branchId ?? null;
  const ordered = [accounts.salariesPayableAccountId, accounts.employeeAdvanceAccountId];
  const debitLines = [...debits].sort(([a], [b]) => (ordered.indexOf(a) + 1 || 9) - (ordered.indexOf(b) + 1 || 9));
  const lines: JournalLineInput[] = [
    ...debitLines.map(([accountId, scaled]) => ({ accountId, debit: Money.fromScaled(scaled), credit: Money.zero(), branchId })),
    ...[...credits].map(([accountId, scaled]) => ({ accountId, debit: Money.zero(), credit: Money.fromScaled(scaled), branchId })),
  ];
  const reason = `أجر ${days} يوماً على أساس شهر ${divisor} يوماً مدفوعة بعد آخر يوم عمل ${effectiveDate} (حتى ${paidThrough})`;
  const entry = await postJournalEntry(
    {
      id: recoveryEntryId(id),
      date: today,
      memo: number ? `${reason} — ${number}` : reason,
      source: "system",
      sourceDocType: number ? EMPLOYEE_ADVANCE_DOC_TYPE : TERMINATION_RECOVERY_DOC_TYPE,
      sourceDocId: number ? id : employee.id,
      sourceDocNumber: number,
      lines,
    },
    payroll.gl,
  );

  for (const { payslip, run, amount, standing } of adjusted) {
    if (standing) {
      await payroll.payslips.create({ ...payslip, lines: payslip.lines.map((line) => (line === standing ? { ...line, referenceId: id } : line)) });
      continue;
    }
    const line: PayslipLine = {
      id: `${payslip.id}:TERMINATION:${id}`,
      kind: PayslipLineKindCode.TerminationAdjustment,
      source: PayslipLineSourceCode.TerminationAdjustment,
      nameAr: `تسوية إنهاء الخدمة — أجر أيام بعد ${effectiveDate}`,
      amount: Money.fromScaled(amount),
      glAccountId: accounts.salariesPayableAccountId,
      referenceId: id,
      capped: false,
    };
    await payroll.payslips.create({
      ...payslip,
      lines: [...payslip.lines, line],
      netPay: Money.fromScaled(payslip.netPay.scaled - amount),
    });
    await payroll.runs.update({ ...run, totalNet: Money.fromScaled(run.totalNet.scaled - amount) });
  }

  let advance: EmployeeAdvance | null = null;
  if (number) {
    const amount = Money.fromScaled(receivable);
    advance = {
      id,
      number,
      employeeId: employee.id,
      amount,
      currency: paid[paid.length - 1]?.payslip.currency ?? "EGP",
      installmentCount: 1,
      firstDeductionDate: effectiveDate,
      reason,
      installments: [{ seq: 1, dueDate: effectiveDate, amount, recovered: Money.zero() }],
      status: EmployeeAdvanceStatusCode.Disbursed,
      requestedAt: stamp,
      decidedAt: stamp,
      decidedBy: null,
      disbursedAt: stamp,
      disbursementVoucherId: null,
      disbursementJournalEntryId: entry.id,
      repaidAt: null,
      createdAt: stamp,
    };
    await payroll.advances.create(advance);
  }
  return {
    id,
    advance,
    days,
    gross: Money.fromScaled(gross),
    amount: Money.fromScaled(receivable),
    payableReduced: Money.fromScaled(payableReduced),
    taxRelief: Money.fromScaled(taxRelief),
    journalEntryId: entry.id,
    paidThrough,
  };
}

function atomically<T>(deps: TerminateEmployeeDeps, fn: () => Promise<T>): Promise<T> {
  return deps.payroll ? deps.payroll.gl.ledger.transaction(fn) : fn();
}

export async function terminateEmployeeService(employeeId: string, command: TerminateEmployeeCommand, deps: TerminateEmployeeDeps): Promise<TerminateEmployeeResult> {
  const current = await deps.employees.findById(employeeId);
  if (!current) throw new EmployeeNotFoundError(employeeId);
  const paid = deps.payroll ? await paidPayslips(current, deps.payroll) : [];
  const paidThrough = paidThroughOf(paid);
  const latestAllowed = paidThrough !== null && paidThrough > command.today ? paidThrough : command.today;
  const effectiveDate = command.effectiveDate ?? command.today;
  const terminated = terminateEmployee(current, effectiveDate, latestAllowed);
  const stamp = deps.now?.() ?? new Date().toISOString();

  return atomically(deps, async () => {
    const payRecovery = deps.payroll ? await bookPayRecovery(current, effectiveDate, command.today, paid, deps.payroll, stamp) : null;
    await deps.employees.update(terminated);
    return { employee: terminated, payRecovery };
  });
}

async function undoPayRecovery(employee: Employee, today: string, payroll: TerminationPayrollDeps): Promise<void> {
  const terminatedAt = employee.terminatedAt as string;
  let attempt = 0;
  let current: string | null = null;
  for (;;) {
    const id = recoveryId(employee.id, terminatedAt, attempt);
    const entry = await payroll.gl.ledger.findById(recoveryEntryId(id));
    if (!entry) break;
    if (!entry.reversedByEntryId) current = id;
    attempt += 1;
  }
  if (current === null) return;
  await undoTerminationRecovery(current, employee.id, today, payroll, `عكس تسوية أجر إنهاء الخدمة لتصحيح تاريخ آخر يوم عمل (${terminatedAt})`);
}

export type TerminationRecoveryUndoDeps = Pick<TerminationPayrollDeps, "runs" | "gl"> & {
  readonly payslips: Pick<PayslipRepository, "listByEmployeeId" | "create">;
  readonly advances: Pick<EmployeeAdvanceRepository, "findById" | "update">;
};

export function isTerminationRecoveryEntry(entryId: string | null): boolean {
  return entryId !== null && entryId.startsWith("TERMINATION-RECOVERY-JE:");
}

export async function undoTerminationRecovery(id: string, employeeId: string, today: string, payroll: TerminationRecoveryUndoDeps, memo: string): Promise<void> {
  const advance = await payroll.advances.findById(id);
  if (advance) {
    if (advanceRecovered(advance).scaled > 0n) throw new TerminationRecoveryAlreadyCollectedError(employeeId, advance.number);
    await payroll.advances.update({ ...advance, status: EmployeeAdvanceStatusCode.Cancelled });
  }
  await reverseJournalEntry(recoveryEntryId(id), payroll.gl, {
    reversalId: `${recoveryEntryId(id)}:REVERSED`,
    date: today,
    memo,
  });
  const runs = new Map((await payroll.runs.list()).map((run) => [run.id, run]));
  for (const payslip of await payroll.payslips.listByEmployeeId(employeeId)) {
    const line = payslip.lines.find((candidate) => isAdjustment(candidate) && candidate.referenceId === id);
    const run = runs.get(payslip.runId);
    if (!line || !run || run.status !== PayrollRunStatusCode.Approved) continue;
    await payroll.payslips.create({
      ...payslip,
      lines: payslip.lines.filter((candidate) => candidate !== line),
      netPay: Money.fromScaled(payslip.netPay.scaled + line.amount.scaled),
    });
    const updated = { ...run, totalNet: Money.fromScaled(run.totalNet.scaled + line.amount.scaled) };
    runs.set(run.id, updated);
    await payroll.runs.update(updated);
  }
}

export async function correctTerminationDate(employeeId: string, command: { readonly effectiveDate: string; readonly today: string }, deps: TerminateEmployeeDeps): Promise<TerminateEmployeeResult> {
  const current = await deps.employees.findById(employeeId);
  if (!current) throw new EmployeeNotFoundError(employeeId);
  if (current.status !== EmployeeRefStatus.Terminated || !current.terminatedAt) throw new EmployeeNotTerminatedError(employeeId);
  const before = deps.payroll ? await paidPayslips(current, deps.payroll) : [];
  const paidThrough = paidThroughOf(before);
  const latestAllowed = paidThrough !== null && paidThrough > command.today ? paidThrough : command.today;
  const corrected = withTerminationDate(current, command.effectiveDate, latestAllowed);
  const stamp = deps.now?.() ?? new Date().toISOString();

  return atomically(deps, async () => {
    let payRecovery: TerminationPayRecovery | null = null;
    if (deps.payroll) {
      await undoPayRecovery(current, command.today, deps.payroll);
      payRecovery = await bookPayRecovery(current, command.effectiveDate, command.today, await paidPayslips(current, deps.payroll), deps.payroll, stamp);
    }
    await deps.employees.update(corrected);
    return { employee: corrected, payRecovery };
  });
}
