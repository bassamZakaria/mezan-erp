import { Hono } from "hono";
import { LimitKind, QuotaKind, usedStorageMb, type BranchRepository, type UserRepository, type WarehouseRepository } from "@mezan/domain";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { tenantToday } from "./tenant-day.js";
import { tenantMonth, type QuotaEnforcement, type StorageEnforcement } from "./plan-quota.js";

export interface PlanUsageRoutesDeps {
  readonly quota?: QuotaEnforcement;
  readonly users?: Pick<UserRepository, "list">;
  readonly branches?: Pick<BranchRepository, "findAll">;
  readonly warehouses?: Pick<WarehouseRepository, "findAll">;
  readonly storage?: Pick<StorageEnforcement, "usedBytes">;
  readonly today?: () => string;
}

export interface PlanUsageBody {
  readonly today: string;
  readonly month: string;
  readonly quotas: ReadonlyArray<{ readonly kind: QuotaKind; readonly allowed: number; readonly used: number }>;
  readonly limits: ReadonlyArray<{ readonly limit: LimitKind; readonly allowed: number; readonly used: number }>;
}

/**
 * What the tenant has actually used against its plan, counted HERE — in the
 * tenant's own database and on the tenant's own calendar day. The billing
 * screen and the platform console both read this rather than each keeping
 * their own arithmetic, so the number a refusal quotes and the number the
 * screen shows can never drift apart.
 */
export function createPlanUsageRoutes(deps: PlanUsageRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  app.get("/", gate("admin.settings.view"), async (c) => {
    const entitlements = c.get("entitlements");
    const today = await tenantToday(c, deps.today);
    const month = await tenantMonth(c, deps.today);

    const quotas: { kind: QuotaKind; allowed: number; used: number }[] = [];
    for (const kind of Object.values(QuotaKind)) {
      if (kind === QuotaKind.StorageMb) continue;
      const allowed = entitlements?.quotas?.[kind];
      if (typeof allowed !== "number") continue;
      quotas.push({ kind, allowed, used: (await deps.quota?.countInMonth(kind, month)) ?? 0 });
    }

    const limits: { limit: LimitKind; allowed: number; used: number }[] = [];
    if (entitlements) {
      const activeUsers = (await deps.users?.list())?.filter((u) => u.status === "active").length ?? 0;
      limits.push({ limit: LimitKind.Seats, allowed: entitlements.seats, used: activeUsers });
      if (entitlements.limits) {
        limits.push({
          limit: LimitKind.Branches,
          allowed: entitlements.limits.branches,
          used: (await deps.branches?.findAll())?.length ?? 0,
        });
        limits.push({
          limit: LimitKind.Warehouses,
          allowed: entitlements.limits.warehouses,
          used: (await deps.warehouses?.findAll())?.length ?? 0,
        });
      }
      const storageMb = entitlements.quotas?.[QuotaKind.StorageMb];
      if (typeof storageMb === "number") {
        limits.push({ limit: LimitKind.StorageMb, allowed: storageMb, used: usedStorageMb((await deps.storage?.usedBytes()) ?? 0) });
      }
    }

    const body: PlanUsageBody = { today, month, quotas, limits };
    return c.json(body);
  });

  return app;
}
