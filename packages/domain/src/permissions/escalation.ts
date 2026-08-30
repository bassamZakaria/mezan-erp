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
 *
 * AUTHORITY HAS TWO DIMENSIONS, not one. `can()` enforces both — WHAT a role
 * permits and WHERE it may act — so a guard that compares only the permission
 * list leaves the second one ungoverned: a branch manager scoped to one branch
 * could write `branchScope: "*"` onto an account carrying their OWN role (or
 * onto their own account, where the role comparison is trivially satisfied)
 * and reach every branch in the tenant. Every branch and warehouse boundary in
 * the product was therefore optional for anyone holding `admin.users.edit`.
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

/** One scope dimension a caller reached past. */
export interface ScopeEscalation {
  readonly dimension: "branch" | "warehouse";
  /** What was asked for: `"*"`, or the specific ids outside the caller's own grant. */
  readonly requested: "*" | readonly string[];
}

/**
 * True when `requested` reaches somewhere `granted` does not.
 *
 * A caller holding `ALL_SCOPE` may grant anything. A caller holding a list may
 * grant only a subset of that list, and may never grant `ALL_SCOPE` — "every
 * branch" is strictly more than any enumeration of branches, including the one
 * the caller holds.
 */
function scopeExceeds(granted: ScopeSelection, requested: ScopeSelection): "*" | readonly string[] | null {
  if (granted === ALL_SCOPE) return null;
  if (requested === ALL_SCOPE) return ALL_SCOPE;
  const allowed = new Set(granted);
  const outside = requested.filter((id) => !allowed.has(id));
  return outside.length > 0 ? outside : null;
}

/**
 * The scope dimensions this caller may NOT grant — empty when the requested
 * branch/warehouse reach is within the caller's own.
 *
 * Omitted dimensions are not checked: a command that does not name a scope is
 * not widening one.
 */
export function ungrantableScopes(
  ctx: AuthContext,
  requested: { readonly branchScope?: ScopeSelection; readonly warehouseScope?: ScopeSelection },
): ScopeEscalation[] {
  if (isTenantAdmin(ctx)) return [];
  const out: ScopeEscalation[] = [];
  if (requested.branchScope !== undefined) {
    const over = scopeExceeds(ctx.branchScope, requested.branchScope);
    if (over) out.push({ dimension: "branch", requested: over });
  }
  if (requested.warehouseScope !== undefined) {
    const over = scopeExceeds(ctx.warehouseScope, requested.warehouseScope);
    if (over) out.push({ dimension: "warehouse", requested: over });
  }
  return out;
}

/** The authority an existing account carries, flattened for comparison. */
export interface AccountAuthority {
  readonly isCompanyAdmin: boolean;
  /** The account's role permissions; empty for an account with no role. */
  readonly permissions: readonly string[];
  /**
   * Where the account may act. Optional so an existing caller that only knows
   * about permissions still type-checks — but a caller that CAN supply it
   * must, because an account reaching branches the caller cannot reach
   * outranks the caller as surely as one holding a permission they lack.
   */
  readonly branchScope?: ScopeSelection;
  readonly warehouseScope?: ScopeSelection;
  /**
   * True when the account names a role the role store could not resolve.
   *
   * A dangling `roleId` used to read as "carries nothing", so a security
   * predicate FAILED OPEN on exactly the account whose authority the server
   * could not establish. An unresolvable role now outranks everyone but a
   * tenant admin.
   */
  readonly roleUnresolved?: boolean;
}

/**
 * True when `target` holds authority this caller does not — a company admin
 * seen by a non-admin, a role carrying a permission the caller lacks, or a
 * branch/warehouse reach wider than the caller's own.
 *
 * This is what stops a helpdesk-tier `admin.users.edit` from resetting the
 * owner's PIN and signing in as them. Resetting a clerk's PIN stays allowed:
 * that is the job the permission exists for.
 */
export function targetOutranksCaller(ctx: AuthContext, target: AccountAuthority): boolean {
  if (isTenantAdmin(ctx)) return false;
  if (target.isCompanyAdmin) return true;
  if (target.roleUnresolved) return true;
  if (ungrantablePermissions(ctx, target.permissions).length > 0) return true;
  return ungrantableScopes(ctx, target).length > 0;
}
