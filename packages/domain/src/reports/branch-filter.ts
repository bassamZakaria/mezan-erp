import { z } from "zod";
import type { ReportParamField } from "./types.js";

/**
 * الفرع — the branch dimension every branch-aware report declares (D111).
 *
 * A four-branch retailer could not narrow a single report to one branch, and a
 * branch manager saw every branch's figures. The parameter is declared here
 * once so the shape is identical across reports and the parameter bar renders
 * the same control everywhere.
 *
 * ONLY reports whose source rows actually carry a branch declare it. A stock
 * report reaches the branch through the warehouse holding the goods
 * ({@link branchOfWarehouse}); the seven financial statements read journal
 * entries, which carry no branch at all, so they declare nothing rather than
 * offering a filter that would silently do nothing.
 */
export const BRANCH_PARAM_FIELD: ReportParamField = {
  kind: "text",
  key: "branchId",
  label: "الفرع",
  placeholder: "معرف الفرع (اتركه فارغاً لكل الفروع)",
};

/**
 * The wire schema for that parameter.
 *
 * Defaulted rather than required: every saved view, bookmark and screen
 * predates the parameter, and a required key would turn each of them into a
 * 400 on the first load after this shipped.
 */
export const branchIdParamSchema = z.string().default("");

/**
 * Whether a row belongs to the requested branch. An empty `branchId` means
 * every branch.
 *
 * A row with no branch on it does NOT match a specific branch: this is a
 * filter the reader chose, not the authority scope. Scope keeps unattributable
 * rows visible (`withinScope`); asking for فرع القاهرة does not.
 */
export function matchesBranch(rowBranchId: string | null | undefined, branchId: string): boolean {
  return branchId === "" || rowBranchId === branchId;
}

/**
 * Resolves the branch that holds a warehouse — the only route from stock to a
 * branch, since movements, cost layers and WAC snapshots carry a warehouse and
 * never a branch.
 */
export function branchOfWarehouse(
  warehouses: readonly { readonly id: string; readonly branchId: string }[] | undefined,
): (warehouseId: string) => string | null {
  const index = new Map((warehouses ?? []).map((warehouse) => [warehouse.id, warehouse.branchId]));
  return (warehouseId) => index.get(warehouseId) ?? null;
}
