import type { BranchDTO, WarehouseDTO } from "@mezan/contracts";

/**
 * Where a newly-created document defaults to — mirrors
 * `apps/web/src/data/hub-hooks.ts`'s `useWorkingLocation`, minus the web's
 * own branch/warehouse scope selector (the phone has none yet): the
 * tenant's main branch, and that branch's default warehouse. Always a
 * starting point the picker lets the rep change, never the value sent
 * without being shown.
 */
export function resolveDefaultBranch(branches: readonly BranchDTO[]): BranchDTO | null {
  const active = branches.filter((b) => b.active);
  return active.find((b) => b.isMain) ?? active[0] ?? null;
}

export function resolveDefaultWarehouse(warehouses: readonly WarehouseDTO[], branchId: string | null): WarehouseDTO | null {
  const active = warehouses.filter((w) => w.active && (branchId === null || w.branchId === branchId));
  return active.find((w) => w.isDefault) ?? active[0] ?? null;
}
