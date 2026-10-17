import type { PermissionFragment } from "../../permissions/fragment.js";

/** ENH-E3-02 owner digest — a lane on the existing accounting module; `view` implies the cockpit it is built from. */
export const fragment: PermissionFragment = {
  rows: [
    ["accounting.owner_digest.view", "accounting.cockpit.view"],
    ["accounting.owner_digest.manage", "accounting.owner_digest.view", "s"],
    ["accounting.owner_digest.send", "accounting.owner_digest.view", "s"],
  ],
};
