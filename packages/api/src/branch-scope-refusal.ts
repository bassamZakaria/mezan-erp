import type { Context } from "hono";
import { branchGrantOf } from "./permission-gate.js";

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
  return c.json(
    {
      error: "COMPANY_WIDE_REPORT",
      message: "هذا التقرير يخص المنشأة كلها ولا يُعرض لمستخدم مقيَّد بفروع محددة.",
      messageEn: "This report covers the whole company and is not available to a branch-scoped user.",
    },
    403,
  );
}

/** Refuses a write that names a branch outside the branches the caller's session was granted. */
export function refuseOutOfScopeBranches(c: Context, branchIds: readonly (string | null | undefined)[]): Response | null {
  const scope = branchGrantOf(c);
  if (!scope) return null;
  const foreign = [...new Set(branchIds.filter((id): id is string => typeof id === "string" && id !== "" && !scope.includes(id)))];
  if (foreign.length === 0) return null;
  return c.json(
    {
      error: "BRANCH_OUT_OF_SCOPE",
      message: "لا يمكنك الترحيل على فرع خارج صلاحيتك.",
      messageEn: "You cannot post to a branch outside your scope.",
      branchIds: foreign,
    },
    403,
  );
}
