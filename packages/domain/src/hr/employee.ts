import type {
  EmployeeDirectory,
  EmployeeOvertimeEligibility,
  EmployeeRef,
  EmployeeRefStatus,
  EmployeeWorkerCategory,
} from "../hr-shared/employee-ref.js";

/**
 * Employee — docs/archive/catalog/06-crm-hr.md "الموظفون", the HR hub record every
 * other HR/attendance/payroll screen scopes against. Field set matches the
 * catalog's create-form sections (personal info / employment info / address /
 * emergency contact) plus the two Egyptian-labor-law-flagged fields called
 * out by name: `standardWorkHours`/`overtimeEligibility` (dept -> company
 * inheritance chain) and `priorServiceYears` (Article 47 seniority bonus).
 *
 * `EmployeeStatus`/`WorkerCategory`/`OvertimeEligibility` re-export the
 * `hr-shared/employee-ref.js` unions verbatim — this file is the single
 * source of truth for their values, `hr-shared` just names the type so
 * sibling domains (attendance/leave/payroll) don't need to import here.
 */

export type EmployeeStatus = EmployeeRefStatus;
export type WorkerCategory = EmployeeWorkerCategory;
export type OvertimeEligibility = EmployeeOvertimeEligibility;
export type Gender = "male" | "female";
export type MaritalStatus = "single" | "married" | "divorced" | "widowed";

export interface EmployeeStatusDefinition {
  readonly code: EmployeeStatus;
  readonly labelAr: string;
}

export const EMPLOYEE_STATUS_DEFINITIONS: readonly EmployeeStatusDefinition[] = [
  { code: "active", labelAr: "نشط" },
  { code: "on_leave", labelAr: "في إجازة" },
  { code: "suspended", labelAr: "موقوف" },
  { code: "terminated", labelAr: "منتهية خدمته" },
] as const;

export function getEmployeeStatusLabel(status: EmployeeStatus): string {
  return EMPLOYEE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export interface EmployeeAddress {
  readonly street: string | null;
  readonly city: string | null;
  readonly governorate: string | null;
  readonly postalCode: string | null;
}

export interface EmergencyContact {
  readonly name: string | null;
  readonly relationship: string | null;
  readonly phone: string | null;
  readonly altPhone: string | null;
}

export interface Employee {
  readonly id: string;
  /** EMP-#### numbering-engine code. */
  readonly code: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly firstNameAr: string | null;
  readonly lastNameAr: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly birthDate: string | null;
  readonly nationalId: string | null;
  readonly gender: Gender | null;
  readonly maritalStatus: MaritalStatus | null;
  readonly departmentId: string | null;
  readonly jobTitleId: string | null;
  readonly managerId: string | null;
  readonly branchId: string;
  readonly hireDate: string;
  readonly workerCategory: WorkerCategory;
  readonly employmentType: "full_time" | "part_time";
  readonly overtimeEligibility: OvertimeEligibility;
  readonly standardWorkHours: number | null;
  readonly probationEndDate: string | null;
  /** Fed into the Egyptian Labor Law Article 47 seniority-bonus calc (payroll). */
  readonly priorServiceYears: number;
  readonly requireSelfieAtClockIn: boolean;
  readonly requireBiometricAtClockIn: boolean;
  /**
   * The badge/employee-code stamped on a fingerprint/RFID attendance device
   * export (ZKTeco-style CSV). Distinct from `code` (the EMP-#### numbering
   * code): the device only ever knows this value, so the attendance-device
   * import matches punches against it, never against `code`. Null until set.
   */
  readonly deviceBadgeId: string | null;
  /**
   * Whether the employee holds a pension entitlement covering their service.
   * End-of-service gratuity is payable only when this is false; null means the
   * question was never answered, and no gratuity is computed until it is.
   */
  readonly hasPensionEntitlement: boolean | null;
  /** Qualifies for the raised personal exemption a person with a disability gets on salary tax. */
  readonly taxDisabilityExemption: boolean;
  readonly address: EmployeeAddress | null;
  readonly emergencyContact: EmergencyContact | null;
  readonly status: EmployeeStatus;
  readonly terminatedAt: string | null;
  readonly createdAt: string;
}

/** Persistence port for employees. The domain depends on this interface only — no SQL, no driver. */
export interface EmployeeRepository {
  findById(id: string): Promise<Employee | null>;
  list(): Promise<Employee[]>;
  create(employee: Employee): Promise<void>;
  update(employee: Employee): Promise<void>;
}

export function fullNameAr(employee: Pick<Employee, "firstNameAr" | "lastNameAr" | "firstName" | "lastName">): string {
  const ar = [employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ").trim();
  return ar.length > 0 ? ar : `${employee.firstName} ${employee.lastName}`.trim();
}

export function fullNameEn(employee: Pick<Employee, "firstName" | "lastName">): string {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

/** Projects the full `Employee` onto the stable `hr-shared/employee-ref.js` seam other domains depend on. */
export function toEmployeeRef(employee: Employee): EmployeeRef {
  return {
    id: employee.id,
    code: employee.code,
    fullNameAr: fullNameAr(employee),
    fullNameEn: fullNameEn(employee),
    departmentId: employee.departmentId,
    jobTitleId: employee.jobTitleId,
    branchId: employee.branchId,
    managerId: employee.managerId,
    hireDate: employee.hireDate,
    status: employee.status,
    workerCategory: employee.workerCategory,
    overtimeEligibility: employee.overtimeEligibility,
    standardWorkHours: employee.standardWorkHours,
    probationEndDate: employee.probationEndDate,
    priorServiceYears: employee.priorServiceYears,
    requireSelfieAtClockIn: employee.requireSelfieAtClockIn,
    requireBiometricAtClockIn: employee.requireBiometricAtClockIn,
    taxDisabilityExemption: employee.taxDisabilityExemption,
  };
}

/**
 * The employee status state machine (docs/archive/catalog/06 "الموظفون" summary-strip
 * categories: نشط / في إجازة / موقوف / منتهية خدمته). "terminated" is
 * terminal — reached only via the dedicated `terminateEmployee` command
 * (docs/catalog "المزيد → إنهاء الخدمة"), never a plain status edit.
 */
export const ALLOWED_EMPLOYEE_TRANSITIONS: Record<EmployeeStatus, readonly EmployeeStatus[]> = {
  active: ["on_leave", "suspended", "terminated"],
  on_leave: ["active", "suspended", "terminated"],
  suspended: ["active", "terminated"],
  terminated: [],
};

export function canTransitionEmployee(from: EmployeeStatus, to: EmployeeStatus): boolean {
  return ALLOWED_EMPLOYEE_TRANSITIONS[from].includes(to);
}

/**
 * Adapts a full `EmployeeRepository` into the read-only `EmployeeDirectory`
 * seam (`hr-shared/employee-ref.js`) sibling domains depend on. The backend
 * wiring binds this once over the real SQLite repository and hands the
 * resulting `EmployeeDirectory` to attendance/leave/payroll instead of the
 * full read/write repository.
 */
export function createEmployeeDirectory(repo: Pick<EmployeeRepository, "findById" | "list">): EmployeeDirectory {
  return {
    async findById(id) {
      const employee = await repo.findById(id);
      return employee ? toEmployeeRef(employee) : null;
    },
    async list() {
      return (await repo.list()).map(toEmployeeRef);
    },
    async listActive() {
      return (await repo.list()).filter((e) => e.status !== "terminated").map(toEmployeeRef);
    },
  };
}
