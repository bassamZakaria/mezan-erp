import type { PermissionFragment } from "../../permissions/fragment.js";

/** ENH-E3-03 reorder — a lane on the existing inventory module. */
export const fragment: PermissionFragment = {
  rows: [
    ["inventory.reorder.view", "inventory.stock.view"],
    ["inventory.reorder.manage", "inventory.reorder.view"],
    ["inventory.reorder.create", "inventory.reorder.view"],
  ],
};
