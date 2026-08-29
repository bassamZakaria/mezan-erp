/**
 * Department — docs/archive/catalog/06-crm-hr.md "الأقسام". Thin master data (no
 * detail page, edit-dialog-only in the reference UX — docs/archive/plan.md pattern
 * mirrored from `packages/domain/src/settings/branch.ts`): a department can
 * nest under a parent, optionally names a manager (an employee id), and sets
 * the overtime-eligibility / standard-work-hours defaults employees inherit
 * unless they override them individually.
 */

export interface Department {
  readonly id: string;
  /** User-supplied unique code, e.g. "SALES" — immutable after create. */
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly parentDepartmentId: string | null;
  /** Employee id of the department manager, if assigned. */
  readonly managerId: string | null;
  /** Overtime eligibility default inherited by employees in this department. */
  readonly overtimeEligible: boolean;
  /** Standard work hours/day default; null inherits the company-wide default (8). */
  readonly standardWorkHours: number | null;
  readonly active: boolean;
  readonly createdAt: string;
}

/** Persistence port for departments. The domain depends on this interface only. */
export interface DepartmentRepository {
  findById(id: string): Promise<Department | null>;
  findByCode(code: string): Promise<Department | null>;
  list(): Promise<Department[]>;
  create(department: Department): Promise<void>;
  update(department: Department): Promise<void>;
}
