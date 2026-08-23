/**
 * hr/ — thin master-data slice of the HR module (docs/catalog/06 "الأقسام" /
 * "الموظفون"), scoped here to just Department + Employee: what the Data
 * Migration wizard's steps 1-2 need to import. Copied from the in-progress
 * hr/master-data branch (owner of the full HR module) rather than
 * reimplemented, specifically so this reconciles cleanly once that branch
 * lands on main — same file contents, same export names. Full HR (job
 * titles, contracts, holidays, leave requests/accrual, payroll) stays on
 * hr/master-data and is NOT duplicated here.
 */

export type { Department, DepartmentRepository } from "./department.js";
export type { CreateDepartmentCommand } from "./create-department.js";
export { createDepartment, updateDepartment } from "./create-department.js";

export type {
  Employee,
  EmployeeRepository,
  EmployeeStatus,
  WorkerCategory,
  OvertimeEligibility,
  Gender,
  MaritalStatus,
  EmployeeAddress,
  EmergencyContact,
  EmployeeStatusDefinition,
} from "./employee.js";
export {
  EMPLOYEE_STATUS_DEFINITIONS,
  getEmployeeStatusLabel,
  fullNameAr,
  fullNameEn,
  toEmployeeRef,
  createEmployeeDirectory,
  ALLOWED_EMPLOYEE_TRANSITIONS,
  canTransitionEmployee,
} from "./employee.js";

export type { CreateEmployeeCommand, EmployeeEditableFields } from "./create-employee.js";
export { createEmployee, updateEmployee } from "./create-employee.js";

export { transitionEmployee } from "./transition-employee.js";

export {
  DepartmentNotFoundError,
  InvalidDepartmentError,
  EmployeeNotFoundError,
  InvalidEmployeeError,
  InvalidEmployeeTransitionError,
} from "./errors.js";
