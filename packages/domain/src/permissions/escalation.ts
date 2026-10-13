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

import { ALL_SCOPE, isScopeRestricted, isTenantAdmin, type AuthContext, type ScopeSelection } from "./auth-context.js";
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
  if (!isTenantAdmin(ctx)) {
    if (target.isCompanyAdmin) return true;
    if (target.roleUnresolved) return true;
    if (ungrantablePermissions(ctx, target.permissions).length > 0) return true;
  }
  return reachExceedsCaller(ctx, target);
}

function reachExceedsCaller(ctx: AuthContext, target: AccountAuthority): boolean {
  if (!isScopeRestricted(ctx)) return false;
  // SECURITY: a restricted caller is refused an account whose reach it was
  // not told — an unknown scope is not a narrow one.
  if (ctx.branchGrant !== ALL_SCOPE && target.branchScope === undefined) return true;
  if (ctx.warehouseGrant !== ALL_SCOPE && target.warehouseScope === undefined) return true;
  return ungrantableScopes(ctx, target).length > 0;
}

/**
 * The scope ids in `requested` this caller may NOT hand out, tagged with the
 * dimension they came from (`"branch:BR-ALEX"`, `"warehouse:*"`).
 *
 * WHERE is authority just as much as WHAT. Every read-narrowing in the app
 * consults `branchScope`/`warehouseScope`, so a caller who can write a wider
 * scope onto an account — their own most of all — defeats all of them at once
 * without ever touching a permission code. A caller whose GRANT on a dimension
 * is every id can grant anything on it; anyone else — a `"*"` administrator
 * included — may grant only ids they hold, and may never grant `"*"`.
 */
export function ungrantableScopes(
  ctx: AuthContext,
  requested: { readonly branchScope?: ScopeSelection; readonly warehouseScope?: ScopeSelection },
): string[] {
  // SECURITY: no bypass for `"*"`. An administrator granted one branch who
  // could write a wider scope onto any account, its own first, would hold
  // every branch one request later. Reads the session's GRANT, so narrowing a
  // request with the shell's branch selector takes nothing away.
  return [
    ...ungrantableScope("branch", ctx.branchGrant, requested.branchScope),
    ...ungrantableScope("warehouse", ctx.warehouseGrant, requested.warehouseScope),
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
