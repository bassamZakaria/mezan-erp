import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["treasury.reconciliation.manage", "treasury.reconciliation.view"],
    ["treasury.reconciliation.post_entry", "treasury.reconciliation.match"],
  ],
  actions: ["post_entry"],
};
