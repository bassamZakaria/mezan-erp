/**
 * AuthContext — the identity + authority object the adapter builds and hands to
 * the domain (docs/plan.md §3.3). Its permission checks are identical in both
 * editions: cloud derives it from JWT claims, desktop from the local user store.
 *
 * Two orthogonal dimensions, exactly as the catalog documents (§add-user form):
 *   - WHAT a role permits (`permissions`, three-tier visibility), and
 *   - WHERE it may act (`branchScope` / `warehouseScope`).
 */

import { WILDCARD_PERMISSION } from "./catalog.js";
import { resolvePermissions } from "./resolve.js";

/**
 * A scope selection: either every entity (`"*"`, e.g. the "all warehouses"
 * default in the top-bar selector) or an explicit allow-list of ids.
 */
export type ScopeSelection = typeof ALL_SCOPE | readonly string[];

/** Sentinel for "all branches / all warehouses". */
export const ALL_SCOPE = "*" as const;

export interface AuthContextInput {
  readonly userId: string;
  /** Raw granted permission codes (pre dependency-resolution). `"*"` = admin. */
  readonly permissions: Iterable<string>;
  /**
   * The custom roles the caller holds. A workflow gate step names an approver
   * ROLE, not a permission, so this is what decides who may approve — and it
   * therefore has to come from the same resolved identity as the permissions,
   * never from a header the caller writes.
   */
  readonly roleCodes?: Iterable<string>;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
  /**
   * False when the request carried no session the server recognises.
   *
   * Distinct from holding no permissions: a signed-in user with an empty role
   * is FORBIDDEN, and a caller whose token the server has never heard of (or
   * has forgotten) is UNAUTHENTICATED. Collapsing the two made every expired
   * session look like a permissions problem, so the client could only render
   * an empty screen where it should have asked the person to sign in again.
   */
  readonly authenticated?: boolean;
}

export interface AuthContext {
  readonly userId: string;
  /** Dependency-resolved effective permission set. */
  readonly permissions: ReadonlySet<string>;
  /** Custom-role codes the caller holds — what a workflow step's approver role is matched against. */
  readonly roleCodes: ReadonlySet<string>;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
  /** False only for a caller the server could not identify at all. */
  readonly authenticated: boolean;
}

export interface ScopeQuery {
  readonly branch?: string;
  readonly warehouse?: string;
}

/**
 * Builds an `AuthContext`, resolving the granted permissions to their transitive
 * closure so downstream `can()` calls are a flat membership test.
 */
export function createAuthContext(input: AuthContextInput): AuthContext {
  return {
    userId: input.userId,
    permissions: resolvePermissions(input.permissions),
    roleCodes: new Set(input.roleCodes ?? []),
    branchScope: input.branchScope,
    warehouseScope: input.warehouseScope,
    // Defaults to true so every existing caller — the header resolver, the
    // seed's minted grants, every test fake — keeps meaning "this is someone".
    authenticated: input.authenticated ?? true,
  };
}

/** True for a tenant admin (holds the `"*"` wildcard) — bypasses every gate. */
export function isTenantAdmin(ctx: AuthContext): boolean {
  return ctx.permissions.has(WILDCARD_PERMISSION);
}

function inScope(scope: ScopeSelection, id: string): boolean {
  return scope === ALL_SCOPE || scope.includes(id);
}

/**
 * The core authorization check: does this context hold `permission`, and — when
 * a branch/warehouse is supplied — may it act in that location?
 *
 * Tenant admins (`"*"`) pass unconditionally, including all scopes. Otherwise
 * the permission must be in the resolved set AND every supplied scope dimension
 * must be within the context's allow-list.
 */
export function can(
  ctx: AuthContext,
  permission: string,
  scope?: ScopeQuery,
): boolean {
  if (isTenantAdmin(ctx)) return true;
  if (!ctx.permissions.has(permission)) return false;
  if (scope?.branch !== undefined && !inScope(ctx.branchScope, scope.branch)) {
    return false;
  }
  if (
    scope?.warehouse !== undefined &&
    !inScope(ctx.warehouseScope, scope.warehouse)
  ) {
    return false;
  }
  return true;
}

/**
 * The highest visibility tier a context holds for an entity prefix
 * (e.g. `"sales.invoice"`), collapsing the three-tier model into a single
 * answer: cross-branch (`view_all`) > in-scope (`view`) > own-only (`view_own`)
 * > none. Admins always see `"all"`.
 */
export function visibilityTier(
  ctx: AuthContext,
  entityPrefix: string,
): "all" | "in_scope" | "own" | "none" {
  if (isTenantAdmin(ctx)) return "all";
  if (ctx.permissions.has(`${entityPrefix}.view_all`)) return "all";
  if (ctx.permissions.has(`${entityPrefix}.view`)) return "in_scope";
  if (ctx.permissions.has(`${entityPrefix}.view_own`)) return "own";
  return "none";
}
