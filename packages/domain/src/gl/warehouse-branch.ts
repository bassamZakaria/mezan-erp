export interface WarehouseBranchLookup {
  findById(id: string): Promise<{ readonly branchId: string } | null>;
}

export async function branchOfPostingWarehouse(
  warehouses: WarehouseBranchLookup | undefined,
  warehouseId: string | null | undefined,
): Promise<string | null> {
  if (!warehouses || !warehouseId) return null;
  return (await warehouses.findById(warehouseId))?.branchId ?? null;
}
