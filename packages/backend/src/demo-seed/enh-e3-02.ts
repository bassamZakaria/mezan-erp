import type { SeedFragment } from "./fragments.js";

export const seed: SeedFragment = {
  roleGrants: {
    FINANCE_MANAGER: ["accounting.owner_digest.view", "accounting.owner_digest.manage", "accounting.owner_digest.send"],
    BRANCH_MANAGER: ["accounting.owner_digest.view"],
    AUDITOR: ["accounting.owner_digest.view"],
  },
};
