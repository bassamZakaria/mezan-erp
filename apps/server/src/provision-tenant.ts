import { generateTemporaryPassword } from "@mezan/api";
import { randomUUID } from "node:crypto";
import { activateTenant, createTenant, normalizeEmail, OwnerEmailInAnotherCompanyError, startSubscription, TenantCodeTakenError, tenantIsServed, TenantStatusCode, type BillingCycle, type Tenant } from "@mezan/domain";
import { OwnerPasswordResetOutcome, PlatformAuditUnavailableError, ProvisioningRefusalCode, TENANT_CODE_PROVISIONING, TenantOwnerAccountNotFoundError, type PlatformHandle, type RecordedActivation } from "@mezan/backend";
import { tenantDTOOf, type ProvisionResultDTO } from "@mezan/contracts";
import { TransactionMode } from "@mezan/persistence";
import type { TenantRouter } from "./tenant-router.js";
import { createLogger } from "@mezan/api";

const log = createLogger("cloud");

export interface ProvisionTenantCommand {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly ownerEmail: string;
  readonly ownerNameAr: string;
  readonly planId: string;
  readonly intendedPlanId?: string | null;
  readonly billingCycle: BillingCycle;
  readonly trial: boolean;
  readonly actorId?: string;
}

export interface ProvisionTenantDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly now: () => Date;
  readonly passwordOf?: () => string;
  readonly stillOurs?: () => Promise<boolean>;
  readonly fence?: number;
  readonly activation?: RecordedActivation;
}

export interface ProvisionTenantResult {
  readonly tenant: Tenant;
  readonly adminEmail: string;
  readonly adminPassword: string | null;
}

export function provisionResultDTOOf(result: ProvisionTenantResult): ProvisionResultDTO {
  return { tenant: tenantDTOOf(result.tenant), adminEmail: result.adminEmail, adminPassword: result.adminPassword };
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
  readonly code = ProvisioningRefusalCode.Superseded;

  constructor() {
    super("تولّى طلب آخر تجهيز هذه المنشأة");
    this.name = "ProvisioningSupersededError";
  }
}

export class TenantCodeProvisioningError extends Error {
  readonly code = TENANT_CODE_PROVISIONING;
  readonly messageEn: string;

  constructor(tenantCode: string) {
    super(`المنشأة «${tenantCode}» قيد التجهيز الآن بطلب آخر. انتظر انتهاءه ثم أعد المحاولة.`);
    this.messageEn = `Tenant "${tenantCode}" is being provisioned by another request right now. Wait for it to finish, then try again.`;
    this.name = "TenantCodeProvisioningError";
  }
}

export const PROVISIONING_ACTOR = "platform:provisioning";

export function platformActor(actorId: string): string {
  return `platform:${actorId}`;
}

export function generateOwnerPassword(): string {
  return generateTemporaryPassword();
}

// The caller is answered "nothing was saved" (503). That is made true here for
// a tenant THIS call registered: its registration and its database go, and the
// administrator password inside that database was never shown to anyone. A tenant
// that was already waiting is left for the console's retry.
async function discardUnrecorded(tenant: Tenant, deps: ProvisionTenantDeps): Promise<void> {
  const removed = await deps.platform.inTheTurn("unrecorded tenant discard", () => deps.platform.stores.tenants.discardProvisioning(tenant.id));
  if (removed) await deps.platform.outsideTheTurn(() => deps.router.discardDatabase(tenant));
}

interface TenantSide {
  readonly adminPassword: string | null;
}

// REQUIRED: the tenant's database is not the platform's connection. Each call
// into it hands the platform turn back; the fence between them is a platform
// write and is made with the turn held.
async function prepareTenantDatabase(cmd: ProvisionTenantCommand, tenant: Tenant, deps: ProvisionTenantDeps, stillOurs: () => Promise<void>, nowIso: string): Promise<TenantSide> {
  const { platform } = deps;
  const passwordOf = deps.passwordOf ?? generateOwnerPassword;
  const backend = await deps.router.backendOf(tenant.id);

  await platform.outsideTheTurn(async () => backend.app.fetch(new Request("http://tenant.internal/bootstrap/seed", { method: "POST" })));

  const statusRes = await platform.outsideTheTurn(async () => backend.app.fetch(new Request("http://tenant.internal/bootstrap/status")));
  const { claimed } = (await statusRes.json()) as { claimed: boolean };

  await stillOurs();
  if (claimed && tenant.status !== TenantStatusCode.Provisioning) throw new TenantCodeTakenError(cmd.code);
  if (!claimed) {
    const adminRes = await platform.outsideTheTurn(async () =>
      backend.app.fetch(
        new Request("http://tenant.internal/bootstrap/admin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nameAr: cmd.ownerNameAr, email: cmd.ownerEmail, password: generateOwnerPassword(), companyName: cmd.nameAr }),
        }),
      ),
    );
    if (adminRes.status !== 201) {
      throw new Error(`bootstrap/admin responded ${adminRes.status}`);
    }
  }
  // SECURITY: /bootstrap/admin saves the password as the owner's own choice; the
  // owner's handed-out password is set only here, through the reset, which marks
  // it temporary. Every provisioning password is fenced: a caller with no claim
  // of its own (the console) takes a fresh fence, newer than any signup claim
  // still in flight.
  const freshPassword = passwordOf();
  const fence = deps.fence ?? (await platform.inTheTurn("provisioning fence", () => platform.stores.signupRequests.takeProvisionFence(nowIso)));
  const outcome = await platform.outsideTheTurn(() =>
    backend.resetOwnerPassword({
      email: cmd.ownerEmail,
      password: freshPassword,
      onlyIfNeverSignedIn: true,
      actor: cmd.actorId ? platformActor(cmd.actorId) : PROVISIONING_ACTOR,
      fence,
    }),
  );
  if (outcome === OwnerPasswordResetOutcome.Superseded) throw new ProvisioningSupersededError();
  if (outcome === OwnerPasswordResetOutcome.OwnerNotFound || outcome === OwnerPasswordResetOutcome.OwnerVanished) throw new TenantOwnerAccountNotFoundError();
  return { adminPassword: outcome === OwnerPasswordResetOutcome.Reset ? freshPassword : null };
}

const codesInFlight = new WeakMap<object, Set<string>>();

// REQUIRED: one provisioning per code at a time among callers that hold no
// signup claim (the console). A second one would otherwise adopt a
// registration the first is about to discard, and be answered about a tenant
// that no longer exists. A caller that holds a claim (`stillOurs`) is ordered
// by that claim and its fence instead, across processes, and never waits here.
export async function provisionTenant(cmd: ProvisionTenantCommand, deps: ProvisionTenantDeps): Promise<ProvisionTenantResult> {
  if (deps.stillOurs) return provisionUnderItsClaim(cmd, deps);
  const key = deps.platform.stores;
  const inFlight = codesInFlight.get(key) ?? new Set<string>();
  codesInFlight.set(key, inFlight);
  if (inFlight.has(cmd.code)) throw new TenantCodeProvisioningError(cmd.code);
  inFlight.add(cmd.code);
  try {
    return await provisionUnderItsClaim(cmd, deps);
  } finally {
    inFlight.delete(cmd.code);
  }
}

async function provisionUnderItsClaim(cmd: ProvisionTenantCommand, deps: ProvisionTenantDeps): Promise<ProvisionTenantResult> {
  const nowIso = deps.now().toISOString();
  const { platform } = deps;
  const { tenants, subscriptions, plans, db } = platform.stores;
  const holder = await platform.stores.signInEmails.tenantOf(cmd.ownerEmail);
  const holding = holder ? await tenants.findById(holder) : null;
  if (holding && holding.code !== cmd.code && tenantIsServed(holding)) throw new OwnerEmailInAnotherCompanyError();

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
    const { adminPassword } = await prepareTenantDatabase(cmd, registered, deps, stillOurs, nowIso);

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
      db.transaction(
        async () => {
          await stillProvisionable();
          if (live || (await subscriptions.findLiveByTenant(registered.id))) return;
          await startSubscription(
            { id: randomUUID(), tenantId: registered.id, planId: cmd.planId, intendedPlanId: cmd.intendedPlanId ?? null, billingCycle: cmd.billingCycle, trial: cmd.trial, now: nowIso },
            subscriptions,
            plans,
          );
        },
        TransactionMode.Immediate,
      ),
    );

    await deps.router
      .reconcileOwnerOf(registered.id)
      .catch((err: unknown) => log.error({ err: err }, `owner of "${registered.code}" could not be linked while provisioning`));

    // REQUIRED ORDERING: the activation and the event that records it are one
    // write; `recorded` runs inside the transaction that re-checks the claim.
    const recorded: RecordedActivation = deps.activation ?? ((activate) => activate());
    const tenant = await platform.inTheTurn("tenant activation", () =>
      db.transaction(
        () =>
          recorded(async () => {
            const latest = await stillProvisionable();
            return latest.status === TenantStatusCode.Provisioning ? activateTenant({ id: latest.id, now: nowIso }, tenants) : latest;
          }),
        TransactionMode.Immediate,
      ),
    );

    return { tenant, adminEmail: cmd.ownerEmail, adminPassword };
  } catch (err) {
    if (err instanceof PlatformAuditUnavailableError && registeredByThisCall) await discardUnrecorded(registered, deps);
    if (err instanceof TenantCodeTakenError || err instanceof ProvisioningSupersededError || err instanceof PlatformAuditUnavailableError) throw err;
    if (deps.stillOurs && !(await deps.stillOurs().catch(() => true))) throw new ProvisioningSupersededError();
    throw new TenantProvisioningError(registered.id, err);
  }
}
