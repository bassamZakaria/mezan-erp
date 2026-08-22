import type { CostCenter, CostCenterRepository, CostCenterStatus, CostCenterType } from "./cost-center.js";
import { CircularParentCostCenterError, CostCenterNotFoundError, InvalidParentCostCenterError } from "./errors.js";
import { isDescendantOf } from "./hierarchy.js";

export interface UpdateCostCenterCommand {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly type?: CostCenterType;
  readonly departmentId?: string | null;
  readonly branchId?: string | null;
  readonly parentId?: string | null;
  readonly notes?: string | null;
  readonly status?: CostCenterStatus;
}

/**
 * Edits an existing cost center. Re-validates the hierarchy rules that still
 * apply after the change: a new parent must exist, and reparenting must not
 * create a cycle (a cost center can't become its own ancestor).
 */
export async function updateCostCenter(
  costCenterId: string,
  command: UpdateCostCenterCommand,
  repo: CostCenterRepository,
): Promise<CostCenter> {
  const current = await repo.findById(costCenterId);
  if (!current) throw new CostCenterNotFoundError(costCenterId);

  const existing = await repo.list();

  const nextParentId = command.parentId !== undefined ? command.parentId : current.parentId;
  if (nextParentId !== null) {
    if (nextParentId === costCenterId) {
      throw new CircularParentCostCenterError(costCenterId);
    }
    if (!existing.some((c) => c.id === nextParentId)) {
      throw new InvalidParentCostCenterError(`Parent cost center "${nextParentId}" was not found.`);
    }
    if (isDescendantOf(existing, nextParentId, costCenterId)) {
      throw new CircularParentCostCenterError(costCenterId);
    }
  }

  const updated: CostCenter = {
    ...current,
    nameAr: command.nameAr ?? current.nameAr,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    type: command.type ?? current.type,
    departmentId: command.departmentId !== undefined ? command.departmentId : current.departmentId,
    branchId: command.branchId !== undefined ? command.branchId : current.branchId,
    parentId: nextParentId,
    notes: command.notes !== undefined ? command.notes : current.notes,
    status: command.status ?? current.status,
  };

  await repo.update(updated);
  return updated;
}
