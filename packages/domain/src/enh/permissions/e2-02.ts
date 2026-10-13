import type { PermissionFragment } from "../../permissions/fragment.js";

/** ENH-E2-02 recurring journals — a lane on the existing accounting module, so no new module fragment. */
export const fragment: PermissionFragment = {
  rows: [
    ["accounting.recurring.view", "accounting.journal.view"],
    ["accounting.recurring.manage", "accounting.recurring.view,accounting.journal.create"],
    ["accounting.recurring.reverse", "accounting.recurring.view", "s"],
  ],
};
