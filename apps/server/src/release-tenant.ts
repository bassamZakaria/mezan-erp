import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { PlatformHandle } from "@mezan/backend";
import { withSqliteTransaction } from "@mezan/persistence";
import {
  cancelSubscription,
  InvalidTenantTransitionError,
  recordSecurityEvent,
  releasedTenantCode,
  releaseTenant,
  tenantDbFile,
  TenantStatusCode,
  type Tenant,
} from "@mezan/domain";
import { platformActor } from "./provision-tenant.js";
import { tenantDbPath, type TenantRouter } from "./tenant-router.js";

export interface ReleaseTenantDeps {
  readonly platform: PlatformHandle;
  readonly router: Pick<TenantRouter, "evict" | "invalidate">;
  readonly dataDir: string;
  readonly now: () => Date;
}

const SQLITE_SIDE_FILES = ["", "-wal", "-shm"] as const;

function moveDatabase(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  for (const suffix of SQLITE_SIDE_FILES) {
    if (existsSync(`${from}${suffix}`)) renameSync(`${from}${suffix}`, `${to}${suffix}`);
  }
}

/**
 * Archives a tenant stuck in provisioning and frees its code.
 *
 * REQUIRED ORDERING: the database file is moved aside BEFORE the platform row
 * lets go of the code. The next signup under that code opens `tenants/<code>.db`;
 * if the old file were still there it would open the old company's books.
 * A failure after the move leaves a provisioning tenant with no file, which a
 * second release, or a provisioning retry, completes.
 */
export async function releaseProvisioningTenant(deps: ReleaseTenantDeps, input: { readonly tenant: Tenant; readonly actorId: string }): Promise<Tenant> {
  const { platform } = deps;
  const tenant = await platform.stores.tenants.findById(input.tenant.id);
  if (!tenant || tenant.status !== TenantStatusCode.Provisioning) {
    throw new InvalidTenantTransitionError(tenant?.status ?? input.tenant.status, TenantStatusCode.Archived);
  }
  const at = deps.now().toISOString();
  await deps.router.evict(tenant.code);
  moveDatabase(tenantDbPath(deps.dataDir, tenant.dbFile), tenantDbPath(deps.dataDir, tenantDbFile(releasedTenantCode(tenant.id))));

  const released = await withSqliteTransaction(
    platform.stores.sqlite,
    async () => {
      const live = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
      if (live) await cancelSubscription({ id: live.id, now: at }, platform.stores.subscriptions);
      await platform.stores.signupRequests.releaseByCode(tenant.code);
      const after = await releaseTenant({ id: tenant.id, now: at }, platform.stores.tenants);
      await recordSecurityEvent(platform.audit, {
        module: "platform",
        entityType: "PLATFORM",
        entityId: tenant.id,
        action: "TENANT_RELEASED",
        actor: platformActor(input.actorId),
        severity: "CRITICAL",
        timestamp: at,
        details: { code: tenant.code, releasedAs: after.code, cancelledSubscriptionId: live?.id ?? null },
      });
      return after;
    },
    "BEGIN IMMEDIATE",
  );
  deps.router.invalidate(tenant.code);
  return released;
}
