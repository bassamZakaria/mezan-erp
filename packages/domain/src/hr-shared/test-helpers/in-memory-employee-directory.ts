import type { EmployeeDirectory, EmployeeRef } from "../employee-ref.js";

/** A lightweight fake `EmployeeDirectory` for hr-time-leave's own tests — avoids pulling in the full `hr/employee.ts` entity + repository just to satisfy this narrow read-only port. */
export function createInMemoryEmployeeDirectory(seed: readonly EmployeeRef[] = []): EmployeeDirectory {
  const byId = new Map(seed.map((e) => [e.id, e]));

  return {
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async list() {
      return [...byId.values()];
    },
    async listActive() {
      return [...byId.values()].filter((e) => e.status === "active");
    },
  };
}

/** Builds a minimal, valid `EmployeeRef` fixture with sensible defaults, overriding only what a test cares about. */
export function employeeRefFixture(overrides: Partial<EmployeeRef> & { id: string }): EmployeeRef {
  return {
    code: overrides.id,
    fullNameAr: overrides.id,
    fullNameEn: overrides.id,
    departmentId: null,
    jobTitleId: null,
    branchId: "branch-1",
    managerId: null,
    hireDate: "2025-01-01",
    status: "active",
    workerCategory: "staff",
    overtimeEligibility: "inherit_department",
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false,
    ...overrides,
  };
}
