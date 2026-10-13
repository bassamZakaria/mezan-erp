import { describe, it, expect, afterEach } from "vitest";
import { drainForeignWrites } from "@mezan/persistence";
import { createSessionRegistry } from "@mezan/api";
import {
  activateTenant,
  CardPaymentNotApplicableError,
  createPlatformUser,
  createTenant,
  Money,
  startSubscription,
  CardCheckoutResolution,
  CardCheckoutStatus,
  PlanKind,
  type CardCheckout,
} from "@mezan/domain";
import type { CreateTenantRequestDTO, ProvisionResultDTO, ProvisionRetryRequestDTO } from "@mezan/contracts";
import { createPlatform, type PlatformHandle } from "./create-platform.js";
import { createPlatformAuth, type PlatformAuth } from "./platform-auth.js";
import { createPlatformRoutes, serializeCardCheckout, serializeCardCheckoutForTenant, type PlatformCardCheckoutPort, type RecordedActivation } from "./platform-routes.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00Z");

const platforms: PlatformHandle[] = [];
afterEach(() => {
  for (const p of platforms.splice(0)) p.close();
});

async function json(res: Response) {
  return res.json();
}

interface Rig {
  readonly platform: PlatformHandle;
  readonly auth: PlatformAuth;
  readonly app: ReturnType<typeof createPlatformRoutes>;
  readonly ownerToken: string;
  readonly supportToken: string;
  readonly invalidated: string[];
  readonly provisioned: Array<CreateTenantRequestDTO & { actorId: string }>;
}

async function buildRig(): Promise<Rig> {
  const platform = await createPlatform({ dbPath: ":memory:", now: FIXED_NOW });
  platforms.push(platform);

  await createPlatformUser(
    { id: "PU-OWNER", email: "owner@mezan.app", password: "correct horse battery", role: "owner", now: "2026-01-01T00:00:00.000Z" },
    platform.stores.platformUsers,
    platform.hasher,
  );
  await createPlatformUser(
    { id: "PU-SUPPORT", email: "support@mezan.app", password: "correct horse battery", role: "support", now: "2026-01-01T00:00:00.000Z" },
    platform.stores.platformUsers,
    platform.hasher,
  );

  const sessions = createSessionRegistry();
  const auth = createPlatformAuth({ platform, sessions, now: FIXED_NOW });

  async function login(email: string): Promise<string> {
    const res = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "correct horse battery" }),
      }),
    );
    return ((await json(res)) as { token: string }).token;
  }

  const invalidated: string[] = [];
  const provisioned: Array<CreateTenantRequestDTO & { actorId: string }> = [];
  let idCounter = 0;
  const idOf = () => `ID-${++idCounter}`;

  const provisionTenant = async (cmd: CreateTenantRequestDTO & { actorId: string }, activation: RecordedActivation): Promise<ProvisionResultDTO> => {
    provisioned.push(cmd);
    const nowIso = FIXED_NOW().toISOString();
    const tenant = await createTenant(
      { id: idOf(), code: cmd.code, nameAr: cmd.nameAr, nameEn: cmd.nameEn ?? null, ownerEmail: cmd.ownerEmail, now: nowIso },
      platform.stores.tenants,
    );
    const active = await activation(async () => {
      await startSubscription(
        { id: idOf(), tenantId: tenant.id, planId: cmd.planId, billingCycle: cmd.billingCycle, trial: cmd.trial, now: nowIso },
        platform.stores.subscriptions,
        platform.stores.plans,
      );
      return activateTenant({ id: tenant.id, now: nowIso }, platform.stores.tenants);
    });
    return { tenant: active, adminEmail: cmd.ownerEmail, adminPin: "482913" };
  };

  const provisionRetry = async (
    { tenantId, planId, billingCycle, trial }: { tenantId: string } & ProvisionRetryRequestDTO,
    activation: RecordedActivation,
  ): Promise<ProvisionResultDTO> => {
    const nowIso = FIXED_NOW().toISOString();
    const tenant = await activation(async () => {
      const live = await platform.stores.subscriptions.findLiveByTenant(tenantId);
      if (!live) {
        await startSubscription(
          { id: idOf(), tenantId, planId: planId ?? "PLAN-CORE", billingCycle: billingCycle ?? "monthly", trial: trial ?? false, now: nowIso },
          platform.stores.subscriptions,
          platform.stores.plans,
        );
      }
      return activateTenant({ id: tenantId, now: nowIso }, platform.stores.tenants);
    });
    return { tenant, adminEmail: tenant.ownerEmail, adminPin: null };
  };

  const app = createPlatformRoutes({
    platform,
    auth,
    now: FIXED_NOW,
    provisionTenant,
    provisionRetry,
    invalidateEntitlements: (code: string) => { invalidated.push(code); },
    idOf,
  });

  return { platform, auth, app, ownerToken: await login("owner@mezan.app"), supportToken: await login("support@mezan.app"), invalidated, provisioned };
}

function req(path: string, token: string, init: RequestInit = {}) {
  return new Request(`http://x${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

async function plans(rig: Rig) {
  const res = await rig.app.fetch(req("/plans", rig.ownerToken));
  return (await json(res)) as Array<{ id: string; code: string }>;
}

async function provisionOne(rig: Rig, overrides: Partial<CreateTenantRequestDTO> = {}) {
  const planList = await plans(rig);
  const corePlan = planList.find((p) => p.code === "core")!;
  const body: CreateTenantRequestDTO = {
    code: "acme",
    nameAr: "شركة أكمي",
    ownerEmail: "acme-owner@example.com",
    ownerNameAr: "مالك أكمي",
    planId: corePlan.id,
    billingCycle: "monthly",
    trial: false,
    ...overrides,
  };
  const res = await rig.app.fetch(req("/tenants", rig.ownerToken, { method: "POST", body: JSON.stringify(body) }));
  return { res, body: (await json(res)) as ProvisionResultDTO, planId: corePlan.id };
}

describe("createPlatformRoutes", () => {
  it("lists tenants and returns a full summary for one, including licenseState and entitlements", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    expect(body.adminPin).toBe("482913");
    expect(rig.provisioned).toHaveLength(1);

    const listRes = await rig.app.fetch(req("/tenants", rig.ownerToken));
    expect(listRes.status).toBe(200);
    const list = (await json(listRes)) as Array<{ tenant: { code: string } }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.tenant.code).toBe("acme");

    const detailRes = await rig.app.fetch(req(`/tenants/${body.tenant.id}`, rig.ownerToken));
    expect(detailRes.status).toBe(200);
    const detail = (await json(detailRes)) as {
      licenseState: { state: string; canWrite: boolean };
      entitlements: { plan: string; activeModules: string[] } | null;
      subscription: { status: string } | null;
      payments: unknown[];
    };
    expect(detail.licenseState.state).toBe("ACTIVE");
    expect(detail.licenseState.canWrite).toBe(true);
    expect(detail.subscription?.status).toBe("active");
    expect(detail.entitlements?.plan).toBe("core");
    expect(detail.entitlements?.activeModules).toContain("sales");
    expect(detail.payments).toEqual([]);
  });

  it("404s an unknown tenant", async () => {
    const rig = await buildRig();
    const res = await rig.app.fetch(req("/tenants/ghost", rig.ownerToken));
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: "TENANT_NOT_FOUND" });
  });

  it("suspends, resumes and archives a tenant, invalidating entitlements and writing audit rows each time", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const id = body.tenant.id;

    const suspendRes = await rig.app.fetch(req(`/tenants/${id}/suspend`, rig.ownerToken, { method: "POST" }));
    expect(suspendRes.status).toBe(200);
    expect(((await json(suspendRes)) as { tenant: { status: string } }).tenant.status).toBe("suspended");

    const resumeRes = await rig.app.fetch(req(`/tenants/${id}/resume`, rig.ownerToken, { method: "POST" }));
    expect(resumeRes.status).toBe(200);
    expect(((await json(resumeRes)) as { tenant: { status: string } }).tenant.status).toBe("active");

    const archiveRes = await rig.app.fetch(req(`/tenants/${id}/archive`, rig.ownerToken, { method: "POST" }));
    expect(archiveRes.status).toBe(200);
    expect(((await json(archiveRes)) as { tenant: { status: string } }).tenant.status).toBe("archived");

    expect(rig.invalidated).toEqual(["acme", "acme", "acme", "acme"]);

    const rows = await rig.platform.audit.query("security");
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("TENANT_SUSPENDED");
    expect(actions).toContain("TENANT_RESUMED");
    expect(actions).toContain("TENANT_ARCHIVED");
    expect(rows.every((r) => r.module === "platform" && r.stream === "security")).toBe(true);
    expect(rows.find((r) => r.action === "TENANT_SUSPENDED")?.actor).toBe("PU-OWNER");
  });

  it("refuses a transition that is not legal with 409", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const id = body.tenant.id;
    const res = await rig.app.fetch(req(`/tenants/${id}/resume`, rig.ownerToken, { method: "POST" }));
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: "INVALID_TENANT_TRANSITION" });
  });

  it("changes plan, cancels, suspends and resumes a subscription", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const id = body.tenant.id;
    const planList = await plans(rig);
    const businessPlan = planList.find((p) => p.code === "business")!;

    const changeRes = await rig.app.fetch(
      req(`/tenants/${id}/subscription/change-plan`, rig.ownerToken, { method: "POST", body: JSON.stringify({ planId: businessPlan.id }) }),
    );
    expect(changeRes.status).toBe(200);
    expect(((await json(changeRes)) as { subscription: { planId: string } }).subscription.planId).toBe(businessPlan.id);

    const suspendRes = await rig.app.fetch(
      req(`/tenants/${id}/subscription/suspend`, rig.ownerToken, { method: "POST", body: JSON.stringify({ reason: "non-payment" }) }),
    );
    expect(suspendRes.status).toBe(200);
    expect(((await json(suspendRes)) as { subscription: { status: string } }).subscription.status).toBe("suspended");

    const resumeRes = await rig.app.fetch(
      req(`/tenants/${id}/subscription/resume`, rig.ownerToken, { method: "POST", body: JSON.stringify({ reason: "payment received" }) }),
    );
    expect(resumeRes.status).toBe(200);
    expect(((await json(resumeRes)) as { subscription: { status: string } }).subscription.status).toBe("active");

    const rows = await rig.platform.audit.query("security");
    expect(rows.find((r) => r.action === "SUBSCRIPTION_SUSPENDED")?.details).toMatchObject({ reason: "non-payment" });
    expect(rows.find((r) => r.action === "SUBSCRIPTION_RESUMED")?.details).toMatchObject({ reason: "payment received" });

    const cancelRes = await rig.app.fetch(req(`/tenants/${id}/subscription/cancel`, rig.ownerToken, { method: "POST" }));
    expect(cancelRes.status).toBe(200);
    expect(((await json(cancelRes)) as { subscription: unknown }).subscription).toBeNull();
  });

  it("refuses a subscription suspend/resume with no reason", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const id = body.tenant.id;

    const suspendRes = await rig.app.fetch(req(`/tenants/${id}/subscription/suspend`, rig.ownerToken, { method: "POST", body: JSON.stringify({}) }));
    expect(suspendRes.status).toBe(400);
    expect(await json(suspendRes)).toMatchObject({ error: "VALIDATION_ERROR" });

    const resumeRes = await rig.app.fetch(req(`/tenants/${id}/subscription/resume`, rig.ownerToken, { method: "POST", body: JSON.stringify({ reason: "  " }) }));
    expect(resumeRes.status).toBe(400);
    expect(await json(resumeRes)).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("404s subscription mutations when the tenant has no live subscription", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const id = body.tenant.id;
    await rig.app.fetch(req(`/tenants/${id}/subscription/cancel`, rig.ownerToken, { method: "POST" }));
    const res = await rig.app.fetch(req(`/tenants/${id}/subscription/cancel`, rig.ownerToken, { method: "POST" }));
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: "SUBSCRIPTION_NOT_FOUND" });
  });

  it("records a payment, advancing the subscription's current period end", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const id = body.tenant.id;

    const before = (await json(await rig.app.fetch(req(`/tenants/${id}`, rig.ownerToken)))) as { subscription: { currentPeriodEnd: string } };

    const payRes = await rig.app.fetch(
      req(`/tenants/${id}/payments`, rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ amount: "500.00", reference: "REF-1", paidAt: "2026-01-01T00:00:00.000Z", idempotencyKey: "KEY-0001" }),
      }),
    );
    expect(payRes.status).toBe(201);
    const after = (await json(payRes)) as { subscription: { currentPeriodEnd: string }; payments: Array<{ reference: string }> };
    expect(after.subscription.currentPeriodEnd > before.subscription.currentPeriodEnd).toBe(true);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]?.reference).toBe("REF-1");

    const listRes = await rig.app.fetch(req(`/tenants/${id}/payments`, rig.ownerToken));
    expect(listRes.status).toBe(200);
    const list = (await json(listRes)) as Array<{ amount: string; reference: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ amount: "500.000000", reference: "REF-1" });

    const rows = await rig.platform.audit.query("security");
    expect(rows.some((r) => r.action === "PAYMENT_RECORDED")).toBe(true);
    expect(rig.invalidated).toContain("acme");
    expect(rig.invalidated.filter((code) => code === "acme").length).toBeGreaterThanOrEqual(2);
  });

  function payer(rig: Awaited<ReturnType<typeof buildRig>>, id: string) {
    return (body: { amount?: string; reference?: string; idempotencyKey: string; confirmDuplicateReference?: boolean }) =>
      rig.app.fetch(
        req(`/tenants/${id}/payments`, rig.ownerToken, {
          method: "POST",
          body: JSON.stringify({ amount: "500.00", reference: "REF-1", paidAt: "2026-01-01T00:00:00.000Z", ...body }),
        }),
      );
  }
  const recordedEvents = async (rig: Awaited<ReturnType<typeof buildRig>>) =>
    (await rig.platform.audit.query("security")).filter((r) => r.action === "PAYMENT_RECORDED");

  it("answers a resubmission of the same payment without renewing or auditing again", async () => {
    const rig = await buildRig();
    const id = (await provisionOne(rig)).body.tenant.id;
    const pay = payer(rig, id);

    const first = await pay({ idempotencyKey: "KEY-0001" });
    const second = await pay({ idempotencyKey: "KEY-0001" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstBody = (await json(first)) as { subscription: { currentPeriodEnd: string } };
    const secondBody = (await json(second)) as { subscription: { currentPeriodEnd: string }; payments: unknown[] };
    expect(secondBody.subscription.currentPeriodEnd).toBe(firstBody.subscription.currentPeriodEnd);
    expect(secondBody.payments).toHaveLength(1);
    expect(await recordedEvents(rig)).toHaveLength(1);
  });

  it("refuses a second, separate payment under a recorded reference instead of reporting it saved", async () => {
    const rig = await buildRig();
    const id = (await provisionOne(rig)).body.tenant.id;
    const pay = payer(rig, id);
    const first = (await json(await pay({ idempotencyKey: "KEY-0001" }))) as { subscription: { currentPeriodEnd: string }; payments: { id: string }[] };

    const res = await pay({ idempotencyKey: "KEY-0002" });

    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      error: "PAYMENT_REFERENCE_ALREADY_RECORDED",
      message: expect.stringMatching(/المرجع "REF-1" مسجَّل من قبل لهذه المنشأة بتاريخ \d{4}-\d{2}-\d{2} بمبلغ 500\.00 ج\.م/),
      messageEn: expect.stringContaining("REF-1"),
      details: { reference: "REF-1", paymentId: first.payments[0]!.id, amount: "500.000000", recordedAt: expect.any(String) },
    });
    expect(await rig.platform.stores.payments.listByTenant(id)).toHaveLength(1);
    const after = (await json(await rig.app.fetch(req(`/tenants/${id}`, rig.ownerToken)))) as { subscription: { currentPeriodEnd: string } };
    expect(after.subscription.currentPeriodEnd).toBe(first.subscription.currentPeriodEnd);
    expect(await recordedEvents(rig)).toHaveLength(1);
  });

  it("records the second payment once the duplicate reference is confirmed, renews again and says so in the audit event", async () => {
    const rig = await buildRig();
    const id = (await provisionOne(rig)).body.tenant.id;
    const pay = payer(rig, id);
    const first = (await json(await pay({ idempotencyKey: "KEY-0001" }))) as { subscription: { currentPeriodEnd: string }; payments: { id: string }[] };
    await pay({ idempotencyKey: "KEY-0002" });

    const confirmed = await pay({ idempotencyKey: "KEY-0002", confirmDuplicateReference: true });

    expect(confirmed.status).toBe(201);
    const body = (await json(confirmed)) as { subscription: { currentPeriodEnd: string }; payments: unknown[] };
    expect(body.payments).toHaveLength(2);
    expect(body.subscription.currentPeriodEnd > first.subscription.currentPeriodEnd).toBe(true);
    const events = await recordedEvents(rig);
    expect(events).toHaveLength(2);
    expect(events.some((event) => event.details?.["duplicateOfPaymentId"] === first.payments[0]!.id)).toBe(true);
    expect((await pay({ idempotencyKey: "KEY-0002", confirmDuplicateReference: true })).status).toBe(200);
    expect(await rig.platform.stores.payments.listByTenant(id)).toHaveLength(2);
  });

  it("400s a payment sent with no idempotency key", async () => {
    const rig = await buildRig();
    const id = (await provisionOne(rig)).body.tenant.id;
    const res = await rig.app.fetch(
      req(`/tenants/${id}/payments`, rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ amount: "500.00", reference: "REF-1", paidAt: "2026-01-01T00:00:00.000Z" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await rig.platform.stores.payments.listByTenant(id)).toHaveLength(0);
  });

  it("records no payment when its audit event cannot be written, so the retry is a first submission and not a replay", async () => {
    const rig = await buildRig();
    const id = (await provisionOne(rig)).body.tenant.id;
    const before = (await json(await rig.app.fetch(req(`/tenants/${id}`, rig.ownerToken)))) as { subscription: { currentPeriodEnd: string } };
    const pay = () =>
      rig.app.fetch(
        req(`/tenants/${id}/payments`, rig.ownerToken, {
          method: "POST",
          body: JSON.stringify({ amount: "500.00", reference: "REF-1", paidAt: "2026-01-01T00:00:00.000Z", idempotencyKey: "KEY-0001" }),
        }),
      );
    const append = rig.platform.audit.append.bind(rig.platform.audit);
    let failures = 1;
    rig.platform.audit.append = async (event) => {
      if (event.action === "PAYMENT_RECORDED" && failures > 0) {
        failures -= 1;
        throw new Error("audit sink unavailable");
      }
      await append(event);
    };

    const refused = await pay();

    expect(refused.status).toBe(503);
    expect(await json(refused)).toMatchObject({ error: "AUDIT_UNAVAILABLE", messageEn: expect.any(String) });
    expect(await rig.platform.stores.payments.listByTenant(id)).toHaveLength(0);
    const after = (await json(await rig.app.fetch(req(`/tenants/${id}`, rig.ownerToken)))) as { subscription: { currentPeriodEnd: string } };
    expect(after.subscription.currentPeriodEnd).toBe(before.subscription.currentPeriodEnd);

    const retried = await pay();

    expect(retried.status).toBe(201);
    expect(await rig.platform.stores.payments.listByTenant(id)).toHaveLength(1);
    const recorded = (await rig.platform.audit.query("security")).filter((r) => r.action === "PAYMENT_RECORDED");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.actor).toBe("PU-OWNER");
    expect(recorded[0]?.details).toMatchObject({ reference: "REF-1" });
  });

  it("409s the same submission resent with a different amount, and changes nothing", async () => {
    const rig = await buildRig();
    const id = (await provisionOne(rig)).body.tenant.id;
    const pay = payer(rig, id);
    await pay({ idempotencyKey: "KEY-0001" });

    const res = await pay({ idempotencyKey: "KEY-0001", amount: "750.00" });

    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: "PAYMENT_IDEMPOTENCY_CONFLICT", message: expect.any(String), messageEn: expect.any(String) });
    expect(await rig.platform.stores.payments.listByTenant(id)).toHaveLength(1);
  });

  it("creates, updates (ignoring code) and retires a plan", async () => {
    const rig = await buildRig();
    const createRes = await rig.app.fetch(
      req("/plans", rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({
          code: "starter", nameAr: "المبتدئة", nameEn: "Starter", modules: ["sales"],
          seatsIncluded: 1, branchesIncluded: 1, warehousesIncluded: 1,
          priceMonthly: "100.00", priceYearly: "1000.00", trialDays: 7, isPublic: true, sortOrder: 0,
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await json(createRes)) as { id: string; code: string; priceMonthly: string };
    expect(created.code).toBe("starter");
    expect(created.priceMonthly).toBe("100.000000");

    const updateRes = await rig.app.fetch(
      req(`/plans/${created.id}`, rig.ownerToken, {
        method: "PUT",
        body: JSON.stringify({
          code: "ignored-code", nameAr: "المبتدئة الجديدة", nameEn: "Starter", modules: ["sales"],
          seatsIncluded: 2, branchesIncluded: 1, warehousesIncluded: 1,
          priceMonthly: "150.00", priceYearly: "1500.00", trialDays: 7, isPublic: true, sortOrder: 0,
        }),
      }),
    );
    expect(updateRes.status).toBe(200);
    const updated = (await json(updateRes)) as { code: string; nameAr: string; seatsIncluded: number };
    expect(updated.code).toBe("starter");
    expect(updated.nameAr).toBe("المبتدئة الجديدة");
    expect(updated.seatsIncluded).toBe(2);

    const retireRes = await rig.app.fetch(req(`/plans/${created.id}/retire`, rig.ownerToken, { method: "POST" }));
    expect(retireRes.status).toBe(200);
    expect(((await json(retireRes)) as { status: string }).status).toBe("retired");
  });

  it("422s an invalid plan (an unknown module)", async () => {
    const rig = await buildRig();
    const res = await rig.app.fetch(
      req("/plans", rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({
          code: "bogus", nameAr: "باقة", nameEn: "Bogus", modules: ["not-a-real-module"],
          seatsIncluded: 1, branchesIncluded: 1, warehousesIncluded: 1,
          priceMonthly: "0", priceYearly: "0", trialDays: 0, isPublic: true, sortOrder: 0,
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(await json(res)).toMatchObject({ error: "INVALID_PLAN" });
  });

  it("creates a platform user (owner only) and deactivates one", async () => {
    const rig = await buildRig();
    const createRes = await rig.app.fetch(
      req("/users", rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ email: "second-owner@mezan.app", password: "correct horse battery", role: "owner" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await json(createRes)) as { id: string; passwordHash?: string };
    expect(created.passwordHash).toBeUndefined();

    const deactivateRes = await rig.app.fetch(req(`/users/PU-SUPPORT/deactivate`, rig.ownerToken, { method: "POST" }));
    expect(deactivateRes.status).toBe(200);
    expect(((await json(deactivateRes)) as { status: string }).status).toBe("inactive");
  });

  it("support can read but every write is 403", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const id = body.tenant.id;

    for (const read of [`/tenants`, `/tenants/${id}`, `/plans`, `/users`, `/tenants/${id}/payments`]) {
      const res = await rig.app.fetch(req(read, rig.supportToken));
      expect(res.status, `GET ${read}`).toBe(200);
    }

    const writes: Array<[string, string, string | undefined]> = [
      ["POST", "/tenants", JSON.stringify({ code: "zzz", nameAr: "س", ownerEmail: "z@z.com", ownerNameAr: "س", planId: "x", billingCycle: "monthly", trial: false })],
      ["POST", `/tenants/${id}/suspend`, undefined],
      ["POST", `/tenants/${id}/subscription/cancel`, undefined],
      ["POST", `/tenants/${id}/payments`, JSON.stringify({ amount: "1.00", reference: "r", paidAt: "2026-01-01T00:00:00.000Z", idempotencyKey: "KEY-0001" })],
      ["POST", "/plans", JSON.stringify({ code: "x", nameAr: "س", nameEn: "x", modules: ["sales"], seatsIncluded: 1, branchesIncluded: 1, warehousesIncluded: 1, priceMonthly: "0", priceYearly: "0", trialDays: 0, isPublic: true, sortOrder: 0 })],
      ["POST", "/users", JSON.stringify({ email: "x@mezan.app", password: "correct horse battery", role: "support" })],
      ["POST", `/users/PU-SUPPORT/deactivate`, undefined],
    ];
    for (const [method, path, requestBody] of writes) {
      const res = await rig.app.fetch(req(path, rig.supportToken, { method, body: requestBody }));
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await json(res)).toMatchObject({ error: "OWNER_ONLY" });
    }
  });

  it("401s any route without a session", async () => {
    const rig = await buildRig();
    const res = await rig.app.fetch(new Request("http://x/tenants"));
    expect(res.status).toBe(401);
  });

  it("starts a subscription for a tenant with none, invalidating its cache, and refuses a second start with 409", async () => {
    const rig = await buildRig();
    const nowIso = FIXED_NOW().toISOString();
    const tenant = await createTenant(
      { id: "T-NOSUB", code: "nosub", nameAr: "بلا اشتراك", ownerEmail: "nosub@example.com", now: nowIso },
      rig.platform.stores.tenants,
    );
    await activateTenant({ id: tenant.id, now: nowIso }, rig.platform.stores.tenants);
    const planList = await plans(rig);
    const corePlan = planList.find((p) => p.code === "core")!;

    const startRes = await rig.app.fetch(
      req(`/tenants/${tenant.id}/subscription`, rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ planId: corePlan.id, billingCycle: "monthly", trial: false }),
      }),
    );
    expect(startRes.status).toBe(201);
    const started = (await json(startRes)) as { subscription: { status: string; planId: string } | null };
    expect(started.subscription?.status).toBe("active");
    expect(started.subscription?.planId).toBe(corePlan.id);
    expect(rig.invalidated).toContain("nosub");

    const secondRes = await rig.app.fetch(
      req(`/tenants/${tenant.id}/subscription`, rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ planId: corePlan.id, billingCycle: "monthly", trial: false }),
      }),
    );
    expect(secondRes.status).toBe(409);
    expect(await json(secondRes)).toMatchObject({ error: "TENANT_ALREADY_SUBSCRIBED" });
  });

  it("invalidates every tenant subscribed to a plan when it is updated or retired", async () => {
    const rig = await buildRig();
    await provisionOne(rig);
    rig.invalidated.length = 0;

    const planListRes = await rig.app.fetch(req("/plans", rig.ownerToken));
    const allPlans = (await json(planListRes)) as Array<{
      id: string; code: string; nameAr: string; nameEn: string; modules: string[]; seatsIncluded: number;
      branchesIncluded: number; warehousesIncluded: number; trialDays: number; isPublic: boolean; sortOrder: number;
    }>;
    const corePlan = allPlans.find((p) => p.code === "core")!;

    const updateRes = await rig.app.fetch(
      req(`/plans/${corePlan.id}`, rig.ownerToken, {
        method: "PUT",
        body: JSON.stringify({
          nameAr: corePlan.nameAr, nameEn: corePlan.nameEn, modules: corePlan.modules,
          seatsIncluded: corePlan.seatsIncluded, branchesIncluded: corePlan.branchesIncluded, warehousesIncluded: corePlan.warehousesIncluded,
          priceMonthly: "10.00", priceYearly: "100.00", trialDays: corePlan.trialDays, isPublic: corePlan.isPublic, sortOrder: corePlan.sortOrder,
        }),
      }),
    );
    expect(updateRes.status).toBe(200);
    expect(rig.invalidated).toEqual(["acme"]);

    rig.invalidated.length = 0;
    const retireRes = await rig.app.fetch(req(`/plans/${corePlan.id}/retire`, rig.ownerToken, { method: "POST" }));
    expect(retireRes.status).toBe(200);
    expect(rig.invalidated).toEqual(["acme"]);
  });

  describe("a console mutation whose event the audit log refuses", () => {
    function refusing(rig: Rig, action: string): () => void {
      const append = rig.platform.audit.append.bind(rig.platform.audit);
      rig.platform.audit.append = async (event) => {
        if (event.action === action) throw new Error("audit sink down");
        await append(event);
      };
      return () => {
        rig.platform.audit.append = append;
      };
    }
    const post = (rig: Rig, path: string, body?: unknown) =>
      rig.app.fetch(req(path, rig.ownerToken, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const tenantOf = async (rig: Rig, id: string) => ({
      status: (await rig.platform.stores.tenants.findById(id))?.status,
      subscription: await rig.platform.stores.subscriptions.findLiveByTenant(id),
    });
    async function expectRefused(res: Response) {
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ error: "AUDIT_UNAVAILABLE", message: expect.stringMatching(/[\u0600-\u06FF]/) });
    }

    it.each([
      ["suspend", "TENANT_SUSPENDED", "active"],
      ["archive", "TENANT_ARCHIVED", "active"],
    ])("answers 503 and leaves the tenant as it was on %s", async (step, action, statusBefore) => {
      const rig = await buildRig();
      const { body } = await provisionOne(rig);
      rig.invalidated.length = 0;
      const restore = refusing(rig, action);

      await expectRefused(await post(rig, `/tenants/${body.tenant.id}/${step}`));

      expect((await tenantOf(rig, body.tenant.id)).status).toBe(statusBefore);
      expect(rig.invalidated).toEqual([]);
      restore();
      expect((await post(rig, `/tenants/${body.tenant.id}/${step}`)).status).toBe(200);
      expect((await rig.platform.audit.query("security", 100)).filter((event) => event.action === action)).toHaveLength(1);
    });

    it("answers 503 and leaves a suspended tenant suspended on resume", async () => {
      const rig = await buildRig();
      const { body } = await provisionOne(rig);
      await post(rig, `/tenants/${body.tenant.id}/suspend`);
      refusing(rig, "TENANT_RESUMED");

      await expectRefused(await post(rig, `/tenants/${body.tenant.id}/resume`));

      expect((await tenantOf(rig, body.tenant.id)).status).toBe("suspended");
    });

    it.each([
      ["cancel", "SUBSCRIPTION_CANCELLED", undefined],
      ["suspend", "SUBSCRIPTION_SUSPENDED", { reason: "unpaid" }],
    ])("answers 503 and leaves the subscription as it was on subscription %s", async (step, action, payload) => {
      const rig = await buildRig();
      const { body } = await provisionOne(rig);
      const before = await tenantOf(rig, body.tenant.id);
      refusing(rig, action);

      await expectRefused(await post(rig, `/tenants/${body.tenant.id}/subscription/${step}`, payload));

      expect((await tenantOf(rig, body.tenant.id)).subscription).toEqual(before.subscription);
    });

    it("answers 503 and keeps the plan on a plan change, and resumes nothing on a resume", async () => {
      const rig = await buildRig();
      const { body, planId } = await provisionOne(rig);
      const other = (await plans(rig)).find((plan) => plan.id !== planId)!;
      refusing(rig, "SUBSCRIPTION_PLAN_CHANGED");
      await expectRefused(await post(rig, `/tenants/${body.tenant.id}/subscription/change-plan`, { planId: other.id }));
      expect((await tenantOf(rig, body.tenant.id)).subscription?.planId).toBe(planId);

      await post(rig, `/tenants/${body.tenant.id}/subscription/suspend`, { reason: "unpaid" });
      refusing(rig, "SUBSCRIPTION_RESUMED");
      await expectRefused(await post(rig, `/tenants/${body.tenant.id}/subscription/resume`, { reason: "paid" }));
      expect((await tenantOf(rig, body.tenant.id)).subscription?.status).toBe("suspended");
    });

    it("answers 503 and starts no subscription", async () => {
      const rig = await buildRig();
      const nowIso = FIXED_NOW().toISOString();
      const tenant = await activateTenant(
        { id: (await createTenant({ id: "T-BARE", code: "bare", nameAr: "بلا اشتراك", ownerEmail: "bare@example.com", now: nowIso }, rig.platform.stores.tenants)).id, now: nowIso },
        rig.platform.stores.tenants,
      );
      const core = (await plans(rig)).find((plan) => plan.code === "core")!;
      refusing(rig, "SUBSCRIPTION_STARTED");

      await expectRefused(await post(rig, `/tenants/${tenant.id}/subscription`, { planId: core.id, billingCycle: "monthly", trial: false }));

      expect(await rig.platform.stores.subscriptions.findLiveByTenant(tenant.id)).toBeNull();
    });

    it("answers 503 and creates, changes or retires no plan", async () => {
      const rig = await buildRig();
      const core = (await rig.platform.stores.plans.list()).find((plan) => plan.code === "core")!;
      const draft = {
        code: "unrecorded", nameAr: "غير مسجّلة", nameEn: "Unrecorded", modules: ["accounting"], features: {}, seatsIncluded: 1, branchesIncluded: 1,
        warehousesIncluded: 1, priceMonthly: "10.00", priceYearly: "100.00", trialDays: 0, isPublic: false, sortOrder: 99,
      };
      refusing(rig, "PLAN_CREATED");
      await expectRefused(await post(rig, "/plans", draft));
      expect((await rig.platform.stores.plans.list()).map((plan) => plan.code)).not.toContain("unrecorded");

      refusing(rig, "PLAN_RETIRED");
      const spare = (await rig.platform.stores.plans.list()).find((plan) => plan.code !== "core" && plan.kind !== PlanKind.Free)!;
      await expectRefused(await post(rig, `/plans/${spare.id}/retire`));
      expect((await rig.platform.stores.plans.findById(spare.id))?.status).toBe("active");

      refusing(rig, "PLAN_UPDATED");
      const edited = await rig.app.fetch(req(`/plans/${core.id}`, rig.ownerToken, {
        method: "PUT",
        body: JSON.stringify({ ...draft, code: undefined, nameAr: "اسم جديد", nameEn: core.nameEn }),
      }));
      await expectRefused(edited);
      expect((await rig.platform.stores.plans.findById(core.id))?.nameAr).toBe(core.nameAr);
    });

    it("keeps a sweep's summary event in the fallback, where the owner can read it and support cannot", async () => {
      const rig = await buildRig();
      const sweeping = createPlatformRoutes({
        platform: rig.platform,
        auth: rig.auth,
        now: FIXED_NOW,
        provisionTenant: async () => { throw new Error("not used in this test"); },
        invalidateEntitlements: () => undefined,
        cardCheckout: { sweep: async () => ({ examined: 1, paid: 0, declined: 0, unapplied: 0, expired: 0, stillPending: 1, alreadySettled: 0 }) } as unknown as PlatformCardCheckoutPort,
      });
      refusing(rig, "CARD_CHECKOUT_SWEEP_RUN");

      const swept = await sweeping.fetch(req("/card-checkouts/sweep", rig.ownerToken, { method: "POST" }));

      expect(swept.status).toBe(200);
      const unrecorded = (await json(await sweeping.fetch(req("/security/unrecorded", rig.ownerToken)))) as { count: number; recent: { action: string; reason: string; details: Record<string, unknown> }[] };
      expect(unrecorded.count).toBe(1);
      expect(unrecorded.recent[0]).toMatchObject({ action: "CARD_CHECKOUT_SWEEP_RUN", reason: "audit sink down" });
      expect(unrecorded.recent[0]!.details).toMatchObject({ examined: 1, paid: 0, stillPending: 1 });
      expect((await sweeping.fetch(req("/security/unrecorded", rig.supportToken))).status).toBe(403);
    });

    it("answers 503 and deactivates no platform user", async () => {
      const rig = await buildRig();
      refusing(rig, "PLATFORM_USER_DEACTIVATED");

      await expectRefused(await post(rig, "/users/PU-SUPPORT/deactivate"));

      expect((await rig.platform.stores.platformUsers.findById("PU-SUPPORT"))?.status).toBe("active");
    });

    it("answers 503 on a retried provisioning and leaves the tenant waiting to be provisioned", async () => {
      const rig = await buildRig();
      const nowIso = FIXED_NOW().toISOString();
      const tenant = await createTenant({ id: "T-WAIT", code: "wait", nameAr: "تنتظر", ownerEmail: "wait@example.com", now: nowIso }, rig.platform.stores.tenants);
      refusing(rig, "TENANT_PROVISION_RETRIED");

      await expectRefused(await post(rig, `/tenants/${tenant.id}/provision`));

      expect((await rig.platform.stores.tenants.findById(tenant.id))?.status).toBe("provisioning");
      expect(await rig.platform.stores.subscriptions.findLiveByTenant(tenant.id)).toBeNull();
    });

    it("answers 503 on a new tenant and leaves it unactivated and unsubscribed", async () => {
      const rig = await buildRig();
      refusing(rig, "TENANT_PROVISIONED");

      const { res, body } = await provisionOne(rig);

      expect(res.status).toBe(503);
      expect(body).toMatchObject({ error: "AUDIT_UNAVAILABLE" });
      const registered = await rig.platform.stores.tenants.findByCode("acme");
      expect(registered?.status ?? "absent").not.toBe("active");
      expect(registered ? await rig.platform.stores.subscriptions.findLiveByTenant(registered.id) : null).toBeNull();
      expect(rig.invalidated).toEqual([]);
    });
  });

  it("retries provisioning for a tenant stuck in `provisioning`, returning the DTO and invalidating", async () => {
    const rig = await buildRig();
    const nowIso = FIXED_NOW().toISOString();
    const tenant = await createTenant(
      { id: "T-STUCK", code: "stuck", nameAr: "منشأة عالقة", ownerEmail: "stuck@example.com", now: nowIso },
      rig.platform.stores.tenants,
    );
    expect(tenant.status).toBe("provisioning");

    const res = await rig.app.fetch(req(`/tenants/${tenant.id}/provision`, rig.ownerToken, { method: "POST" }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as ProvisionResultDTO;
    expect(body.tenant.status).toBe("active");
    expect(body.adminPin).toBeNull();
    expect(rig.invalidated).toContain("stuck");

    const rows = await rig.platform.audit.query("security");
    expect(rows.some((r) => r.action === "TENANT_PROVISION_RETRIED")).toBe(true);
  });

  it("409s a provision retry on a tenant that is not `provisioning`", async () => {
    const rig = await buildRig();
    const { body } = await provisionOne(rig);
    const res = await rig.app.fetch(req(`/tenants/${body.tenant.id}/provision`, rig.ownerToken, { method: "POST" }));
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: "TENANT_NOT_PROVISIONING" });
  });

  it("a provisioning failure on create returns 422 with the tenant id in the body, instead of 500", async () => {
    const rig = await buildRig();
    class FakeProvisioningError extends Error {
      readonly code = "TENANT_PROVISIONING_FAILED";
      constructor(readonly tenantId: string) {
        super("تعذّر تجهيز المنشأة");
      }
    }
    const failingApp = createPlatformRoutes({
      platform: rig.platform,
      auth: rig.auth,
      now: FIXED_NOW,
      provisionTenant: async () => { throw new FakeProvisioningError("T-FAILED"); },
      invalidateEntitlements: () => undefined,
    });

    const res = await failingApp.fetch(
      req("/tenants", rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({
          code: "zzz", nameAr: "س", ownerEmail: "z@z.com", ownerNameAr: "س", planId: "PLAN-CORE", billingCycle: "monthly", trial: false,
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(await json(res)).toMatchObject({ error: "TENANT_PROVISIONING_FAILED", tenantId: "T-FAILED" });
  });

  it("fails loudly on a provision retry when the deployment has not wired `provisionRetry`, never a silent 200", async () => {
    const rig = await buildRig();
    const nowIso = FIXED_NOW().toISOString();
    const tenant = await createTenant(
      { id: "T-NOWIRE", code: "nowire", nameAr: "بلا ربط", ownerEmail: "nowire@example.com", now: nowIso },
      rig.platform.stores.tenants,
    );
    const unwiredApp = createPlatformRoutes({
      platform: rig.platform,
      auth: rig.auth,
      now: FIXED_NOW,
      provisionTenant: async () => { throw new Error("not used in this test"); },
      invalidateEntitlements: () => undefined,
    });

    const res = await unwiredApp.fetch(req(`/tenants/${tenant.id}/provision`, rig.ownerToken, { method: "POST" }));
    expect(res.status).toBe(500);
  });
});

describe("createPlatformRoutes — the platform connection's turn", () => {
  const newUser = (email: string) => JSON.stringify({ email, password: "a long enough password", role: "support" });
  const LONGER_THAN_A_HASH_MS = 600;

  it("makes a platform user create wait for a transaction another operation has open, instead of writing into it", async () => {
    const rig = await buildRig();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let opened!: () => void;
    const open = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const settling = rig.platform.audit.atomic!(async () => {
      opened();
      await finished;
      throw new Error("the settlement rolls back");
    }).catch(() => undefined);
    await open;

    let answered = false;
    const creating = Promise.resolve(rig.app.fetch(req("/users", rig.ownerToken, { method: "POST", body: newUser("waits@mezan.app") }))).then((res) => {
      answered = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_A_HASH_MS));
    expect(answered).toBe(false);
    finish();
    await settling;
    const created = await creating;

    expect(created.status).toBe(201);
    expect((await rig.platform.stores.platformUsers.list()).map((user) => user.email)).toContain("waits@mezan.app");
    expect(drainForeignWrites()).toEqual([]);
  });

  it("creates no platform user when the event that records it cannot be written", async () => {
    const rig = await buildRig();
    const realAppend = rig.platform.audit.append.bind(rig.platform.audit);
    rig.platform.audit.append = async (event) => {
      if (event.action === "PLATFORM_USER_CREATED") throw new Error("audit sink unavailable");
      await realAppend(event);
    };

    const refused = await rig.app.fetch(req("/users", rig.ownerToken, { method: "POST", body: newUser("unrecorded@mezan.app") }));

    expect(refused.status).toBe(503);
    expect(await json(refused)).toMatchObject({ error: "AUDIT_UNAVAILABLE" });
    expect((await rig.platform.stores.platformUsers.list()).map((user) => user.email)).not.toContain("unrecorded@mezan.app");

    rig.platform.audit.append = realAppend;
    const created = await rig.app.fetch(req("/users", rig.ownerToken, { method: "POST", body: newUser("unrecorded@mezan.app") }));
    expect(created.status).toBe(201);
    expect((await rig.platform.audit.query("security", 50)).filter((event) => event.action === "PLATFORM_USER_CREATED")).toHaveLength(1);
  });
});

describe("createPlatformRoutes — card checkout operator actions", () => {
  const swept = {
    examined: 3, paid: 1, declined: 0, unapplied: 0, expired: 1, stillPending: 1, alreadySettled: 0,
    needsAttention: 0, unavailable: 0, failed: 0, deferred: 0,
  };

  async function withCardCheckout(port: Partial<PlatformCardCheckoutPort> = {}) {
    const rig = await buildRig();
    const calls: { sweeps: number; applied: unknown[]; resolved: unknown[] } = { sweeps: 0, applied: [], resolved: [] };
    const app = createPlatformRoutes({
      platform: rig.platform,
      auth: rig.auth,
      now: FIXED_NOW,
      provisionTenant: async () => { throw new Error("not used in this test"); },
      invalidateEntitlements: () => undefined,
      cardCheckout: {
        testMode: true,
        open: async () => { throw new Error("not used in this test"); },
        list: async () => [],
        sweep: async () => { calls.sweeps += 1; return swept; },
        applyUnapplied: async (input) => {
          calls.applied.push({ ...input, amount: input.amount?.toString() ?? null });
          return checkout({ id: input.checkoutId, tenantId: input.tenantId, status: CardCheckoutStatus.Paid });
        },
        resolveFlagged: async (input) => {
          calls.resolved.push({ ...input, amount: input.amount?.toString() ?? null });
          return checkout({
            id: input.checkoutId, tenantId: input.tenantId, status: CardCheckoutStatus.Refunded, resolution: input.resolution,
            resolvedAt: "2026-01-02T00:00:00.000Z", resolvedBy: input.actorId, resolutionReason: input.reason,
          });
        },
        ...port,
      },
    });
    const nowIso = FIXED_NOW().toISOString();
    const tenant = await createTenant(
      { id: "T-CARD", code: "card", nameAr: "بطاقة", ownerEmail: "card@example.com", now: nowIso },
      rig.platform.stores.tenants,
    );
    return { rig, app, calls, tenant };
  }

  function checkout(overrides: Partial<CardCheckout>): CardCheckout {
    return {
      id: "CHK-1", tenantId: "T-CARD", subscriptionId: "S1", provider: "paymob-test", amount: Money.fromMajor("490.50"), currency: "EGP",
      status: CardCheckoutStatus.Unapplied, providerOrderRef: "1", checkoutUrl: null, providerRef: "2", paymentId: null, failureReason: null,
      capturedAmount: Money.fromMajor("480.00"),
      requestedBy: "tester", attentionCause: null, resolution: null, resolvedAt: null, resolvedBy: null, resolutionReason: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
    };
  }

  it("runs the sweep for an owner, returns its tally and audits who ran it", async () => {
    const { rig, app, calls } = await withCardCheckout();

    const res = await app.fetch(req("/card-checkouts/sweep", rig.ownerToken, { method: "POST" }));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(swept);
    expect(calls.sweeps).toBe(1);
    const run = (await rig.platform.audit.query("security")).find((r) => r.action === "CARD_CHECKOUT_SWEEP_RUN");
    expect(run?.actor).toBe("PU-OWNER");
    expect(run?.details).toMatchObject({ examined: 3, paid: 1, expired: 1 });
  });

  it("refuses the sweep and the manual application to support staff and to anonymous callers", async () => {
    const { rig, app, calls, tenant } = await withCardCheckout();
    const body = JSON.stringify({ amount: "490.50", reason: "checked the dashboard" });

    const responses = await Promise.all([
      app.fetch(req("/card-checkouts/sweep", rig.supportToken, { method: "POST" })),
      app.fetch(req(`/tenants/${tenant.id}/card-checkouts/CHK-1/apply`, rig.supportToken, { method: "POST", body })),
      app.fetch(new Request("http://x/card-checkouts/sweep", { method: "POST" })),
      app.fetch(new Request(`http://x/tenants/${tenant.id}/card-checkouts/CHK-1/apply`, { method: "POST", body, headers: { "content-type": "application/json" } })),
    ]);

    expect(responses.map((res) => res.status)).toEqual([403, 403, 401, 401]);
    expect(calls).toEqual({ sweeps: 0, applied: [], resolved: [] });
  });

  it("applies an unapplied payment as the signed-in owner, never as an actor named in the body", async () => {
    const { rig, app, calls, tenant } = await withCardCheckout();

    const res = await app.fetch(
      req(`/tenants/${tenant.id}/card-checkouts/CHK-1/apply`, rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ amount: "480.00", reason: "  matched the bank statement  ", actorId: "someone-else", tenantId: "T-OTHER" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: "CHK-1", status: "paid", capturedAmount: "480.000000" });
    expect(calls.applied).toEqual([
      {
        tenantId: tenant.id, checkoutId: "CHK-1", amount: "480.000000", overrideAmount: false,
        reason: "matched the bank statement", actorId: "PU-OWNER",
      },
    ]);
  });

  it("passes no amount when none is given, and the override only when it is explicitly true", async () => {
    const { rig, app, calls, tenant } = await withCardCheckout();
    const apply = (body: Record<string, unknown>) =>
      app.fetch(req(`/tenants/${tenant.id}/card-checkouts/CHK-1/apply`, rig.ownerToken, { method: "POST", body: JSON.stringify(body) }));

    await apply({ reason: "matched the bank statement" });
    await apply({ reason: "matched the bank statement", amount: "500.00", overrideAmount: true });
    await apply({ reason: "matched the bank statement", amount: "500.00", overrideAmount: "yes" });

    expect(calls.applied).toEqual([
      expect.objectContaining({ amount: null, overrideAmount: false }),
      expect.objectContaining({ amount: "500.000000", overrideAmount: true }),
    ]);
  });

  it("answers 409 instead of queueing behind a pass that is already running", async () => {
    const { rig, app } = await withCardCheckout({ sweep: async () => null });

    const res = await app.fetch(req("/card-checkouts/sweep", rig.ownerToken, { method: "POST" }));

    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: "CARD_CHECKOUT_SWEEP_RUNNING", messageEn: expect.any(String) });
    expect((await rig.platform.audit.query("security")).some((r) => r.action === "CARD_CHECKOUT_SWEEP_RUN")).toBe(false);
  });

  it.each([
    ["no reason", { amount: "480.00" }],
    ["a reason too short to mean anything", { amount: "480.00", reason: "ok" }],
    ["a zero amount", { amount: "0", reason: "matched the bank statement" }],
    ["a negative amount", { amount: "-5.00", reason: "matched the bank statement" }],
    ["a numeric amount", { amount: 480, reason: "matched the bank statement" }],
  ])("400s a manual application with %s", async (_label, body) => {
    const { rig, app, calls, tenant } = await withCardCheckout();
    const res = await app.fetch(
      req(`/tenants/${tenant.id}/card-checkouts/CHK-1/apply`, rig.ownerToken, { method: "POST", body: JSON.stringify(body) }),
    );
    expect(res.status).toBe(400);
    expect(calls.applied).toEqual([]);
  });

  it("answers 409 in Arabic and English when the payment cannot be applied, and 404 for an unknown tenant", async () => {
    const { rig, app } = await withCardCheckout({
      applyUnapplied: async () => { throw new CardPaymentNotApplicableError(["حالة عملية الدفع ليست «غير مطبّقة»"], ["checkout is not unapplied"]); },
    });
    const body = JSON.stringify({ amount: "480.00", reason: "matched the bank statement" });

    const refused = await app.fetch(req("/tenants/T-CARD/card-checkouts/CHK-1/apply", rig.ownerToken, { method: "POST", body }));
    const unknown = await app.fetch(req("/tenants/T-NOBODY/card-checkouts/CHK-1/apply", rig.ownerToken, { method: "POST", body }));

    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({ error: "CARD_PAYMENT_NOT_APPLICABLE", messageEn: expect.stringContaining("not unapplied") });
    expect(unknown.status).toBe(404);
  });

  it("resolves a flagged checkout as the signed-in owner and answers with who resolved it and why", async () => {
    const { rig, app, calls, tenant } = await withCardCheckout();

    const res = await app.fetch(
      req(`/tenants/${tenant.id}/card-checkouts/CHK-1/resolve`, rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ resolution: "REFUNDED", reason: "  refunded on the dashboard  ", actorId: "someone-else" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      id: "CHK-1", status: "refunded", resolution: "REFUNDED", resolvedBy: "PU-OWNER", resolutionReason: "refunded on the dashboard",
    });
    expect(calls.resolved).toEqual([
      { tenantId: tenant.id, checkoutId: "CHK-1", resolution: "REFUNDED", reason: "refunded on the dashboard", actorId: "PU-OWNER", amount: null, overrideAmount: false },
    ]);
  });

  it("passes the transaction number and amount of a payment applied by hand", async () => {
    const { rig, app, calls, tenant } = await withCardCheckout();

    await app.fetch(
      req(`/tenants/${tenant.id}/card-checkouts/CHK-1/resolve`, rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({ resolution: "APPLIED_BY_HAND", reason: "seen on the dashboard", providerRef: "123456", amount: "490.50", overrideAmount: true }),
      }),
    );

    expect(calls.resolved).toEqual([expect.objectContaining({ resolution: "APPLIED_BY_HAND", providerRef: "123456", amount: "490.500000", overrideAmount: true })]);
  });

  it.each([
    ["an unknown resolution", { resolution: "FORGOTTEN", reason: "seen on the dashboard" }],
    ["no reason", { resolution: "REVIEWED" }],
    ["a transaction number that is not digits", { resolution: "APPLIED_BY_HAND", reason: "seen on the dashboard", providerRef: "12 OR 1", amount: "1.00" }],
    ["a numeric amount", { resolution: "APPLIED_BY_HAND", reason: "seen on the dashboard", providerRef: "12", amount: 5 }],
  ])("400s a resolution with %s", async (_label, body) => {
    const { rig, app, calls, tenant } = await withCardCheckout();
    const res = await app.fetch(req(`/tenants/${tenant.id}/card-checkouts/CHK-1/resolve`, rig.ownerToken, { method: "POST", body: JSON.stringify(body) }));
    expect(res.status).toBe(400);
    expect(calls.resolved).toEqual([]);
  });

  it("refuses a resolution from support, from nobody, and for an unknown tenant, and answers a refusal in Arabic", async () => {
    const { rig, app, calls, tenant } = await withCardCheckout();
    const body = JSON.stringify({ resolution: "REVIEWED", reason: "seen on the dashboard" });
    const path = `/tenants/${tenant.id}/card-checkouts/CHK-1/resolve`;

    const support = await app.fetch(req(path, rig.supportToken, { method: "POST", body }));
    const nobody = await app.fetch(new Request(`http://x${path}`, { method: "POST", body, headers: { "content-type": "application/json" } }));
    const unknown = await app.fetch(req("/tenants/T-NOBODY/card-checkouts/CHK-1/resolve", rig.ownerToken, { method: "POST", body }));

    expect([support.status, nobody.status, unknown.status]).toEqual([403, 401, 404]);
    expect(calls.resolved).toEqual([]);

    const refusing = await withCardCheckout({
      resolveFlagged: async () => { throw new CardPaymentNotApplicableError(["عملية الدفع ليست معلّقة للمراجعة"], ["the checkout is not waiting for a review"]); },
    });
    const refused = await refusing.app.fetch(req("/tenants/T-CARD/card-checkouts/CHK-1/resolve", refusing.rig.ownerToken, { method: "POST", body }));
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({ error: "CARD_PAYMENT_NOT_APPLICABLE", message: expect.stringContaining("ليست معلّقة للمراجعة") });
  });

  it("keeps who resolved a checkout, and the operator's note, out of what the tenant is shown", () => {
    const resolved = checkout({ resolution: CardCheckoutResolution.Reviewed, resolvedAt: "2026-01-02T00:00:00.000Z", resolvedBy: "PU-OWNER", resolutionReason: "internal note" });

    expect(serializeCardCheckout(resolved)).toMatchObject({ resolvedBy: "PU-OWNER", resolutionReason: "internal note" });
    expect(serializeCardCheckoutForTenant(resolved)).toMatchObject({ resolution: "REVIEWED", resolvedBy: null, resolutionReason: null });
  });

  it("answers 503 for both actions when card checkout is not configured", async () => {
    const rig = await buildRig();
    const sweep = await rig.app.fetch(req("/card-checkouts/sweep", rig.ownerToken, { method: "POST" }));
    const apply = await rig.app.fetch(
      req("/tenants/T-X/card-checkouts/CHK-1/apply", rig.ownerToken, { method: "POST", body: JSON.stringify({ amount: "1.00", reason: "matched" }) }),
    );
    expect([sweep.status, apply.status]).toEqual([503, 503]);
  });
});
