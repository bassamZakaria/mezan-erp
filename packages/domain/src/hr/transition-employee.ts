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
export function terminateEmployee(employee: Employee, terminatedAt: string = new Date().toISOString()): Employee {
  if (!canTransitionEmployee(employee.status, "terminated")) {
    throw new InvalidEmployeeTransitionError(employee.status, "terminated");
  }
  return { ...employee, status: "terminated", terminatedAt };
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
  if (employee.status !== "terminated") {
    throw new InvalidEmployeeTransitionError(employee.status, "active");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
    throw new InvalidEmployeeError(["تاريخ إعادة التعيين مطلوب بصيغة YYYY-MM-DD"]);
  }
  const servedUntil = employee.terminatedAt ?? hireDate;
  return {
    ...employee,
    status: "active",
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
