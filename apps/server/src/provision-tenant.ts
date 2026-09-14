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
  /** Null on a resumed provision — the admin already exists and its PIN is not re-issued. */
  readonly adminPin: string | null;
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

    await backend.app.fetch(new Request("http://tenant.internal/bootstrap/seed", { method: "POST" }));

    const statusRes = await backend.app.fetch(new Request("http://tenant.internal/bootstrap/status"));
    const { claimed } = (await statusRes.json()) as { claimed: boolean };

    let adminPin: string | null = null;
    if (claimed) {
      if (tenant.status !== "provisioning") throw new TenantCodeTakenError(cmd.code);
    } else {
      adminPin = pinOf();
      const adminRes = await backend.app.fetch(
        new Request("http://tenant.internal/bootstrap/admin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nameAr: cmd.ownerNameAr, email: cmd.ownerEmail, pin: adminPin }),
        }),
      );
      if (adminRes.status !== 201) {
        throw new Error(`bootstrap/admin responded ${adminRes.status}`);
      }
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

    return { tenant, adminEmail: cmd.ownerEmail, adminPin };
  } catch (err) {
    if (err instanceof TenantCodeTakenError) throw err;
    throw new TenantProvisioningError(tenant.id, err);
  }
}
