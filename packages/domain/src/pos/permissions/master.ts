import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["pos.terminal.view"],
    ["pos.terminal.manage", "pos.terminal.view"],
    ["pos.settings.edit", "pos.terminal.view"],
    // Consulted by GET /pos/settings/discount-limit (the manager ceiling) and by
    // the sales-invoice discount gate, which still honours it (DEC-14).
    ["pos.discount.approve", "pos.terminal.view", "s"],
  ],
};
