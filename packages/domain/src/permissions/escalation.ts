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

import { ALL_SCOPE, isTenantAdmin, type AuthContext, type ScopeSelection } from "./auth-context.js";
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

/**
 * The scope ids in `requested` this caller may NOT hand out, tagged with the
 * dimension they came from (`"branch:BR-ALEX"`, `"warehouse:*"`).
 *
 * WHERE is authority just as much as WHAT. Every read-narrowing in the app
 * consults `branchScope`/`warehouseScope`, so a caller who can write a wider
 * scope onto an account — their own most of all — defeats all of them at once
 * without ever touching a permission code. A caller already holding `"*"` on a
 * dimension can grant anything on it; anyone else may grant only ids they hold,
 * and may never grant `"*"`.
 */
export function ungrantableScopes(
  ctx: AuthContext,
  requested: { readonly branchScope?: ScopeSelection; readonly warehouseScope?: ScopeSelection },
): string[] {
  return [
    ...ungrantableScope("branch", ctx.branchScope, requested.branchScope),
    ...ungrantableScope("warehouse", ctx.warehouseScope, requested.warehouseScope),
  ];
}

function ungrantableScope(
  dimension: string,
  held: ScopeSelection,
  requested: ScopeSelection | undefined,
): string[] {
  if (requested === undefined || held === ALL_SCOPE) return [];
  if (requested === ALL_SCOPE) return [`${dimension}:${ALL_SCOPE}`];
  const mine = new Set(held);
  return requested.filter((id) => !mine.has(id)).map((id) => `${dimension}:${id}`);
}
