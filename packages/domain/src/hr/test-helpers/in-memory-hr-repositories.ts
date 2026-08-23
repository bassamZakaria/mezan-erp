import type { Department, DepartmentRepository } from "../department.js";
import type { Employee, EmployeeRepository } from "../employee.js";

/**
 * Trivial in-memory repository fakes for domain-layer unit tests — trimmed
 * to just Department/Employee (the two entities the Data Migration wizard's
 * master-data import steps need). Mirrors the same fake shape the
 * hr/master-data branch's full `in-memory-hr-repositories.ts` uses, so this
 * file reconciles cleanly once that branch lands on main.
 */

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
