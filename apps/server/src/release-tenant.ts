import { PlatformAuditUnavailableError, type PlatformHandle } from "@mezan/backend";
import { TransactionMode } from "@mezan/persistence";
import {
  AuditSeverityCode,
  cancelSubscription,
  recordSecurityEvent,
  releaseTenant,
  type Tenant,
} from "@mezan/domain";
import { platformActor } from "./provision-tenant.js";
import type { TenantRouter } from "./tenant-router.js";

export const TENANT_RELEASED_AUDIT = "TENANT_RELEASED";

export interface ReleaseTenantDeps {
  readonly platform: PlatformHandle;
  readonly router: Pick<TenantRouter, "evict" | "invalidate">;
  readonly dataDir: string;
  readonly now: () => Date;
}

// REQUIRED ORDERING: the status check, the claim drop and the archive are ONE
// write transaction, and the tenant's backend is closed only after it commits.
// A provisioning that activated first makes `releaseTenant` throw before
// anything of the live tenant is touched. The database file is never moved.
export async function releaseProvisioningTenant(deps: ReleaseTenantDeps, input: { readonly tenant: Tenant; readonly actorId: string }): Promise<Tenant> {
  const { platform } = deps;
  const at = deps.now().toISOString();
  const { before, released } = await platform.stores.db.transaction(
    async () => {
      const after = await releaseTenant({ id: input.tenant.id, now: at }, platform.stores.tenants);
      const live = await platform.stores.subscriptions.findLiveByTenant(after.id);
      if (live) await cancelSubscription({ id: live.id, now: at }, platform.stores.subscriptions);
      await platform.stores.signupRequests.releaseByCode(input.tenant.code);
      await platform.stores.signInEmails.forgetTenant(after.id);
      await recordSecurityEvent(platform.audit, {
        module: "platform",
        entityType: "PLATFORM",
        entityId: after.id,
        action: TENANT_RELEASED_AUDIT,
        actor: platformActor(input.actorId),
        severity: AuditSeverityCode.Critical,
        timestamp: at,
        details: { code: input.tenant.code, releasedAs: after.code, cancelledSubscriptionId: live?.id ?? null },
      }).catch((cause: unknown) => {
        throw new PlatformAuditUnavailableError(cause);
      });
      return { before: input.tenant, released: after };
    },
    TransactionMode.Immediate,
  );
  await platform.outsideTheTurn(() => deps.router.evict(released.id));
  deps.router.invalidate(before.code);
  return released;
}
