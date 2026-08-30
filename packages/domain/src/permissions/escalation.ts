/**
 * Privilege-escalation guards.
 *
 * WHY THIS EXISTS. The permission gate answers "may this caller reach this
 * route", and every admin route answered it correctly. Nothing answered the
 * second question — "may this caller hand out THIS authority" — so the answer
 * was always yes. Measured on a seeded tenant: a user holding exactly
 * `admin.users.view` + `admin.users.create` was refused the trial balance
 * (403), created a user with `isCompanyAdmin: true`, signed in as it, and read
 * the trial balance (200). The same walk works through `admin.roles.manage` by
 * rewriting one's own role to `["*"]`.
 *
 * The rule these functions enforce is one sentence: A CALLER MAY NEVER GRANT
 * AUTHORITY THEY DO NOT THEMSELVES HOLD, and may never edit an account whose
 * authority exceeds their own. Only a tenant admin (`"*"`) can mint another
 * tenant admin, because only they hold `"*"` to give.
 */

import { isTenantAdmin, type AuthContext } from "./auth-context.js";
import { resolvePermissions } from "./resolve.js";

/**
 * The subset of `requested` this caller may NOT grant — empty when the grant
 * is within their own authority.
 *
 * Compares against the RESOLVED closure on both sides: granting `.confirm`
 * implies `.view_own`, so a caller who holds neither must not be able to hand
 * out the implied one either. `"*"` survives resolution verbatim, so a
 * non-admin asking for it always lands in the returned list.
 */
export function ungrantablePermissions(
  ctx: AuthContext,
  requested: Iterable<string>,
): string[] {
  if (isTenantAdmin(ctx)) return [];
  return [...resolvePermissions(requested)].filter((code) => !ctx.permissions.has(code));
}

/** The authority an existing account carries, flattened for comparison. */
export interface AccountAuthority {
  readonly isCompanyAdmin: boolean;
  /** The account's role permissions; empty for an account with no role. */
  readonly permissions: readonly string[];
}

/**
 * True when `target` holds authority this caller does not — a company admin
 * seen by a non-admin, or a role carrying a permission the caller lacks.
 *
 * This is what stops a helpdesk-tier `admin.users.edit` from resetting the
 * owner's PIN and signing in as them. Resetting a clerk's PIN stays allowed:
 * that is the job the permission exists for.
 */
export function targetOutranksCaller(ctx: AuthContext, target: AccountAuthority): boolean {
  if (isTenantAdmin(ctx)) return false;
  if (target.isCompanyAdmin) return true;
  return ungrantablePermissions(ctx, target.permissions).length > 0;
}
