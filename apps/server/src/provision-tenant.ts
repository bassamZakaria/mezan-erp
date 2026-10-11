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

/** A retry has no live subscription to resume and no plan in the request body to fall back to — nothing tells `startSubscription` what to start. */
export class PlanRequiredError extends Error {
  readonly code = "PLAN_REQUIRED";

  constructor() {
    super("حدّد الباقة لإعادة التجهيز");
    this.name = "PlanRequiredError";
  }
}

function defaultPinOf(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

interface TenantSide {
  readonly adminPin: string | null;
}

async function prepareTenantDatabase(cmd: ProvisionTenantCommand, tenant: Tenant, deps: ProvisionTenantDeps): Promise<TenantSide> {
  const pinOf = deps.pinOf ?? defaultPinOf;
  const backend = await deps.router.backendFor(tenant.code);

  await backend.app.fetch(new Request("http://tenant.internal/bootstrap/seed", { method: "POST" }));

  const statusRes = await backend.app.fetch(new Request("http://tenant.internal/bootstrap/status"));
  const { claimed } = (await statusRes.json()) as { claimed: boolean };

  if (claimed) {
    if (tenant.status !== "provisioning") throw new TenantCodeTakenError(cmd.code);
    return { adminPin: null };
  }
  const adminPin = pinOf();
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
  return { adminPin };
}

export async function provisionTenant(cmd: ProvisionTenantCommand, deps: ProvisionTenantDeps): Promise<ProvisionTenantResult> {
  const nowIso = deps.now().toISOString();
  const { platform } = deps;

  const registered = await platform.inTheTurn("tenant registration", async () => {
    const existing = await platform.stores.tenants.findByCode(cmd.code);
    return (
      existing ??
      (await createTenant(
        { id: randomUUID(), code: cmd.code, nameAr: cmd.nameAr, nameEn: cmd.nameEn, ownerEmail: cmd.ownerEmail, now: nowIso },
        platform.stores.tenants,
      ))
    );
  });

  try {
    const { adminPin } = await platform.outsideTheTurn(() => prepareTenantDatabase(cmd, registered, deps));

    const tenant = await platform.inTheTurn("tenant activation", async () => {
      const live = await platform.stores.subscriptions.findLiveByTenant(registered.id);
      if (!live) {
        await startSubscription(
          {
            id: randomUUID(),
            tenantId: registered.id,
            planId: cmd.planId,
            billingCycle: cmd.billingCycle,
            trial: cmd.trial,
            now: nowIso,
          },
          platform.stores.subscriptions,
          platform.stores.plans,
        );
      }
      return registered.status === "provisioning" ? activateTenant({ id: registered.id, now: nowIso }, platform.stores.tenants) : registered;
    });

    return { tenant, adminEmail: cmd.ownerEmail, adminPin };
  } catch (err) {
    if (err instanceof TenantCodeTakenError) throw err;
    throw new TenantProvisioningError(registered.id, err);
  }
}
