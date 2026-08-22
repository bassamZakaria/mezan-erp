import type { CostCenter, CostCenterRepository, CostCenterType } from "./cost-center.js";
import { DuplicateCostCenterCodeError, InvalidParentCostCenterError } from "./errors.js";

export interface CreateCostCenterCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly type?: CostCenterType;
  readonly departmentId?: string | null;
  readonly branchId?: string | null;
  readonly parentId?: string | null;
  readonly notes?: string | null;
}

/**
 * Validates a new-cost-center command against the existing list
 * (docs/catalog/04 "مراكز التكلفة"): the code must be unique, and a parent —
 * when given — must exist. Unlike Chart of Accounts, cost centers have no
 * header/detail distinction, so any existing cost center may be a parent.
 */
export function validateNewCostCenter(command: CreateCostCenterCommand, existing: readonly CostCenter[]): void {
  if (existing.some((c) => c.code === command.code)) {
    throw new DuplicateCostCenterCodeError(command.code);
  }
  if (command.parentId != null && !existing.some((c) => c.id === command.parentId)) {
    throw new InvalidParentCostCenterError(`Parent cost center "${command.parentId}" was not found.`);
  }
}

/** Creates and persists a new cost center. New cost centers always start `active`. */
export async function createCostCenter(command: CreateCostCenterCommand, repo: CostCenterRepository): Promise<CostCenter> {
  const existing = await repo.list();
  validateNewCostCenter(command, existing);

  const costCenter: CostCenter = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    type: command.type ?? "general",
    departmentId: command.departmentId ?? null,
    branchId: command.branchId ?? null,
    parentId: command.parentId ?? null,
    notes: command.notes ?? null,
    status: "active",
  };

  await repo.create(costCenter);
  return costCenter;
}
