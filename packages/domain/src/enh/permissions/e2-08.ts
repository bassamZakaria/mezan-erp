import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["sales.pricing_guard.view", "sales.invoice.view"],
    ["sales.pricing_guard.manage", "sales.pricing_guard.view", "s"],
    ["sales.pricing_guard.approve", "sales.pricing_guard.view", "s"],
  ],
};
