/**
 * Cost centers — core entity (docs/archive/catalog/04-accounting-treasury.md "مراكز
 * التكلفة"). A `CostCenter` is an optional dimensional tag used to track
 * profit/expenses per department, project, or branch — independent of, or
 * linked 1:1 to, the org's department/branch structure, and nestable under a
 * parent cost center for report roll-ups (the catalog's "أرباح مراكز
 * التكلفة" cost-center P&L report groups by this hierarchy).
 */

export type CostCenterType = "general" | "department" | "project" | "branch";
export type CostCenterStatus = "active" | "inactive";

export interface CostCenterTypeDefinition {
  readonly code: CostCenterType;
  readonly labelAr: string;
}

export const COST_CENTER_TYPE_DEFINITIONS: readonly CostCenterTypeDefinition[] = [
  { code: "general", labelAr: "عام" },
  { code: "department", labelAr: "قسم" },
  { code: "project", labelAr: "مشروع" },
  { code: "branch", labelAr: "فرع" },
] as const;

export function getCostCenterTypeLabel(type: CostCenterType): string {
  return COST_CENTER_TYPE_DEFINITIONS.find((d) => d.code === type)?.labelAr ?? type;
}

export interface CostCenter {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly type: CostCenterType;
  /** Optional 1:1 link to an HR department. Null = unlinked ("بدون ربط"). */
  readonly departmentId: string | null;
  /** Optional 1:1 link to a branch. Null = unlinked ("بدون ربط"). */
  readonly branchId: string | null;
  /** Optional parent cost center, for grouping under a higher-level center in reports. Null = root. */
  readonly parentId: string | null;
  readonly notes: string | null;
  readonly status: CostCenterStatus;
}

/** True when a cost center is tied to a department and/or a branch ("مرتبط" vs "مستقل" in the catalog's summary cards). */
export function isLinked(costCenter: Pick<CostCenter, "departmentId" | "branchId">): boolean {
  return costCenter.departmentId !== null || costCenter.branchId !== null;
}

/** Persistence port for cost centers. The domain depends on this interface only — no SQL, no driver. */
export interface CostCenterRepository {
  findById(id: string): Promise<CostCenter | null>;
  findByCode(code: string): Promise<CostCenter | null>;
  list(): Promise<CostCenter[]>;
  create(costCenter: CostCenter): Promise<void>;
  update(costCenter: CostCenter): Promise<void>;
}
