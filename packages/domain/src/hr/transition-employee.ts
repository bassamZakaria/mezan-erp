import { InvalidEmployeeTransitionError } from "./errors.js";
import { canTransitionEmployee, type Employee, type EmployeeStatus } from "./employee.js";

/** Transitions an employee to a new status if the state machine allows it. */
export function transitionEmployee(employee: Employee, to: EmployeeStatus): Employee {
  if (!canTransitionEmployee(employee.status, to)) {
    throw new InvalidEmployeeTransitionError(employee.status, to);
  }
  return { ...employee, status: to };
}

/** Terminates an employee's service (docs/catalog/06 "المزيد → إنهاء الخدمة") — the one path into the terminal "terminated" status. */
export function terminateEmployee(employee: Employee, terminatedAt: string = new Date().toISOString()): Employee {
  if (!canTransitionEmployee(employee.status, "terminated")) {
    throw new InvalidEmployeeTransitionError(employee.status, "terminated");
  }
  return { ...employee, status: "terminated", terminatedAt };
}
