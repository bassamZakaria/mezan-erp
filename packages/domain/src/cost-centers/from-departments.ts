import type { Department, DepartmentRepository } from "../hr/department.js";
import type { CostCenter, CostCenterRepository } from "./cost-center.js";
import { DuplicateCostCenterCodeError, InvalidParentCostCenterError } from "./errors.js";

/**
 * إنشاء مراكز تكلفة من الأقسام — "create from departments" (R6.7). An org that
 * already keeps a department list should not retype it as a cost-centre tree:
 * each imported department becomes a `department`-type cost centre linked back
 * to it by `departmentId`, which is what keeps a second import from creating a
 * duplicate and what lets the P&L be read either way round.
 */

/** A department not yet represented by any cost centre. */
export interface ImportableDepartment {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  /** The cost-centre code this department would take. */
  readonly suggestedCode: string;
  /** True when `suggestedCode` is already used by another cost centre. */
  readonly codeInUse: boolean;
}

/** The cost-centre code a department maps to — its own code, prefixed. */
export function costCenterCodeForDepartment(department: Pick<Department, "code">): string {
  return `CC-${department.code.trim().toUpperCase()}`;
}

/**
 * Departments with no cost centre pointing at them. An INACTIVE department is
 * excluded: importing one would create an active cost centre for a part of the
 * org that no longer exists.
 */
export function importableDepartments(
  departments: readonly Department[],
  costCenters: readonly CostCenter[],
): ImportableDepartment[] {
  const linked = new Set(costCenters.map((c) => c.departmentId).filter((id): id is string => id !== null));
  const usedCodes = new Set(costCenters.map((c) => c.code));
  return departments
    .filter((d) => d.active && !linked.has(d.id))
    .map((d) => {
      const suggestedCode = costCenterCodeForDepartment(d);
      return {
        id: d.id,
        code: d.code,
        name: d.name,
        nameAr: d.nameAr,
        suggestedCode,
        codeInUse: usedCodes.has(suggestedCode),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export interface CreateCostCentersFromDepartmentsCommand {
  /** The departments to import. Empty = every importable one. */
  readonly departmentIds?: readonly string[];
  /** Optional parent to nest the new centres under. */
  readonly parentId?: string | null;
  /** Id generator; the caller owns id shape. */
  readonly idFor: (department: Department) => string;
}

export interface CreateCostCentersFromDepartmentsDeps {
  readonly departments: Pick<DepartmentRepository, "list">;
  readonly costCenters: CostCenterRepository;
}

export interface CreateCostCentersFromDepartmentsResult {
  readonly created: readonly CostCenter[];
  /** Departments left alone because a cost centre already names them. */
  readonly skipped: readonly string[];
}

/**
 * Create one cost centre per requested department. A department that already
 * has a cost centre is SKIPPED rather than duplicated — running the import
 * twice must not double the tree — while a code collision with an unrelated
 * cost centre is refused, because silently renaming it would break the code
 * the accountant expects to find.
 */
export async function createCostCentersFromDepartments(
  command: CreateCostCentersFromDepartmentsCommand,
  deps: CreateCostCentersFromDepartmentsDeps,
): Promise<CreateCostCentersFromDepartmentsResult> {
  const [departments, existing] = await Promise.all([deps.departments.list(), deps.costCenters.list()]);

  if (command.parentId != null && !existing.some((c) => c.id === command.parentId)) {
    throw new InvalidParentCostCenterError(`Parent cost center "${command.parentId}" was not found.`);
  }

  const requested = command.departmentIds?.length
    ? departments.filter((d) => command.departmentIds!.includes(d.id))
    : departments.filter((d) => d.active);

  const linked = new Set(existing.map((c) => c.departmentId).filter((id): id is string => id !== null));
  const usedCodes = new Set(existing.map((c) => c.code));

  const created: CostCenter[] = [];
  const skipped: string[] = [];

  for (const department of requested) {
    if (linked.has(department.id)) {
      skipped.push(department.id);
      continue;
    }
    const code = costCenterCodeForDepartment(department);
    if (usedCodes.has(code)) throw new DuplicateCostCenterCodeError(code);

    const costCenter: CostCenter = {
      id: command.idFor(department),
      code,
      nameAr: department.nameAr ?? department.name,
      nameEn: department.nameAr ? department.name : null,
      type: "department",
      departmentId: department.id,
      branchId: null,
      parentId: command.parentId ?? null,
      notes: null,
      status: "active",
    };
    await deps.costCenters.create(costCenter);
    usedCodes.add(code);
    linked.add(department.id);
    created.push(costCenter);
  }

  return { created, skipped };
}
