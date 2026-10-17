import type { PermissionFragment } from "../../permissions/fragment.js";

/** ENH-E2-09 AR collections (dunning) — a lane on the existing sales module, so no new module fragment. */
export const fragment: PermissionFragment = {
  rows: [
    ["sales.collections.view", "sales.customer.view"],
    ["sales.collections.edit", "sales.collections.view"],
    ["sales.collections.run", "sales.collections.view"],
    ["sales.collections.send", "sales.collections.view", "s"],
    ["sales.collections.manage", "sales.collections.view", "s"],
  ],
};
