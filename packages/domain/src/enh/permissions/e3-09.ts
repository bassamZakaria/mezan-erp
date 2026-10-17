import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["admin.integrations.view", "admin.settings.view", "s"],
    ["admin.integrations.manage", "admin.integrations.view", "s"],
  ],
};
