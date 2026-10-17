import type { PermissionFragment } from "../../permissions/fragment.js";

/**
 * ENH-E3-07 sales funnel and rep leaderboard. Reads only: the tier of deals a
 * caller sees is still decided by `crm.opportunity.view` / `view_own`; margin
 * figures additionally need `sales.invoice.view_cost`.
 */
export const fragment: PermissionFragment = {
  rows: [["crm.funnel.view", "crm.opportunity.view_own"]],
};
