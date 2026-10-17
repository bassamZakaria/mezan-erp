import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["inventory.expiry.view", "inventory.stock.view"],
    ["inventory.expiry.manage", "inventory.expiry.view"],
  ],
};
