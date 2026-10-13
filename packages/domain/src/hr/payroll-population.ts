import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import { ContractStatus } from "./contract.js";
import { PayBasis } from "./contract.js";
import type { EmployeeRef } from "../hr-shared/employee-ref.js";
import type { Contract } from "./contract.js";
import { isBaseCurrency } from "../exchange-rates/convert.js";

export interface PayrollWindow {
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface PayrollCapabilities {
  readonly attendanceBound: boolean;
  readonly runCurrency: string;
  readonly canConvertCurrency: boolean;
}

const MONTHLY: PayBasis = PayBasis.Monthly;

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

function lastServiceDay(employee: PayrollServiceSpan): string | null | undefined {
  if (employee.status !== EmployeeRefStatus.Terminated) return null;
  return employee.terminatedAt ? dayOf(employee.terminatedAt) : undefined;
}

export function inServiceDuring(employee: PayrollServiceSpan, window: PayrollWindow): boolean {
  if (employee.hireDate > window.periodEnd) return false;
  const last = lastServiceDay(employee);
  if (last === undefined) return false;
  return last === null || last >= window.periodStart;
}

function contractEndDay(contract: Contract): string | null {
  const terminated = contract.status === ContractStatus.Terminated ? (contract.terminatedAt ? dayOf(contract.terminatedAt) : "") : null;
  if (terminated === null) return contract.endDate;
  return contract.endDate === null ? terminated : earlier(contract.endDate, terminated);
}

export function contractForPeriod(contracts: readonly Contract[], window: PayrollWindow): Contract | null {
  const candidates = contracts.filter((c) => {
    const end = contractEndDay(c);
    return c.startDate <= window.periodEnd && (end === null || end >= window.periodStart);
  });
  return [...candidates].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0] ?? null;
}

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
