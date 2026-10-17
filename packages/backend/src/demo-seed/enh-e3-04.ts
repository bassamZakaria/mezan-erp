import type { SeedFragment } from "./fragments.js";

export const seed: SeedFragment = {
  roleGrants: {
    SUPERVISOR: ["field.van_trip.view", "field.van_trip.approve"],
    BRANCH_MANAGER: ["field.van_trip.view", "field.van_trip.approve"],
    FINANCE_MANAGER: ["field.van_trip.view", "field.van_trip.approve"],
    AUDITOR: ["field.van_trip.view"],
  },
};
