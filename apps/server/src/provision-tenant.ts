import { randomInt, randomUUID } from "node:crypto";
import { activateTenant, createTenant, startSubscription, TenantCodeTakenError, type BillingCycle, type Tenant } from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";
import type { TenantRouter } from "./tenant-router.js";

export interface ProvisionTenantCommand {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly ownerEmail: string;
  readonly ownerNameAr: string;
  readonly planId: string;
  readonly billingCycle: BillingCycle;
  readonly trial: boolean;
}

export interface ProvisionTenantDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly now: () => Date;
  readonly pinOf?: () => string;
}

export interface ProvisionTenantResult {
  readonly tenant: Tenant;
  readonly adminEmail: string;
  readonly adminPin: string;
}

export class TenantProvisioningError extends Error {
  readonly code = "TENANT_PROVISIONING_FAILED";

  constructor(
    readonly tenantId: string,
    readonly cause: unknown,
  ) {
    super(`تعذّر تجهيز المنشأة "${tenantId}"`);
    this.name = "TenantProvisioningError";
  }
}

function defaultPinOf(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * The tenant's own backend gates every write behind its subscription-derived
 * license (packages/api/src/license-gate.ts), and a "provisioning" tenant with
 * no live subscription resolves to UNLICENSED — `canWrite: false` — same as an
 * expired one. `/bootstrap/admin` is a write, so the subscription has to start
 * and the tenant has to go "active" BEFORE that call, not after; seeding itself
 * needs no such ordering because `createBackend` seeds an empty tenant directly
 * against its stores the moment the backend opens, never through this gate.
 *
 * A code already claimed by a live tenant is told apart from a resumable one by
 * `GET /bootstrap/status` — a safe method, so it reads through the gate at any
 * license state — rather than by tenant status, which this function moves to
 * "active" before that tenant is actually reachable.
 */
export async function provisionTenant(cmd: ProvisionTenantCommand, deps: ProvisionTenantDeps): Promise<ProvisionTenantResult> {
  const nowIso = deps.now().toISOString();
  const pinOf = deps.pinOf ?? defaultPinOf;

  const existing = await deps.platform.stores.tenants.findByCode(cmd.code);
  let tenant =
    existing ??
    (await createTenant(
      { id: randomUUID(), code: cmd.code, nameAr: cmd.nameAr, nameEn: cmd.nameEn, ownerEmail: cmd.ownerEmail, now: nowIso },
      deps.platform.stores.tenants,
    ));

  try {
    const backend = await deps.router.backendFor(tenant.code);

    if (existing) {
      const statusRes = await backend.app.fetch(new Request("http://tenant.internal/bootstrap/status"));
      const { claimed } = (await statusRes.json()) as { claimed: boolean };
      if (claimed) throw new TenantCodeTakenError(cmd.code);
    }

    const live = await deps.platform.stores.subscriptions.findLiveByTenant(tenant.id);
    if (!live) {
      await startSubscription(
        {
          id: randomUUID(),
          tenantId: tenant.id,
          planId: cmd.planId,
          billingCycle: cmd.billingCycle,
          trial: cmd.trial,
          now: nowIso,
        },
        deps.platform.stores.subscriptions,
        deps.platform.stores.plans,
      );
    }

    if (tenant.status === "provisioning") {
      tenant = await activateTenant({ id: tenant.id, now: nowIso }, deps.platform.stores.tenants);
    }
    // The tenant's own resolver may have cached an UNLICENSED snapshot from the
    // `/bootstrap/status` read above (or a prior sweep) — bust it so the write
    // gate for the admin POST that follows sees this subscription and status.
    deps.router.invalidate(tenant.code);

    const adminPin = pinOf();
    const adminRes = await backend.app.fetch(
      new Request("http://tenant.internal/bootstrap/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nameAr: cmd.ownerNameAr, email: cmd.ownerEmail, pin: adminPin }),
      }),
    );
    if (adminRes.status !== 201 && adminRes.status !== 409) {
      throw new Error(`bootstrap/admin responded ${adminRes.status}`);
    }

    return { tenant, adminEmail: cmd.ownerEmail, adminPin };
  } catch (err) {
    if (err instanceof TenantCodeTakenError) throw err;
    throw new TenantProvisioningError(tenant.id, err);
  }
}
