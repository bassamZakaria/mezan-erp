import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import { InvalidEmployeeError, InvalidEmployeeTransitionError } from "./errors.js";
import { canTransitionEmployee, type Employee, type EmployeeStatus } from "./employee.js";

/** Transitions an employee to a new status if the state machine allows it. */
export function transitionEmployee(employee: Employee, to: EmployeeStatus): Employee {
  if (!canTransitionEmployee(employee.status, to)) {
    throw new InvalidEmployeeTransitionError(employee.status, to);
  }
  return { ...employee, status: to };
}

/** Terminates an employee's service (docs/archive/catalog/06 "المزيد → إنهاء الخدمة") — the one path into the terminal "terminated" status. */
export function terminateEmployee(employee: Employee, effectiveDate: string, latestAllowed: string = effectiveDate): Employee {
  if (!canTransitionEmployee(employee.status, EmployeeRefStatus.Terminated)) {
    throw new InvalidEmployeeTransitionError(employee.status, EmployeeRefStatus.Terminated);
  }
  return withTerminationDate(employee, effectiveDate, latestAllowed);
}

export function withTerminationDate(employee: Employee, effectiveDate: string, latestAllowed: string = effectiveDate): Employee {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00.000Z`))) {
    throw new InvalidEmployeeError(["تاريخ إنهاء الخدمة مطلوب بصيغة YYYY-MM-DD"], ["The termination date is required as YYYY-MM-DD"]);
  }
  if (effectiveDate > latestAllowed) {
    throw new InvalidEmployeeError([`تاريخ إنهاء الخدمة لا يمكن أن يكون بعد ${latestAllowed}`], [`The termination date cannot be after ${latestAllowed}`]);
  }
  if (effectiveDate < employee.hireDate) {
    throw new InvalidEmployeeError(["تاريخ إنهاء الخدمة لا يمكن أن يسبق تاريخ التعيين"], ["The termination date cannot be before the hire date"]);
  }
  return { ...employee, status: EmployeeRefStatus.Terminated, terminatedAt: effectiveDate };
}

/**
 * Re-hires a terminated employee onto the SAME record (R10.2 إعادة تعيين).
 *
 * The one way out of "terminated", and deliberately not a plain transition:
 * a re-hire needs a new hire date, and the years already served must survive
 * it — they feed Article 47 seniority — so the previous spell is folded into
 * `priorServiceYears` rather than discarded with the old hire date. Everything
 * the old spell produced (payslips, leave, advances) still points at this id.
 */
export function rehireEmployee(employee: Employee, hireDate: string): Employee {
  if (employee.status !== EmployeeRefStatus.Terminated) {
    throw new InvalidEmployeeTransitionError(employee.status, EmployeeRefStatus.Active);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
    throw new InvalidEmployeeError(["تاريخ إعادة التعيين مطلوب بصيغة YYYY-MM-DD"]);
  }
  const servedUntil = employee.terminatedAt ?? hireDate;
  return {
    ...employee,
    status: EmployeeRefStatus.Active,
    hireDate,
    priorServiceYears: employee.priorServiceYears + completedYearsBetween(employee.hireDate, servedUntil.slice(0, 10)),
    terminatedAt: null,
  };
}

/** Whole years between two "YYYY-MM-DD" dates, never negative. */
function completedYearsBetween(from: string, to: string): number {
  if (to <= from) return 0;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.floor((end - start) / (365.25 * 24 * 60 * 60 * 1000));
}
