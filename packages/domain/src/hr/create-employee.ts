import { InvalidEmployeeError } from "./errors.js";
import type {
  EmergencyContact,
  Employee,
  EmployeeAddress,
  EmployeeRepository,
  Gender,
  MaritalStatus,
  OvertimeEligibility,
  WorkerCategory,
} from "./employee.js";

export interface CreateEmployeeCommand {
  readonly id: string;
  /** EMP-#### — assigned by the caller via the numbering engine before invoking this command. */
  readonly code: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly firstNameAr?: string | null;
  readonly lastNameAr?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly birthDate?: string | null;
  readonly nationalId?: string | null;
  readonly gender?: Gender | null;
  readonly maritalStatus?: MaritalStatus | null;
  readonly departmentId?: string | null;
  readonly jobTitleId?: string | null;
  readonly managerId?: string | null;
  readonly branchId: string;
  readonly hireDate: string;
  readonly workerCategory?: WorkerCategory;
  readonly employmentType?: "full_time" | "part_time";
  readonly overtimeEligibility?: OvertimeEligibility;
  readonly standardWorkHours?: number | null;
  readonly probationEndDate?: string | null;
  readonly priorServiceYears?: number;
  readonly requireSelfieAtClockIn?: boolean;
  readonly requireBiometricAtClockIn?: boolean;
  readonly deviceBadgeId?: string | null;
  readonly hasPensionEntitlement?: boolean | null;
  readonly taxDisabilityExemption?: boolean;
  readonly address?: EmployeeAddress | null;
  readonly emergencyContact?: EmergencyContact | null;
}

function validate(command: Pick<CreateEmployeeCommand, "firstName" | "lastName" | "branchId" | "hireDate" | "priorServiceYears">): string[] {
  const reasons: string[] = [];
  if (command.firstName.trim().length === 0) reasons.push("الاسم الأول مطلوب");
  if (command.lastName.trim().length === 0) reasons.push("اسم العائلة مطلوب");
  if (command.branchId.trim().length === 0) reasons.push("الفرع مطلوب");
  if (command.hireDate.trim().length === 0) reasons.push("تاريخ التعيين مطلوب");
  if (command.priorServiceYears !== undefined && command.priorServiceYears < 0) {
    reasons.push("سنوات الخدمة السابقة لا يمكن أن تكون سالبة");
  }
  return reasons;
}

/** Creates and persists a new employee. New employees always start "active". */
export async function createEmployee(command: CreateEmployeeCommand, repo: EmployeeRepository): Promise<Employee> {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidEmployeeError(reasons);

  const employee: Employee = {
    id: command.id,
    code: command.code,
    firstName: command.firstName,
    lastName: command.lastName,
    firstNameAr: command.firstNameAr ?? null,
    lastNameAr: command.lastNameAr ?? null,
    email: command.email ?? null,
    phone: command.phone ?? null,
    birthDate: command.birthDate ?? null,
    nationalId: command.nationalId ?? null,
    gender: command.gender ?? null,
    maritalStatus: command.maritalStatus ?? null,
    departmentId: command.departmentId ?? null,
    jobTitleId: command.jobTitleId ?? null,
    managerId: command.managerId ?? null,
    branchId: command.branchId,
    hireDate: command.hireDate,
    workerCategory: command.workerCategory ?? "staff",
    employmentType: command.employmentType ?? "full_time",
    overtimeEligibility: command.overtimeEligibility ?? "inherit_department",
    standardWorkHours: command.standardWorkHours ?? null,
    probationEndDate: command.probationEndDate ?? null,
    priorServiceYears: command.priorServiceYears ?? 0,
    requireSelfieAtClockIn: command.requireSelfieAtClockIn ?? false,
    requireBiometricAtClockIn: command.requireBiometricAtClockIn ?? false,
    deviceBadgeId: command.deviceBadgeId ?? null,
    hasPensionEntitlement: command.hasPensionEntitlement ?? null,
    taxDisabilityExemption: command.taxDisabilityExemption ?? false,
    address: command.address ?? null,
    emergencyContact: command.emergencyContact ?? null,
    status: "active",
    terminatedAt: null,
    createdAt: new Date().toISOString(),
  };

  await repo.create(employee);
  return employee;
}

/** Editable employee fields (excludes id/code/status/createdAt/terminatedAt, which have their own commands). */
export type EmployeeEditableFields = Omit<Employee, "id" | "code" | "status" | "terminatedAt" | "createdAt">;

/** Applies a patch to an existing employee (the edit form), re-validating. */
export function updateEmployee(current: Employee, patch: Partial<EmployeeEditableFields>): Employee {
  const next: Employee = { ...current, ...patch };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidEmployeeError(reasons);
  return next;
}
