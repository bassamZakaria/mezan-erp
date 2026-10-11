import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteConnection } from "@mezan/persistence";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import type { Tenant } from "@mezan/domain";
import { createCardCheckoutService } from "./card-checkout.js";
import { OwnerContactAudit } from "./owner-contact.js";
import { createPaymobTestProvider } from "./paymob-provider.js";
import { provisionTenant } from "./provision-tenant.js";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { resetTenantOwnerPin } from "./owner-pin-reset.js";

const T = "2026-01-15T00:00:00.000Z";
const now = () => new Date(T);

const dirs: string[] = [];
const routers: TenantRouter[] = [];
const platforms: PlatformHandle[] = [];

afterEach(async () => {
  for (const router of routers.splice(0)) await router.close();
  for (const platform of platforms.splice(0)) platform.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Faults {
  auditRefuses: boolean;
  ownerWriteRefuses: boolean;
}

interface Cloud {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly dataDir: string;
  readonly faults: Faults;
}

async function cloud(): Promise<Cloud> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-owner-contact-"));
  dirs.push(dataDir);
  const platform = await createPlatform({ dbPath: path.join(dataDir, "platform.db"), now });
  platforms.push(platform);
  const faults: Faults = { auditRefuses: false, ownerWriteRefuses: false };
  const audit = Object.create(platform.audit) as PlatformHandle["audit"];
  audit.append = async (event) => {
    if (faults.auditRefuses) throw new Error("the platform audit refused the row");
    return platform.audit.append(event);
  };
  const tenants = Object.create(platform.stores.tenants) as PlatformHandle["stores"]["tenants"];
  tenants.compareAndSetOwner = async (before, after, sideEffect) => {
    if (faults.ownerWriteRefuses) throw new Error("the platform database refused the owner contact");
    return platform.stores.tenants.compareAndSetOwner(before, after, sideEffect);
  };
  const faulty: PlatformHandle = { ...platform, audit, stores: { ...platform.stores, tenants } };
  const router = createTenantRouter({ platform: faulty, dataDir, sweepEveryMs: 0, now });
  routers.push(router);
  return { platform, router, dataDir, faults };
}

interface Company {
  readonly code: string;
  readonly tenantId: string;
  readonly ownerPin: string;
  call(method: string, route: string, body?: unknown, token?: string): Promise<{ status: number; json: unknown }>;
  signIn(username: string, pin: string): Promise<{ status: number; token: string }>;
  users(): Promise<Record<string, unknown>[]>;
  user(email: string): Promise<Record<string, unknown>>;
  recorded(): Promise<Tenant>;
}

async function company(c: Cloud, code: string): Promise<Company> {
  const { tenant, adminPin } = await provisionTenant(
    { code, nameAr: `منشأة ${code}`, ownerEmail: `owner@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
    { platform: c.platform, router: c.router, now },
  );
  c.router.invalidate(code);
  const signIn = async (username: string, pin: string) => {
    const res = await c.router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: code },
        body: JSON.stringify({ username, pin }),
      }),
    );
    return { status: res.status, token: res.status === 200 ? ((await res.json()) as { token: string }).token : "" };
  };
  const ownerToken = (await signIn(`owner@${code}.example`, adminPin ?? "")).token;
  const call: Company["call"] = async (method, route, body, token = ownerToken) => {
    const res = await c.router.app.fetch(
      new Request(`http://ignored${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, [TENANT_HEADER]: code, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const users = async () => (await call("GET", "/users")).json as Record<string, unknown>[];
  return {
    code,
    tenantId: tenant.id,
    ownerPin: adminPin ?? "",
    call,
    signIn,
    users,
    user: async (email) => {
      const found = (await users()).find((u) => u["email"] === email);
      if (!found) throw new Error(`no user ${email} in ${code}`);
      return found;
    },
    recorded: async () => {
      const row = await c.platform.stores.tenants.findByCode(code);
      if (!row) throw new Error(`no tenant ${code}`);
      return row;
    },
  };
}

const SECOND_ADMIN_PIN = "222222";

async function secondAdmin(co: Company, email = `second@${co.code}.example`): Promise<{ id: string; token: string }> {
  const created = await co.call("POST", "/users", {
    nameAr: "مدير ثان", nameEn: null, email, phone: null, roleId: null, isCompanyAdmin: true, employeeId: null,
    branchScope: "*", warehouseScope: "*", status: "active", password: "second-password-1", pin: SECOND_ADMIN_PIN,
    acknowledge: true, reason: "اختبار",
  });
  expect(created.status).toBe(201);
  const signedIn = await co.signIn(email, SECOND_ADMIN_PIN);
  expect(signedIn.status).toBe(200);
  return { id: String((created.json as Record<string, unknown>)["id"]), token: signedIn.token };
}

async function ownerAudit(c: Cloud, action: OwnerContactAudit): Promise<Record<string, unknown>[]> {
  return (await c.platform.audit.query("security")).filter((row) => row.action === action).map((row) => row.details as Record<string, unknown>);
}

describe("the platform's record of a tenant's owner", () => {
  it("names the owner by user id from provisioning on, with a verified contact", async () => {
    const c = await cloud();
    const co = await company(c, "alpha");

    const owner = await co.user("owner@alpha.example");
    expect(await co.recorded()).toMatchObject({ ownerUserId: owner["id"], ownerEmail: "owner@alpha.example", ownerContactVerified: true });
  });

  it("links a tenant stored before owners were named by id, on the next time its backend opens", async () => {
    const c = await cloud();
    const co = await company(c, "legacy");
    const owner = await co.user("owner@legacy.example");
    await c.router.close();
    const raw = openSqliteConnection(path.join(c.dataDir, "platform.db")).sqlite;
    raw.prepare("UPDATE tenant SET owner_user_id = NULL WHERE code = 'legacy'").run();
    raw.close();
    const reopened = createTenantRouter({ platform: c.platform, dataDir: c.dataDir, sweepEveryMs: 0, now });
    routers.push(reopened);

    await reopened.backendFor("legacy");

    expect(await co.recorded()).toMatchObject({ ownerUserId: owner["id"], ownerContactVerified: true });
    await reopened.reconcileOwner("legacy");
    expect(await ownerAudit(c, OwnerContactAudit.Linked)).toHaveLength(2);
  });

  it("follows the owner's own change of email after the tenant has saved it, with one audit row", async () => {
    const c = await cloud();
    const co = await company(c, "bravo");
    const owner = await co.user("owner@bravo.example");

    const changed = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: " New@Bravo.example " });

    expect(changed.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerEmail: "new@bravo.example", ownerContactVerified: true, ownerUserId: owner["id"] });
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([
      expect.objectContaining({ code: "bravo", before: "owner@bravo.example", after: "new@bravo.example", userId: owner["id"] }),
    ]);
    await c.router.reconcileOwner("bravo");
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toHaveLength(1);
  });

  it("leaves the platform untouched when the tenant refuses the change, then follows once the tenant really changed", async () => {
    const c = await cloud();
    const co = await company(c, "charlie");
    await secondAdmin(co, "taken@charlie.example");
    const owner = await co.user("owner@charlie.example");
    const before = await co.recorded();

    const refused = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "taken@charlie.example" });

    expect(refused.status).toBe(409);
    expect(await co.recorded()).toEqual(before);
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
    expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "real@charlie.example" })).status).toBe(200);
    expect((await co.recorded()).ownerEmail).toBe("real@charlie.example");
  });

  it.each(["auditRefuses", "ownerWriteRefuses"] as const)(
    "keeps the platform row identical when the follow step fails (%s), keeps the tenant's change, and heals",
    async (fault) => {
      const c = await cloud();
      const co = await company(c, "delta");
      const owner = await co.user("owner@delta.example");
      const before = await co.recorded();

      c.faults[fault] = true;
      const changed = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "moved@delta.example" });
      c.faults[fault] = false;

      expect(changed.status).toBe(200);
      expect((await co.user("moved@delta.example"))["id"]).toBe(owner["id"]);
      expect(await co.recorded()).toEqual(before);
      expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);

      await c.router.reconcileOwner("delta");
      expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@delta.example", ownerContactVerified: false });

      expect((await co.signIn("moved@delta.example", co.ownerPin)).status).toBe(200);
      expect(await co.recorded()).toMatchObject({ ownerEmail: "moved@delta.example", ownerContactVerified: true });
      expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toHaveLength(1);
    },
  );

  it("does not follow an email another admin gave the owner: the contact is unverified until the owner signs in with it", async () => {
    const c = await cloud();
    const co = await company(c, "echo");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@echo.example");

    const renamed = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "inbox@elsewhere.example" }, peer.token);

    expect(renamed.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@echo.example", ownerContactVerified: false, ownerUserId: owner["id"] });
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
    expect(await ownerAudit(c, OwnerContactAudit.Unverified)).toHaveLength(1);
    await c.router.reconcileOwner("echo");
    await c.router.reconcileOwner("echo");
    expect(await ownerAudit(c, OwnerContactAudit.Unverified)).toHaveLength(1);

    expect((await co.signIn("inbox@elsewhere.example", co.ownerPin)).status).toBe(200);

    expect(await co.recorded()).toMatchObject({ ownerEmail: "inbox@elsewhere.example", ownerContactVerified: true });
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([
      expect.objectContaining({ code: "echo", before: "owner@echo.example", after: "inbox@elsewhere.example" }),
    ]);
  });

  it("clears the unverified mark without an email change when the owner's address is put back", async () => {
    const c = await cloud();
    const co = await company(c, "foxtrot");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@foxtrot.example");
    await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "inbox@elsewhere.example" }, peer.token);
    expect((await co.recorded()).ownerContactVerified).toBe(false);

    await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "owner@foxtrot.example" }, peer.token);

    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@foxtrot.example", ownerContactVerified: true });
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
  });

  it("still resets the owner's PIN from the console after another admin renamed them, and says which address signs in", async () => {
    const c = await cloud();
    const co = await company(c, "golf");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@golf.example");
    await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "inbox@elsewhere.example" }, peer.token);

    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });

    expect(reset).toMatchObject({ adminEmail: "owner@golf.example", signInEmail: "inbox@elsewhere.example" });
    expect((await co.signIn("inbox@elsewhere.example", reset.adminPin)).status).toBe(200);
    expect((await co.signIn(`second@golf.example`, reset.adminPin)).status).toBe(401);
  });

  it("bills the card checkout to the verified address, not the one another admin typed", async () => {
    const c = await cloud();
    const co = await company(c, "november");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@november.example");
    await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "inbox@elsewhere.example" }, peer.token);
    const billed: string[] = [];
    const provider = createPaymobTestProvider();
    const checkout = createCardCheckoutService({
      platform: c.platform,
      provider: { ...provider, createCheckout: async (request) => { billed.push(request.customer.email); return provider.createCheckout(request); } },
      now,
      invalidateEntitlements: () => undefined,
    });

    await checkout.open({ tenantId: co.tenantId, requestedBy: "tenant:november", returnUrl: (id) => `https://app.example/return/${id}`, notificationUrl: "https://app.example/hook" });

    expect(billed).toEqual(["owner@november.example"]);
  });

  it("never moves another tenant's record, and ignores a user who is not the owner", async () => {
    const c = await cloud();
    const one = await company(c, "hotel");
    const two = await company(c, "india");
    const twoBefore = await two.recorded();
    const ownerOne = await one.user("owner@hotel.example");
    const peer = await secondAdmin(one);

    expect((await one.call("PUT", `/users/${String(ownerOne["id"])}`, { ...ownerOne, email: "owner@india.example" })).status).toBe(200);

    expect((await one.recorded()).ownerEmail).toBe("owner@india.example");
    expect(await two.recorded()).toEqual(twoBefore);

    const peerRow = await one.user("second@hotel.example");
    expect((await one.call("PUT", `/users/${peer.id}`, { ...peerRow, email: "owner@hotel.example" }, peer.token)).status).toBe(200);
    expect(await one.recorded()).toMatchObject({ ownerEmail: "owner@india.example", ownerUserId: ownerOne["id"], ownerContactVerified: true });
    expect(await two.recorded()).toEqual(twoBefore);
  });
});

describe("erasing the recorded owner", () => {
  const erase = (co: Company, id: string, body: Record<string, unknown>, token: string) => co.call("POST", `/users/${id}/erase`, body, token);

  it("is refused until another company admin is named as the new owner", async () => {
    const c = await cloud();
    const co = await company(c, "juliet");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@juliet.example");
    const before = await co.recorded();

    const bare = await erase(co, String(owner["id"]), { confirmEmail: "owner@juliet.example", reason: "طلب محو" }, peer.token);
    const toSelf = await erase(co, String(owner["id"]), { confirmEmail: "owner@juliet.example", reason: "طلب محو", newOwnerUserId: owner["id"] }, peer.token);

    expect(bare.status).toBe(422);
    expect(bare.json).toMatchObject({ error: "OWNER_SUCCESSOR_REQUIRED", message: "هذا الحساب هو مالك المنشأة. اختر مديرًا آخر للمنشأة ليصبح المالك قبل محو بياناته." });
    expect(toSelf.status).toBe(422);
    expect(await co.recorded()).toEqual(before);
    expect((await co.user("owner@juliet.example"))["id"]).toBe(owner["id"]);
  });

  it("hands ownership to the named admin on the platform, then erases", async () => {
    const c = await cloud();
    const co = await company(c, "kilo");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@kilo.example");

    const erased = await erase(co, String(owner["id"]), { confirmEmail: "owner@kilo.example", reason: "طلب محو", newOwnerUserId: peer.id }, peer.token);

    expect(erased.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerUserId: peer.id, ownerEmail: "second@kilo.example", ownerContactVerified: true });
    expect(await ownerAudit(c, OwnerContactAudit.HandedOver)).toEqual([
      expect.objectContaining({ code: "kilo", fromUserId: owner["id"], toUserId: peer.id }),
    ]);
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    expect((await co.signIn("second@kilo.example", reset.adminPin)).status).toBe(200);
  });

  it("refuses a successor who is not an active company admin", async () => {
    const c = await cloud();
    const co = await company(c, "lima");
    const peer = await secondAdmin(co);
    const roles = (await co.call("GET", "/roles")).json as { id: string }[];
    const clerk = await co.call("POST", "/users", {
      nameAr: "موظف", nameEn: null, email: "clerk@lima.example", phone: null, roleId: roles[0]?.id, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active", password: "clerk-password-1", acknowledge: true, reason: "اختبار",
    });
    const owner = await co.user("owner@lima.example");
    const before = await co.recorded();

    const refused = await erase(
      co, String(owner["id"]),
      { confirmEmail: "owner@lima.example", reason: "طلب محو", newOwnerUserId: (clerk.json as Record<string, unknown>)["id"] }, peer.token,
    );

    expect(refused.status).toBe(422);
    expect(await co.recorded()).toEqual(before);
  });

  it("erases anyone who is not the owner without asking for a successor", async () => {
    const c = await cloud();
    const co = await company(c, "mike");
    const peer = await secondAdmin(co);
    const before = await co.recorded();

    const erased = await erase(co, peer.id, { confirmEmail: "second@mike.example", reason: "طلب محو" }, (await co.signIn("owner@mike.example", co.ownerPin)).token);

    expect(erased.status).toBe(200);
    expect(await co.recorded()).toEqual(before);
  });
});
