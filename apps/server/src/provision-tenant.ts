import { randomInt, randomUUID } from "node:crypto";
import { activateTenant, createTenant, normalizeEmail, startSubscription, TenantCodeTakenError, TenantStatusCode, type BillingCycle, type Tenant } from "@mezan/domain";
import { OwnerPinResetOutcome, PlatformAuditUnavailableError, TenantOwnerAccountNotFoundError, type PlatformHandle, type RecordedActivation } from "@mezan/backend";
import { tenantDTOOf, type ProvisionResultDTO } from "@mezan/contracts";
import { withSqliteTransaction } from "@mezan/persistence";
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
  readonly actorId?: string;
}

export interface ProvisionTenantDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly now: () => Date;
  readonly pinOf?: () => string;
  readonly stillOurs?: () => Promise<boolean>;
  readonly fence?: number;
  readonly activation?: RecordedActivation;
}

export interface ProvisionTenantResult {
  readonly tenant: Tenant;
  readonly adminEmail: string;
  readonly adminPin: string | null;
}

export function provisionResultDTOOf(result: ProvisionTenantResult): ProvisionResultDTO {
  return { tenant: tenantDTOOf(result.tenant), adminEmail: result.adminEmail, adminPin: result.adminPin };
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

export class ProvisioningSupersededError extends Error {
  readonly code = "PROVISIONING_SUPERSEDED";

  constructor() {
    super("تولّى طلب آخر تجهيز هذه المنشأة");
    this.name = "ProvisioningSupersededError";
  }
}

export const PROVISIONING_ACTOR = "platform:provisioning";

export function platformActor(actorId: string): string {
  return `platform:${actorId}`;
}

export function generateOwnerPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// The caller is answered "nothing was saved" (503). That is made true here for
// a tenant THIS call registered: its registration and its database go, and the
// administrator PIN inside that database was never shown to anyone. A tenant
// that was already waiting is left for the console's retry.
async function discardUnrecorded(tenant: Tenant, deps: ProvisionTenantDeps): Promise<void> {
  const removed = await deps.platform.inTheTurn("unrecorded tenant discard", () => deps.platform.stores.tenants.discardProvisioning(tenant.id));
  if (removed) await deps.platform.outsideTheTurn(() => deps.router.discardDatabase(tenant));
}

interface TenantSide {
  readonly adminPin: string | null;
}

// REQUIRED: the tenant's database is not the platform's connection. Each call
// into it hands the platform turn back; the fence between them is a platform
// write and is made with the turn held.
async function prepareTenantDatabase(cmd: ProvisionTenantCommand, tenant: Tenant, deps: ProvisionTenantDeps, stillOurs: () => Promise<void>, nowIso: string): Promise<TenantSide> {
  const { platform } = deps;
  const pinOf = deps.pinOf ?? generateOwnerPin;
  const backend = await deps.router.backendOf(tenant.id);

  await platform.outsideTheTurn(async () => backend.app.fetch(new Request("http://tenant.internal/bootstrap/seed", { method: "POST" })));

  const statusRes = await platform.outsideTheTurn(async () => backend.app.fetch(new Request("http://tenant.internal/bootstrap/status")));
  const { claimed } = (await statusRes.json()) as { claimed: boolean };

  await stillOurs();
  if (claimed) {
    if (tenant.status !== TenantStatusCode.Provisioning) throw new TenantCodeTakenError(cmd.code);
    const freshPin = pinOf();
    // SECURITY: every provisioning PIN is fenced. A caller with no claim of
    // its own (the console) takes a fresh fence here, newer than any signup
    // claim still in flight.
    const fence = deps.fence ?? (await platform.inTheTurn("provisioning fence", () => platform.stores.signupRequests.takeProvisionFence(nowIso)));
    const outcome = await platform.outsideTheTurn(() =>
      backend.resetOwnerPin({
        email: cmd.ownerEmail,
        pin: freshPin,
        onlyIfNeverSignedIn: true,
        actor: cmd.actorId ? platformActor(cmd.actorId) : PROVISIONING_ACTOR,
        fence,
      }),
    );
    if (outcome === OwnerPinResetOutcome.Superseded) throw new ProvisioningSupersededError();
    if (outcome === OwnerPinResetOutcome.OwnerNotFound || outcome === OwnerPinResetOutcome.OwnerVanished) throw new TenantOwnerAccountNotFoundError();
    return { adminPin: outcome === OwnerPinResetOutcome.Reset ? freshPin : null };
  }
  const adminPin = pinOf();
  const adminRes = await platform.outsideTheTurn(async () =>
    backend.app.fetch(
      new Request("http://tenant.internal/bootstrap/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nameAr: cmd.ownerNameAr, email: cmd.ownerEmail, pin: adminPin, companyName: cmd.nameAr }),
      }),
    ),
  );
  if (adminRes.status !== 201) {
    throw new Error(`bootstrap/admin responded ${adminRes.status}`);
  }
  return { adminPin };
}

export async function provisionTenant(cmd: ProvisionTenantCommand, deps: ProvisionTenantDeps): Promise<ProvisionTenantResult> {
  const nowIso = deps.now().toISOString();
  const { platform } = deps;
  const { tenants, subscriptions, plans, sqlite } = platform.stores;

  const stillOurs = async (): Promise<void> => {
    if (deps.stillOurs && !(await deps.stillOurs())) throw new ProvisioningSupersededError();
  };

  const { registered, registeredByThisCall } = await platform.inTheTurn("tenant registration", async () => {
    const existing = await tenants.findByCode(cmd.code);
    if (existing && existing.ownerEmail !== normalizeEmail(cmd.ownerEmail)) throw new TenantCodeTakenError(cmd.code);
    if (existing) return { registered: existing, registeredByThisCall: false };
    const created = await createTenant(
      { id: randomUUID(), code: cmd.code, nameAr: cmd.nameAr, nameEn: cmd.nameEn, ownerEmail: cmd.ownerEmail, now: nowIso },
      tenants,
    );
    return { registered: created, registeredByThisCall: true };
  });

  try {
    const { adminPin } = await prepareTenantDatabase(cmd, registered, deps, stillOurs, nowIso);

    // REQUIRED ORDERING: each platform write re-checks the claim and the
    // tenant's status inside the write transaction that makes it. A release
    // that archived the tenant meanwhile must find nothing started after it.
    const stillProvisionable = async (): Promise<Tenant> => {
      await stillOurs();
      const latest = await tenants.findById(registered.id);
      if (!latest || latest.status === TenantStatusCode.Archived) throw new ProvisioningSupersededError();
      return latest;
    };
    const live = await subscriptions.findLiveByTenant(registered.id);
    // REQUIRED ORDERING: checked once more BEFORE the write transaction opens.
    // A holder that already lost its claim must not take the write lock at all:
    // the holder that superseded it is about to need it.
    await stillOurs();
    await platform.inTheTurn("tenant subscription", () =>
      withSqliteTransaction(
        sqlite,
        async () => {
          await stillProvisionable();
          if (live || (await subscriptions.findLiveByTenant(registered.id))) return;
          await startSubscription(
            { id: randomUUID(), tenantId: registered.id, planId: cmd.planId, billingCycle: cmd.billingCycle, trial: cmd.trial, now: nowIso },
            subscriptions,
            plans,
          );
        },
        "BEGIN IMMEDIATE",
      ),
    );

    await deps.router
      .reconcileOwnerOf(registered.id)
      .catch((err: unknown) => console.error(`[cloud] owner of "${registered.code}" could not be linked while provisioning`, err));

    // REQUIRED ORDERING: the activation and the event that records it are one
    // write; `recorded` runs inside the transaction that re-checks the claim.
    const recorded: RecordedActivation = deps.activation ?? ((activate) => activate());
    const tenant = await platform.inTheTurn("tenant activation", () =>
      withSqliteTransaction(
        sqlite,
        () =>
          recorded(async () => {
            const latest = await stillProvisionable();
            return latest.status === TenantStatusCode.Provisioning ? activateTenant({ id: latest.id, now: nowIso }, tenants) : latest;
          }),
        "BEGIN IMMEDIATE",
      ),
    );

    return { tenant, adminEmail: cmd.ownerEmail, adminPin };
  } catch (err) {
    if (err instanceof PlatformAuditUnavailableError && registeredByThisCall) await discardUnrecorded(registered, deps);
    if (err instanceof TenantCodeTakenError || err instanceof ProvisioningSupersededError || err instanceof PlatformAuditUnavailableError) throw err;
    if (deps.stillOurs && !(await deps.stillOurs().catch(() => true))) throw new ProvisioningSupersededError();
    throw new TenantProvisioningError(registered.id, err);
  }
}
