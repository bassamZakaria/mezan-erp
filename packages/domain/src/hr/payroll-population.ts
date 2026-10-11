import type { EmployeeRef } from "../hr-shared/employee-ref.js";
import type { Contract, ContractStatus, PayBasis } from "./contract.js";
import { isBaseCurrency } from "../exchange-rates/convert.js";

export interface PayrollWindow {
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface PayrollCapabilities {
  /** Attendance is bound, so hourly and daily contracts can be priced. */
  readonly attendanceBound: boolean;
  readonly runCurrency: string;
  /** A contract in another currency can be converted into the run's. */
  readonly canConvertCurrency: boolean;
}

const TERMINATED: EmployeeRef["status"] & ContractStatus = "terminated";
const MONTHLY: PayBasis = "monthly";

export interface PayrollBindings {
  readonly attendanceBound: boolean;
  readonly exchangeRatesBound: boolean;
}

export function payrollCapabilities(bindings: PayrollBindings, runCurrency: string): PayrollCapabilities {
  return {
    attendanceBound: bindings.attendanceBound,
    runCurrency,
    canConvertCurrency: bindings.exchangeRatesBound && isBaseCurrency(runCurrency),
  };
}

export enum PayrollExclusionReason {
  NotInService = "not_in_service",
  NoContract = "no_contract",
  NeedsAttendance = "needs_attendance",
  CurrencyMismatch = "currency_mismatch",
  NoPaidDays = "no_paid_days",
}

export type PayrollEligibility =
  | { readonly payable: true; readonly contract: Contract; readonly paidStart: string; readonly paidEnd: string; readonly paidDays: number }
  | { readonly payable: false; readonly reason: PayrollExclusionReason; readonly contract: Contract | null };

export type PayrollServiceSpan = Pick<EmployeeRef, "hireDate" | "status" | "terminatedAt">;

const MS_PER_DAY = 86_400_000;

function dayOf(value: string): string {
  return value.slice(0, 10);
}

function later(a: string, b: string): string {
  return a > b ? a : b;
}

function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY) + 1;
}

/** The last day served, for someone who has left; null while still employed. A termination with no date leaves the day unknown. */
function lastServiceDay(employee: PayrollServiceSpan): string | null | undefined {
  if (employee.status !== TERMINATED) return null;
  return employee.terminatedAt ? dayOf(employee.terminatedAt) : undefined;
}

/**
 * Whether the employee served any day of the period. Asked of the PERIOD, not
 * of today: a run for June must pay someone who left in August, and a close of
 * June must count someone who left on the twelfth as owed their final pay.
 */
export function inServiceDuring(employee: PayrollServiceSpan, window: PayrollWindow): boolean {
  if (employee.hireDate > window.periodEnd) return false;
  const last = lastServiceDay(employee);
  if (last === undefined) return false;
  return last === null || last >= window.periodStart;
}

function contractEndDay(contract: Contract): string | null {
  const terminated = contract.status === TERMINATED ? (contract.terminatedAt ? dayOf(contract.terminatedAt) : "") : null;
  if (terminated === null) return contract.endDate;
  return contract.endDate === null ? terminated : earlier(contract.endDate, terminated);
}

/** The contract in force during the period: overlapping it, and not ended before it began. Latest start wins. */
export function contractForPeriod(contracts: readonly Contract[], window: PayrollWindow): Contract | null {
  const candidates = contracts.filter((c) => {
    const end = contractEndDay(c);
    return c.startDate <= window.periodEnd && (end === null || end >= window.periodStart);
  });
  return [...candidates].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0] ?? null;
}

/**
 * Whether a payroll run for the period pays this employee, and for which days.
 * The run builds its payslips from this and the period close counts who is owed
 * a payslip from this, so the two can never disagree about who was due.
 */
export function payrollEligibility(
  employee: PayrollServiceSpan,
  contracts: readonly Contract[],
  window: PayrollWindow,
  capabilities: PayrollCapabilities,
): PayrollEligibility {
  if (!inServiceDuring(employee, window)) return { payable: false, reason: PayrollExclusionReason.NotInService, contract: null };
  const contract = contractForPeriod(contracts, window);
  if (!contract) return { payable: false, reason: PayrollExclusionReason.NoContract, contract: null };
  if (contract.payBasis !== MONTHLY && !capabilities.attendanceBound) return { payable: false, reason: PayrollExclusionReason.NeedsAttendance, contract };
  if (contract.currency !== capabilities.runCurrency && !capabilities.canConvertCurrency) {
    return { payable: false, reason: PayrollExclusionReason.CurrencyMismatch, contract };
  }
  const paidStart = later(later(window.periodStart, contract.startDate), employee.hireDate);
  const ends = [contractEndDay(contract), lastServiceDay(employee)].filter((day): day is string => typeof day === "string");
  const paidEnd = ends.reduce(earlier, window.periodEnd);
  const paidDays = inclusiveDays(paidStart, paidEnd);
  if (paidDays <= 0) return { payable: false, reason: PayrollExclusionReason.NoPaidDays, contract };
  return { payable: true, contract, paidStart, paidEnd, paidDays };
}
