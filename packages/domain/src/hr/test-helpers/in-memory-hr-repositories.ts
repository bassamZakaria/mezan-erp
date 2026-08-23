import type { Contract, ContractRepository } from "../contract.js";
import type { Department, DepartmentRepository } from "../department.js";
import type { Employee, EmployeeRepository } from "../employee.js";
import type { Holiday, HolidayRepository } from "../holiday.js";
import type { JobTitle, JobTitleRepository } from "../job-title.js";
import type { LeaveRequest, LeaveRequestRepository } from "../leave-request.js";

/** A trivial in-memory {@link DepartmentRepository} fake for domain-layer unit tests. */
export function createInMemoryDepartmentRepository(): DepartmentRepository {
  const rows = new Map<string, Department>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByCode(code) {
      return [...rows.values()].find((d) => d.code === code) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(department) {
      rows.set(department.id, department);
    },
    async update(department) {
      rows.set(department.id, department);
    },
  };
}

/** A trivial in-memory {@link JobTitleRepository} fake for domain-layer unit tests. */
export function createInMemoryJobTitleRepository(): JobTitleRepository {
  const rows = new Map<string, JobTitle>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listByDepartmentId(departmentId) {
      return [...rows.values()].filter((j) => j.departmentId === departmentId);
    },
    async create(jobTitle) {
      rows.set(jobTitle.id, jobTitle);
    },
    async update(jobTitle) {
      rows.set(jobTitle.id, jobTitle);
    },
  };
}

/** A trivial in-memory {@link EmployeeRepository} fake for domain-layer unit tests. */
export function createInMemoryEmployeeRepository(): EmployeeRepository {
  const rows = new Map<string, Employee>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(employee) {
      rows.set(employee.id, employee);
    },
    async update(employee) {
      rows.set(employee.id, employee);
    },
  };
}

/** A trivial in-memory {@link ContractRepository} fake for domain-layer unit tests. */
export function createInMemoryContractRepository(): ContractRepository {
  const rows = new Map<string, Contract>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listByEmployeeId(employeeId) {
      return [...rows.values()].filter((c) => c.employeeId === employeeId);
    },
    async create(contract) {
      rows.set(contract.id, contract);
    },
    async update(contract) {
      rows.set(contract.id, contract);
    },
  };
}

/** A trivial in-memory {@link HolidayRepository} fake for domain-layer unit tests. */
export function createInMemoryHolidayRepository(): HolidayRepository {
  const rows = new Map<string, Holiday>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(holiday) {
      rows.set(holiday.id, holiday);
    },
    async update(holiday) {
      rows.set(holiday.id, holiday);
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

/** A trivial in-memory {@link LeaveRequestRepository} fake for domain-layer unit tests. */
export function createInMemoryLeaveRequestRepository(): LeaveRequestRepository {
  const rows = new Map<string, LeaveRequest>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listByEmployeeId(employeeId) {
      return [...rows.values()].filter((r) => r.employeeId === employeeId);
    },
    async create(request) {
      rows.set(request.id, request);
    },
    async update(request) {
      rows.set(request.id, request);
    },
  };
}
