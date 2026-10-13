import { randomInt, randomUUID } from "node:crypto";
import { activateTenant, createTenant, startSubscription, TenantCodeTakenError, type BillingCycle, type Tenant } from "@mezan/domain";
import { PlatformAuditUnavailableError, type PlatformHandle, type RecordedActivation } from "@mezan/backend";
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
  readonly activation?: RecordedActivation;
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

// The caller is answered "nothing was saved" (503). That is made true here for
// a tenant THIS call registered: its registration and its database go, and the
// administrator PIN inside that database was never shown to anyone. A tenant
// that was already waiting is left for the console's retry.
async function discardUnrecorded(tenant: Tenant, deps: ProvisionTenantDeps): Promise<void> {
  const removed = await deps.platform.inTheTurn("unrecorded tenant discard", () => deps.platform.stores.tenants.discardProvisioning(tenant.id));
  if (removed) await deps.router.discardDatabase(tenant);
}

export async function provisionTenant(cmd: ProvisionTenantCommand, deps: ProvisionTenantDeps): Promise<ProvisionTenantResult> {
  const nowIso = deps.now().toISOString();
  const { platform } = deps;

  const { registered, registeredByThisCall } = await platform.inTheTurn("tenant registration", async () => {
    const existing = await platform.stores.tenants.findByCode(cmd.code);
    if (existing) return { registered: existing, registeredByThisCall: false };
    const created = await createTenant(
      { id: randomUUID(), code: cmd.code, nameAr: cmd.nameAr, nameEn: cmd.nameEn, ownerEmail: cmd.ownerEmail, now: nowIso },
      platform.stores.tenants,
    );
    return { registered: created, registeredByThisCall: true };
  });

  try {
    const { adminPin } = await platform.outsideTheTurn(() => prepareTenantDatabase(cmd, registered, deps));

    const recorded: RecordedActivation = deps.activation ?? ((activate) => activate());
    const tenant = await platform.inTheTurn("tenant activation", () => recorded(async () => {
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
    }));

    return { tenant, adminEmail: cmd.ownerEmail, adminPin };
  } catch (err) {
    if (err instanceof PlatformAuditUnavailableError && registeredByThisCall) await discardUnrecorded(registered, deps);
    if (err instanceof TenantCodeTakenError || err instanceof PlatformAuditUnavailableError) throw err;
    throw new TenantProvisioningError(registered.id, err);
  }
}
