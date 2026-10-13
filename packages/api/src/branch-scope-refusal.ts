import type { Context } from "hono";
import { branchRefusal, BranchRefusalCode } from "./branch-policy.js";
import { branchGrantOf, branchesOutsideGrantRefusal } from "./permission-gate.js";

/**
 * Refuses a branch-scoped caller on a report that only exists for the whole
 * entity (the VAT return, the sub-ledger reconciliation). Narrowing such a
 * report would present a partial statutory figure as the company's; serving it
 * whole would hand the caller every other branch's totals.
 *
 * Keyed on what the session was GRANTED: an all-branches user who merely
 * picked a branch in the shell is entitled to the whole report and gets it.
 */
export function refuseBranchScopedCaller(c: Context): Response | null {
  if (branchGrantOf(c) === undefined) return null;
  return branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
}

/** Refuses a write that names a branch outside the branches the caller's session was granted. */
export function refuseOutOfScopeBranches(c: Context, branchIds: readonly (string | null | undefined)[]): Response | null {
  return branchesOutsideGrantRefusal(c, branchGrantOf(c), branchIds);
}
