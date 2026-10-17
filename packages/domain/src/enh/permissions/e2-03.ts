import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["inventory.count.scan"],
    ["inventory.count.assign", "inventory.count.create"],
    ["inventory.count.review", "inventory.count.view"],
    ["inventory.count.approve", "inventory.count.review", "s"],
  ],
};
