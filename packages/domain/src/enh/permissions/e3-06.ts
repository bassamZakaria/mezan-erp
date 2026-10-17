import type { PermissionFragment } from "../../permissions/fragment.js";

/**
 * ENH-E3-06 CRM pipeline. `crm.opportunity.view` stays the wide tier (every deal
 * in the caller's branches); `view_own` is the rep's tier — only the deals they
 * own — with the same pairing `sales.quote.view` / `sales.quote.view_own` uses.
 */
export const fragment: PermissionFragment = {
  rows: [
    ["crm.opportunity.view_own"],
    ["crm.opportunity.assign", "crm.opportunity.view"],
  ],
};
