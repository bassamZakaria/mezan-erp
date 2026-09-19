import { Money, allocate } from "../money/index.js";
import { InvalidEmployeeAdvanceError, InvalidEmployeeAdvanceTransitionError } from "./errors.js";

/**
 * Employee cash advances — docs/archive/catalog/06-crm-hr.md "سلف الموظفين". A cash
 * advance is recovered from future payroll runs in equal instalments.
 *
 * The catalog's own helper text is the accounting contract: "السلفة دين على
 * الموظف (أصل) — لا تحتسب مصروفاً إلا عند الشطب" — the disbursement debits the
 * `1160 سلف الموظفين` ASSET account, never an expense, and payroll recovery
 * credits it back down.
 */

export type EmployeeAdvanceStatus = "pending" | "approved" | "disbursed" | "repaid" | "rejected";

export interface EmployeeAdvanceStatusDefinition {
  readonly code: EmployeeAdvanceStatus;
  readonly labelAr: string;
}

export const EMPLOYEE_ADVANCE_STATUS_DEFINITIONS: readonly EmployeeAdvanceStatusDefinition[] = [
  { code: "pending", labelAr: "في انتظار الاعتماد" },
  { code: "approved", labelAr: "معتمدة" },
  { code: "disbursed", labelAr: "مصروفة" },
  { code: "repaid", labelAr: "مسددة" },
  { code: "rejected", labelAr: "مرفوضة" },
] as const;

export function getEmployeeAdvanceStatusLabel(status: EmployeeAdvanceStatus): string {
  return EMPLOYEE_ADVANCE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/** One scheduled recovery instalment ("الأقساط" in the catalog's list columns). */
export interface AdvanceInstallment {
  /** 1-based ordinal within the advance's schedule. */
  readonly seq: number;
  /** "YYYY-MM-DD" — the payroll period this instalment is first due in. */
  readonly dueDate: string;
  readonly amount: Money;
  /** How much of `amount` payroll has actually recovered so far. */
  readonly recovered: Money;
}

export interface EmployeeAdvance {
  readonly id: string;
  /** ADV-###### numbering-engine number. */
  readonly number: string;
  readonly employeeId: string;
  readonly amount: Money;
  readonly currency: string;
  readonly installmentCount: number;
  readonly firstDeductionDate: string;
  readonly reason: string | null;
  readonly installments: readonly AdvanceInstallment[];
  readonly status: EmployeeAdvanceStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly disbursedAt: string | null;
  /** Treasury voucher that paid the advance out (the cash path is the voucher engine, not a bespoke one). */
  readonly disbursementVoucherId: string | null;
  readonly disbursementJournalEntryId: string | null;
  readonly repaidAt: string | null;
  readonly createdAt: string;
  readonly repayments?: readonly AdvanceRepayment[];
}

export interface AdvanceRepayment {
  readonly id: string;
  readonly date: string;
  readonly amount: Money;
  readonly paymentMethod: string;
  readonly treasuryAccountId: string;
  readonly voucherId: string;
  readonly voucherNo: string | null;
  readonly journalEntryId: string | null;
  readonly note: string | null;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

/** Persistence port for employee advances. The domain depends on this interface only. */
export interface EmployeeAdvanceRepository {
  findById(id: string): Promise<EmployeeAdvance | null>;
  list(): Promise<EmployeeAdvance[]>;
  listByEmployeeId(employeeId: string): Promise<EmployeeAdvance[]>;
  create(advance: EmployeeAdvance): Promise<void>;
  update(advance: EmployeeAdvance): Promise<void>;
}

/** Total recovered across the schedule. */
export function advanceRecovered(advance: EmployeeAdvance): Money {
  return Money.sum(advance.installments.map((i) => i.recovered));
}

/** Amount still owed by the employee (المتبقي). */
export function advanceOutstanding(advance: EmployeeAdvance): Money {
  return Money.fromScaled(advance.amount.scaled - advanceRecovered(advance).scaled);
}

/** Outstanding across every advance that has actually been paid out to the employee. */
export function employeeOutstandingBalance(advances: readonly EmployeeAdvance[]): Money {
  return Money.sum(advances.filter((a) => a.status === "disbursed").map(advanceOutstanding));
}

/**
 * docs/archive/catalog/06 "سلف الموظفين" filter chips: في انتظار الاعتماد → معتمدة →
 * مصروفة → مسددة. "rejected" is the reject half of the approve decision the
 * `hr.advance.approve` permission implies; both it and "repaid" are terminal.
 */
export const ALLOWED_ADVANCE_TRANSITIONS: Record<EmployeeAdvanceStatus, readonly EmployeeAdvanceStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["disbursed"],
  disbursed: ["repaid"],
  repaid: [],
  rejected: [],
};

export function canTransitionAdvance(from: EmployeeAdvanceStatus, to: EmployeeAdvanceStatus): boolean {
  return ALLOWED_ADVANCE_TRANSITIONS[from].includes(to);
}

function assertTransition(advance: EmployeeAdvance, to: EmployeeAdvanceStatus): void {
  if (!canTransitionAdvance(advance.status, to)) {
    throw new InvalidEmployeeAdvanceTransitionError(advance.status, to);
  }
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 30);
}

/** Adds whole months to a "YYYY-MM-DD" date, clamping the day to the target month's length. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Builds the equal-instalment recovery schedule. Split with the domain's
 * largest-remainder allocator so the instalments sum EXACTLY to the advance —
 * an advance must never be over- or under-recovered by a rounding unit.
 */
export function buildInstallmentSchedule(amount: Money, count: number, firstDeductionDate: string): AdvanceInstallment[] {
  const parts = allocate(amount, new Array<number>(count).fill(1));
  return parts.map((part, index) => ({
    seq: index + 1,
    dueDate: addMonths(firstDeductionDate, index),
    amount: part,
    recovered: Money.zero(),
  }));
}

export interface CreateEmployeeAdvanceCommand {
  readonly id: string;
  /** ADV-###### — assigned by the caller via the numbering engine before invoking this command. */
  readonly number: string;
  readonly employeeId: string;
  readonly amount: Money;
  readonly currency?: string;
  readonly installmentCount: number;
  readonly firstDeductionDate: string;
  readonly reason?: string | null;
  readonly now?: () => string;
}

function validate(command: CreateEmployeeAdvanceCommand): string[] {
  const reasons: string[] = [];
  if (command.employeeId.trim().length === 0) reasons.push("الموظف مطلوب");
  if (command.amount.scaled <= 0n) reasons.push("مبلغ السلفة يجب أن يكون أكبر من صفر");
  if (!Number.isInteger(command.installmentCount) || command.installmentCount < 1) {
    reasons.push("عدد الأقساط يجب أن يكون رقماً صحيحاً أكبر من صفر");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(command.firstDeductionDate)) reasons.push("تاريخ أول خصم مطلوب");
  return reasons;
}

/** Creates and persists a new advance request. New requests always start "pending". */
export async function requestEmployeeAdvance(
  command: CreateEmployeeAdvanceCommand,
  repo: EmployeeAdvanceRepository,
): Promise<EmployeeAdvance> {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidEmployeeAdvanceError(reasons);

  const stamp = command.now?.() ?? new Date().toISOString();
  const advance: EmployeeAdvance = {
    id: command.id,
    number: command.number,
    employeeId: command.employeeId,
    amount: command.amount,
    currency: command.currency ?? "EGP",
    installmentCount: command.installmentCount,
    firstDeductionDate: command.firstDeductionDate,
    reason: command.reason ?? null,
    installments: buildInstallmentSchedule(command.amount, command.installmentCount, command.firstDeductionDate),
    status: "pending",
    requestedAt: stamp,
    decidedAt: null,
    decidedBy: null,
    disbursedAt: null,
    disbursementVoucherId: null,
    disbursementJournalEntryId: null,
    repaidAt: null,
    createdAt: stamp,
  };
  await repo.create(advance);
  return advance;
}

/** Approves a pending advance — it may now be disbursed. No GL effect yet. */
export function approveEmployeeAdvance(advance: EmployeeAdvance, decidedBy: string, now: string = new Date().toISOString()): EmployeeAdvance {
  assertTransition(advance, "approved");
  return { ...advance, status: "approved", decidedAt: now, decidedBy };
}

/** Rejects a pending advance. Terminal. */
export function rejectEmployeeAdvance(advance: EmployeeAdvance, decidedBy: string, now: string = new Date().toISOString()): EmployeeAdvance {
  assertTransition(advance, "rejected");
  return { ...advance, status: "rejected", decidedAt: now, decidedBy };
}

/** Records the treasury voucher that paid an approved advance out. */
export function markEmployeeAdvanceDisbursed(
  advance: EmployeeAdvance,
  disbursement: { voucherId: string; journalEntryId: string | null; now?: string },
): EmployeeAdvance {
  assertTransition(advance, "disbursed");
  return {
    ...advance,
    status: "disbursed",
    disbursedAt: disbursement.now ?? new Date().toISOString(),
    disbursementVoucherId: disbursement.voucherId,
    disbursementJournalEntryId: disbursement.journalEntryId,
  };
}

/** Instalments a payroll period must recover: due on/before `periodEnd` and not yet fully recovered. */
export function installmentsDue(advance: EmployeeAdvance, periodEnd: string): AdvanceInstallment[] {
  if (advance.status !== "disbursed") return [];
  return advance.installments.filter((i) => i.dueDate <= periodEnd && i.recovered.scaled < i.amount.scaled);
}

/** Total still due (and unrecovered) on/before `periodEnd`. */
export function amountDueBy(advance: EmployeeAdvance, periodEnd: string): Money {
  return Money.sum(installmentsDue(advance, periodEnd).map((i) => Money.fromScaled(i.amount.scaled - i.recovered.scaled)));
}

/**
 * Applies a payroll recovery against the advance, filling the oldest unpaid
 * instalments first. Flips to "مسددة" (repaid) once nothing is outstanding.
 * Recovering more than the outstanding balance is refused — payroll must never
 * take back more than the employee owes.
 */
export function applyAdvanceRecovery(advance: EmployeeAdvance, amount: Money, now: string = new Date().toISOString()): EmployeeAdvance {
  if (amount.scaled <= 0n) return advance;
  if (advance.status !== "disbursed") {
    throw new InvalidEmployeeAdvanceTransitionError(advance.status, "disbursed");
  }
  if (amount.scaled > advanceOutstanding(advance).scaled) {
    throw new InvalidEmployeeAdvanceError([
      `مبلغ الاسترداد (${amount.toString()}) يتجاوز المتبقي على السلفة (${advanceOutstanding(advance).toString()}).`,
    ]);
  }

  let remaining = amount.scaled;
  const installments = advance.installments.map((installment) => {
    if (remaining <= 0n) return installment;
    const open = installment.amount.scaled - installment.recovered.scaled;
    if (open <= 0n) return installment;
    const take = open < remaining ? open : remaining;
    remaining -= take;
    return { ...installment, recovered: Money.fromScaled(installment.recovered.scaled + take) };
  });

  const next: EmployeeAdvance = { ...advance, installments };
  return advanceOutstanding(next).scaled <= 0n ? { ...next, status: "repaid", repaidAt: now } : next;
}

/** Records a cash/bank repayment outside payroll: fills the oldest open instalments exactly as payroll recovery does. */
export function applyManualAdvanceRepayment(advance: EmployeeAdvance, repayment: AdvanceRepayment): EmployeeAdvance {
  const recovered = applyAdvanceRecovery(advance, repayment.amount, repayment.recordedAt);
  return { ...recovered, repayments: [...(advance.repayments ?? []), repayment] };
}
