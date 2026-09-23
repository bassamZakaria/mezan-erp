import type { Context, MiddlewareHandler } from "hono";
import {
  LimitKind,
  locationOverLimitRefusal,
  type BranchRepository,
  type WarehouseRepository,
} from "@mezan/domain";
import { planLabelOf } from "./plan-quota.js";

/**
 * Branches and warehouses beyond what the plan includes (DEC-31 rule 6).
 *
 * NOTHING IS DELETED and nothing is hidden. A tenant that drops from a plan with
 * ten branches to one with one keeps all ten: every row stays listable,
 * readable and exportable, and its history stays intact. What stops is raising
 * a NEW document on the ones past the limit.
 *
 * Which ones are past it is decided by the registry's own order — the first
 * `allowed` rows a repository returns are in-limit. That has to be stable, or
 * a tenant would find a different branch frozen on every request.
 */
export interface PlanLocationSources {
  readonly branches?: Pick<BranchRepository, "findAll">;
  readonly warehouses?: Pick<WarehouseRepository, "findAll">;
}

export interface OverLimitLocations {
  readonly branches: ReadonlyMap<string, string>;
  readonly warehouses: ReadonlyMap<string, string>;
  readonly branchesAllowed: number;
  readonly warehousesAllowed: number;
}

const KEY = "planLocations" as const;

declare module "hono" {
  interface ContextVariableMap {
    planLocations?: () => Promise<OverLimitLocations | null>;
  }
}

const NONE: OverLimitLocations = {
  branches: new Map(),
  warehouses: new Map(),
  branchesAllowed: 0,
  warehousesAllowed: 0,
};

/**
 * Publishes the over-limit sets to every handler below, computed at most once
 * per request and only when something actually asks. Mounted once by
 * `createApp`, the same shape `entitlementsBinding` uses — which is what lets
 * every existing `refuseUnknownMasterData` call site gain the check without a
 * new dependency of its own.
 */
export function planLocationsBinding(sources: PlanLocationSources): MiddlewareHandler {
  return async function bindPlanLocations(c, next) {
    let cached: OverLimitLocations | null | undefined;
    c.set(KEY, async () => {
      if (cached !== undefined) return cached;
      const entitlements = c.get("entitlements");
      const limits = entitlements?.limits;
      if (!limits) {
        cached = null;
        return cached;
      }
      const overflow = async (rows: readonly { id: string; nameAr: string }[] | undefined, allowed: number) =>
        new Map((rows ?? []).slice(allowed).map((r) => [r.id, r.nameAr] as const));
      cached = {
        branches: await overflow(await sources.branches?.findAll(), limits.branches),
        warehouses: await overflow(await sources.warehouses?.findAll(), limits.warehouses),
        branchesAllowed: limits.branches,
        warehousesAllowed: limits.warehouses,
      };
      return cached;
    });
    await next();
  };
}

/** The 409 for a write that names a branch or warehouse past the plan's limit, or null. */
export async function refuseOverLimitLocation(
  c: Context,
  kind: LimitKind.Branches | LimitKind.Warehouses,
  ids: readonly (string | null | undefined)[],
): Promise<Response | null> {
  const entitlements = c.get("entitlements");
  const resolve = c.get(KEY);
  if (!entitlements || !resolve) return null;
  const over = (await resolve()) ?? NONE;
  const map = kind === LimitKind.Branches ? over.branches : over.warehouses;
  if (map.size === 0) return null;
  for (const id of ids) {
    if (typeof id !== "string" || id === "") continue;
    const nameAr = map.get(id);
    if (nameAr === undefined) continue;
    const allowed = kind === LimitKind.Branches ? over.branchesAllowed : over.warehousesAllowed;
    return c.json(locationOverLimitRefusal(kind, id, nameAr, allowed, planLabelOf(entitlements)), 409);
  }
  return null;
}
