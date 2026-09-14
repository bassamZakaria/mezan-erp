import { describe, it, expect, afterEach } from "vitest";
import { createSessionRegistry } from "@mezan/api";
import { createPlatformUser, createTenant, activateTenant, startSubscription } from "@mezan/domain";
import type { CreateTenantRequestDTO, ProvisionResultDTO } from "@mezan/contracts";
import { createPlatform, type PlatformHandle } from "./create-platform.js";
import { createPlatformAuth } from "./platform-auth.js";
import { createPlatformRoutes } from "./platform-routes.js";

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

  const provisionTenant = async (cmd: CreateTenantRequestDTO & { actorId: string }): Promise<ProvisionResultDTO> => {
    provisioned.push(cmd);
    const nowIso = FIXED_NOW().toISOString();
    const tenant = await createTenant(
      { id: idOf(), code: cmd.code, nameAr: cmd.nameAr, nameEn: cmd.nameEn ?? null, ownerEmail: cmd.ownerEmail, now: nowIso },
      platform.stores.tenants,
    );
    const active = await activateTenant({ id: tenant.id, now: nowIso }, platform.stores.tenants);
    await startSubscription(
      { id: idOf(), tenantId: tenant.id, planId: cmd.planId, billingCycle: cmd.billingCycle, trial: cmd.trial, now: nowIso },
      platform.stores.subscriptions,
      platform.stores.plans,
    );
    return { tenant: active, adminEmail: cmd.ownerEmail, adminPin: "482913" };
  };

  const app = createPlatformRoutes({
    platform,
    auth,
    now: FIXED_NOW,
    provisionTenant,
    invalidateEntitlements: (code: string) => { invalidated.push(code); },
    idOf,
  });

  return { platform, app, ownerToken: await login("owner@mezan.app"), supportToken: await login("support@mezan.app"), invalidated, provisioned };
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
    expect(detail.entitlements?.activeModules).toContain("dashboard");
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

    expect(rig.invalidated).toEqual(["acme", "acme", "acme"]);

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
    // Tenant is "active"; resume is only legal from "suspended".
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

    const suspendRes = await rig.app.fetch(req(`/tenants/${id}/subscription/suspend`, rig.ownerToken, { method: "POST" }));
    expect(suspendRes.status).toBe(200);
    expect(((await json(suspendRes)) as { subscription: { status: string } }).subscription.status).toBe("suspended");

    const resumeRes = await rig.app.fetch(req(`/tenants/${id}/subscription/resume`, rig.ownerToken, { method: "POST" }));
    expect(resumeRes.status).toBe(200);
    expect(((await json(resumeRes)) as { subscription: { status: string } }).subscription.status).toBe("active");

    const cancelRes = await rig.app.fetch(req(`/tenants/${id}/subscription/cancel`, rig.ownerToken, { method: "POST" }));
    expect(cancelRes.status).toBe(200);
    // A cancelled subscription is no longer "live", so the summary carries none.
    expect(((await json(cancelRes)) as { subscription: unknown }).subscription).toBeNull();
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
        body: JSON.stringify({ amount: "500.00", reference: "REF-1", paidAt: "2026-01-01T00:00:00.000Z" }),
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
  });

  it("creates, updates (ignoring code) and retires a plan", async () => {
    const rig = await buildRig();
    const createRes = await rig.app.fetch(
      req("/plans", rig.ownerToken, {
        method: "POST",
        body: JSON.stringify({
          code: "starter", nameAr: "المبتدئة", nameEn: "Starter", modules: ["dashboard"],
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
          code: "ignored-code", nameAr: "المبتدئة الجديدة", nameEn: "Starter", modules: ["dashboard"],
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
      ["POST", `/tenants/${id}/payments`, JSON.stringify({ amount: "1.00", reference: "r", paidAt: "2026-01-01T00:00:00.000Z" })],
      ["POST", "/plans", JSON.stringify({ code: "x", nameAr: "س", nameEn: "x", modules: ["dashboard"], seatsIncluded: 1, branchesIncluded: 1, warehousesIncluded: 1, priceMonthly: "0", priceYearly: "0", trialDays: 0, isPublic: true, sortOrder: 0 })],
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
});
