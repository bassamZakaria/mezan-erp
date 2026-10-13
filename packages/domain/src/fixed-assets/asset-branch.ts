import { branchOfPostingWarehouse, type WarehouseBranchLookup } from "../gl/index.js";
import type { Asset } from "./asset.js";

/**
 * The branch an asset's postings belong to (DEC-20): its own branch, else the
 * branch of the warehouse it sits in. A company-wide asset has neither and
 * posts unattributed.
 */
export async function branchOfAsset(
  asset: Pick<Asset, "branchId" | "warehouseId">,
  warehouses: WarehouseBranchLookup | undefined,
): Promise<string | null> {
  return asset.branchId ?? (await branchOfPostingWarehouse(warehouses, asset.warehouseId));
}
