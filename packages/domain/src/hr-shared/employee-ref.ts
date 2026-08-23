/**
 * Shared employee-reference contract — the STABLE seam other HR-adjacent
 * domains (attendance, leave/leave-accrual, payroll — built as sibling
 * phases, e.g. `hr/time-leave`) depend on instead of reaching into
 * `hr/employee.ts`'s full internals. Keep this shape backward-compatible:
 * adding optional fields is safe, removing/renaming existing ones is not —
 * sibling worktrees rebase onto this file.
 *
 * `packages/domain/src/hr/employee.ts` (the canonical, full `Employee`
 * entity + its repository) is owned by hr/master-data. This file is
 * intentionally dependency-free (no import of `Employee`) so a consumer can
 * depend on it without pulling in the full HR module's write surface.
 */

export type EmployeeRefStatus = "active" | "on_leave" | "suspended" | "terminated";
export type EmployeeWorkerCategory = "staff" | "worker";
export type EmployeeOvertimeEligibility = "inherit_department" | "eligible" | "not_eligible";

/** The read-only slice of an employee other domains need — no salary/PII beyond what attendance/leave/payroll require. */
export interface EmployeeRef {
  readonly id: string;
  /** EMP-#### numbering-engine code. */
  readonly code: string;
  readonly fullNameAr: string;
  readonly fullNameEn: string;
  readonly departmentId: string | null;
  readonly jobTitleId: string | null;
  readonly branchId: string;
  readonly managerId: string | null;
  readonly hireDate: string;
  readonly status: EmployeeRefStatus;
  readonly workerCategory: EmployeeWorkerCategory;
  /** Overtime eligibility, already resolved of the "inherit department" indirection is NOT done here — callers needing the resolved boolean combine this with the department's `overtimeEligible` default. */
  readonly overtimeEligibility: EmployeeOvertimeEligibility;
  /** Standard work hours/day; null inherits department -> company default. */
  readonly standardWorkHours: number | null;
  readonly probationEndDate: string | null;
  /** Prior-service years fed into the Egyptian Labor Law Article 47 seniority-bonus calc (payroll). */
  readonly priorServiceYears: number;
  readonly requireSelfieAtClockIn: boolean;
  readonly requireBiometricAtClockIn: boolean;
}

/** Read-only directory port — attendance/leave/payroll query employees through this, never the full `EmployeeRepository`. */
export interface EmployeeDirectory {
  findById(id: string): Promise<EmployeeRef | null>;
  list(): Promise<EmployeeRef[]>;
  listActive(): Promise<EmployeeRef[]>;
}
