import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteConnection } from "@mezan/persistence";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import type { Tenant } from "@mezan/domain";
import { createCardCheckoutService } from "./card-checkout.js";
import { createOwnerContact, OwnerContactAudit } from "./owner-contact.js";
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
  ownerWritesLost: number;
}

interface HandOverMail {
  readonly to: string;
  readonly code: string;
  readonly successorEmail: string;
  readonly token: string;
}

interface Cloud {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly dataDir: string;
  readonly faults: Faults;
  readonly mails: HandOverMail[];
}

async function cloud(): Promise<Cloud> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-owner-contact-"));
  dirs.push(dataDir);
  const platform = await createPlatform({ dbPath: path.join(dataDir, "platform.db"), now });
  platforms.push(platform);
  const faults: Faults = { auditRefuses: false, ownerWriteRefuses: false, ownerWritesLost: 0 };
  const mails: HandOverMail[] = [];
  const audit = Object.create(platform.audit) as PlatformHandle["audit"];
  audit.append = async (event) => {
    if (faults.auditRefuses) throw new Error("the platform audit refused the row");
    return platform.audit.append(event);
  };
  const tenants = Object.create(platform.stores.tenants) as PlatformHandle["stores"]["tenants"];
  tenants.compareAndSetOwner = async (before, after, sideEffect) => {
    if (faults.ownerWriteRefuses) throw new Error("the platform database refused the owner contact");
    if (faults.ownerWritesLost > 0) {
      faults.ownerWritesLost -= 1;
      return false;
    }
    return platform.stores.tenants.compareAndSetOwner(before, after, sideEffect);
  };
  const faulty: PlatformHandle = { ...platform, audit, stores: { ...platform.stores, tenants } };
  const router = createTenantRouter({
    platform: faulty,
    dataDir,
    sweepEveryMs: 0,
    now,
    mailPendingHandOver: async (mail) => void mails.push({ to: mail.to, code: mail.tenant.code, successorEmail: mail.successorEmail, token: mail.token }),
  });
  routers.push(router);
  return { platform, router, dataDir, faults, mails };
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

async function ownerMovedWhilePlatformWasDown(c: Cloud, co: Company, email: string): Promise<Record<string, unknown>> {
  const owner = await co.user(`owner@${co.code}.example`);
  c.faults.ownerWriteRefuses = true;
  expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email })).status).toBe(200);
  c.faults.ownerWriteRefuses = false;
  await c.router.reconcileOwner(co.code);
  expect(await co.recorded()).toMatchObject({ ownerEmail: `owner@${co.code}.example`, ownerContactVerified: false });
  return owner;
}

async function tenantAudit(co: Company, action: string, token: string): Promise<Record<string, unknown>[]> {
  const page = (await co.call("GET", `/audit?stream=security&action=${action}&limit=200`, undefined, token)).json as { events: Record<string, unknown>[] };
  return page.events;
}

async function ownerAudit(c: Cloud, action: OwnerContactAudit): Promise<Record<string, unknown>[]> {
  return (await c.platform.audit.query("security")).filter((row) => row.action === action).map((row) => row.details as Record<string, unknown>);
}

describe("the platform's record of a tenant's owner", () => {
  it("names the owner by user id from provisioning on, with a verified contact, and never flags a tenant still being provisioned", async () => {
    const c = await cloud();
    const co = await company(c, "alpha");

    const owner = await co.user("owner@alpha.example");
    expect(await co.recorded()).toMatchObject({ ownerUserId: owner["id"], ownerEmail: "owner@alpha.example", ownerContactVerified: true });
    expect((await co.recorded()).ownerNeeded ?? false).toBe(false);
    expect(await ownerAudit(c, OwnerContactAudit.OwnerNeeded)).toEqual([]);
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

  it("follows the owner's change of email on the second try when the first write lost a race, with one audit row", async () => {
    const c = await cloud();
    const co = await company(c, "bison");
    const owner = await co.user("owner@bison.example");

    c.faults.ownerWritesLost = 1;
    expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "new@bison.example" })).status).toBe(200);

    expect(c.faults.ownerWritesLost).toBe(0);
    expect(await co.recorded()).toMatchObject({ ownerEmail: "new@bison.example", ownerContactVerified: true });
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

  it("refuses a peer admin who changes the owner's email, PIN, password, status or admin flag, in Arabic, and nothing moves", async () => {
    const c = await cloud();
    const co = await company(c, "echo");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@echo.example");
    const before = await co.recorded();
    const roles = (await co.call("GET", "/roles")).json as { id: string }[];
    const put = (change: Record<string, unknown>) => co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, ...change }, peer.token);

    const takeover = await put({ email: "inbox@elsewhere.example", pin: "999999" });
    const refusals = [
      takeover,
      await put({ email: "inbox@elsewhere.example" }),
      await put({ pin: "999999" }),
      await put({ password: "a-new-password-1" }),
      await put({ status: "inactive" }),
      await put({ isCompanyAdmin: false, roleId: roles[0]?.id, acknowledge: true, reason: "اختبار" }),
      await co.call("POST", `/users/${String(owner["id"])}/deactivate`, undefined, peer.token),
    ];

    for (const refusal of refusals) expect(refusal.status).toBe(403);
    expect(takeover.json).toMatchObject({
      error: "OWNER_ACCOUNT_PROTECTED",
      message: "هذا حساب مالك المنشأة. لا يغيّر بريده أو رمزه السري أو كلمة مروره أو حالته أو صلاحية المدير إلا المالك نفسه. لاستعادة الحساب تواصل مع دعم المنصة.",
    });
    expect(await co.recorded()).toEqual(before);
    expect((await co.user("owner@echo.example"))["status"]).toBe("active");
    expect((await co.signIn("owner@echo.example", co.ownerPin)).status).toBe(200);
    expect((await co.signIn("inbox@elsewhere.example", "999999")).status).toBe(401);
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
    expect(await ownerAudit(c, OwnerContactAudit.Unverified)).toEqual([]);
  });

  it("lets a peer admin edit what does not identify the owner", async () => {
    const c = await cloud();
    const co = await company(c, "oscar");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@oscar.example");

    const renamed = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, phone: "01000000000" }, peer.token);

    expect(renamed.status).toBe(200);
    expect((await co.user("owner@oscar.example"))["phone"]).toBe("01000000000");
  });

  it("follows the owner to an address the platform missed once the owner signs in with their own PIN", async () => {
    const c = await cloud();
    const co = await company(c, "papa");
    await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");
    expect(await ownerAudit(c, OwnerContactAudit.Unverified)).toHaveLength(1);
    await c.router.reconcileOwner("papa");
    expect(await ownerAudit(c, OwnerContactAudit.Unverified)).toHaveLength(1);

    expect((await co.signIn("inbox@elsewhere.example", co.ownerPin)).status).toBe(200);

    expect(await co.recorded()).toMatchObject({ ownerEmail: "inbox@elsewhere.example", ownerContactVerified: true });
  });

  it("does not take a sign-in with a PIN the console issued as proof of ownership: the recorded address stays", async () => {
    const c = await cloud();
    const co = await company(c, "quebec");
    await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");

    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    expect((await co.signIn("inbox@elsewhere.example", reset.adminPin)).status).toBe(200);
    expect((await co.signIn("inbox@elsewhere.example", reset.adminPin)).status).toBe(200);

    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@quebec.example", ownerContactVerified: false });
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
  });

  it("does not follow an email changed in a session opened with a PIN the console issued", async () => {
    const c = await cloud();
    const co = await company(c, "raven");
    const owner = await co.user("owner@raven.example");
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    const session = (await co.signIn("owner@raven.example", reset.adminPin)).token;

    expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "inbox@elsewhere.example" }, session)).status).toBe(200);

    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@raven.example", ownerContactVerified: false });
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
  });

  it("clears the unverified mark without an email change when the owner puts their address back", async () => {
    const c = await cloud();
    const co = await company(c, "foxtrot");
    const owner = await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");

    await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "owner@foxtrot.example" });

    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@foxtrot.example", ownerContactVerified: true });
    expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
  });

  it("still resets the owner's PIN from the console while the recorded address is behind, and says which address signs in", async () => {
    const c = await cloud();
    const co = await company(c, "golf");
    await secondAdmin(co);
    await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");

    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });

    expect(reset).toMatchObject({ adminEmail: "owner@golf.example", signInEmail: "inbox@elsewhere.example" });
    expect((await co.signIn("inbox@elsewhere.example", reset.adminPin)).status).toBe(200);
    expect((await co.signIn(`second@golf.example`, reset.adminPin)).status).toBe(401);
  });

  it("bills the card checkout to the verified address, not one the platform has not verified", async () => {
    const c = await cloud();
    const co = await company(c, "november");
    await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");
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

  it("records a hand-over a peer admin named for themself as PENDING: the recorded owner and address stay, and the old address is mailed", async () => {
    const c = await cloud();
    const co = await company(c, "kilo");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@kilo.example");

    const erased = await erase(co, String(owner["id"]), { confirmEmail: "owner@kilo.example", reason: "طلب محو", newOwnerUserId: peer.id }, peer.token);

    expect(erased.status).toBe(200);
    expect(erased.json).toMatchObject({ ownerHandOver: "pending" });
    expect(await co.recorded()).toMatchObject({
      ownerUserId: owner["id"],
      ownerEmail: "owner@kilo.example",
      pendingOwner: { userId: peer.id, email: "second@kilo.example", requestedBy: `tenant:kilo:${peer.id}` },
    });
    expect(await ownerAudit(c, OwnerContactAudit.HandOverPending)).toEqual([
      expect.objectContaining({ code: "kilo", fromUserId: owner["id"], toUserId: peer.id }),
    ]);
    expect(await ownerAudit(c, OwnerContactAudit.HandedOver)).toEqual([]);
    expect(c.mails).toEqual([expect.objectContaining({ to: "owner@kilo.example", code: "kilo", successorEmail: "second@kilo.example" })]);
    expect(await tenantAudit(co, "COMPANY_OWNER_HAND_OVER", peer.token)).toMatchObject([
      { entityId: peer.id, severity: "CRITICAL", details: { fromUserId: owner["id"], toUserId: peer.id, outcome: "pending" } },
    ]);
  });

  it("keeps a hand-over a peer admin named for a third admin pending too", async () => {
    const c = await cloud();
    const co = await company(c, "romeo");
    const peer = await secondAdmin(co);
    const third = await secondAdmin(co, "third@romeo.example");
    const owner = await co.user("owner@romeo.example");

    const erased = await erase(co, String(owner["id"]), { confirmEmail: "owner@romeo.example", reason: "طلب محو", newOwnerUserId: third.id }, peer.token);

    expect(erased.json).toMatchObject({ ownerHandOver: "pending" });
    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@romeo.example", pendingOwner: { userId: third.id, email: "third@romeo.example" } });
  });

  it("makes the pending successor the verified owner when the previous owner opens the link they were mailed, once", async () => {
    const c = await cloud();
    const co = await company(c, "sierra");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@sierra.example");
    await erase(co, String(owner["id"]), { confirmEmail: "owner@sierra.example", reason: "طلب محو", newOwnerUserId: peer.id }, peer.token);
    const token = c.mails[0]?.token ?? "";

    expect(await c.router.confirmPendingOwnerByToken("not-the-token")).toBeNull();
    const confirmed = await c.router.confirmPendingOwnerByToken(token);

    expect(confirmed).toMatchObject({ code: "sierra", ownerUserId: peer.id, ownerEmail: "second@sierra.example", ownerContactVerified: true });
    expect((await co.recorded()).pendingOwner ?? null).toBeNull();
    expect(await ownerAudit(c, OwnerContactAudit.HandedOver)).toEqual([expect.objectContaining({ code: "sierra", toUserId: peer.id, confirmedBy: "previous-owner-link" })]);
    expect(await c.router.confirmPendingOwnerByToken(token)).toBeNull();
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    expect((await co.signIn("second@sierra.example", reset.adminPin)).status).toBe(200);
  });

  it("commits the erasure first and the hand-over after: a platform that refuses the hand-over leaves the tenant flagged, not owned by the actor", async () => {
    const c = await cloud();
    const co = await company(c, "tango");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@tango.example");

    c.faults.ownerWriteRefuses = true;
    const erased = await erase(co, String(owner["id"]), { confirmEmail: "owner@tango.example", reason: "طلب محو", newOwnerUserId: peer.id }, peer.token);
    c.faults.ownerWriteRefuses = false;

    expect(erased.status).toBe(200);
    expect(erased.json).toMatchObject({ ownerHandOver: "failed" });
    const users = (await co.call("GET", "/users", undefined, peer.token)).json as Record<string, unknown>[];
    expect(users.find((user) => user["id"] === owner["id"])?.["email"]).not.toBe("owner@tango.example");
    await c.router.reconcileOwner("tango");
    expect(await co.recorded()).toMatchObject({ ownerUserId: owner["id"], ownerEmail: "owner@tango.example", ownerNeeded: true });
  });

  it("retries a hand-over whose first write lost a race, and records it once", async () => {
    const c = await cloud();
    const co = await company(c, "uniform");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@uniform.example");

    c.faults.ownerWritesLost = 1;
    const erased = await erase(co, String(owner["id"]), { confirmEmail: "owner@uniform.example", reason: "طلب محو", newOwnerUserId: peer.id }, peer.token);

    expect(erased.json).toMatchObject({ ownerHandOver: "pending" });
    expect((await co.recorded()).pendingOwner).toMatchObject({ userId: peer.id });
    expect(await ownerAudit(c, OwnerContactAudit.HandOverPending)).toHaveLength(1);
    expect(c.mails).toHaveLength(1);
  });

  it("answers a repeated hand-over with the outcome it already has, without a second audit row or mail", async () => {
    const c = await cloud();
    const co = await company(c, "indigo");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@indigo.example");
    const sent: string[] = [];
    const contact = createOwnerContact({ platform: c.platform, now, mailPendingHandOver: async (mail) => void sent.push(mail.to) });
    const handOver = { fromUserId: String(owner["id"]), toUserId: peer.id, toEmail: "second@indigo.example", actorId: peer.id };

    expect(await contact.handOver("indigo", handOver)).toBe("pending");
    expect(await contact.handOver("indigo", handOver)).toBe("pending");

    expect(await ownerAudit(c, OwnerContactAudit.HandOverPending)).toHaveLength(1);
    expect(sent).toEqual(["owner@indigo.example"]);
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

describe("the platform assigning a tenant's owner", () => {
  it("writes one CRITICAL platform row naming the operator, the previous owner and the new one, and clears a pending successor", async () => {
    const c = await cloud();
    const co = await company(c, "juno");
    const peer = await secondAdmin(co);
    const third = await secondAdmin(co, "third@juno.example");
    const owner = await co.user("owner@juno.example");
    await co.call("POST", `/users/${String(owner["id"])}/erase`, { confirmEmail: "owner@juno.example", reason: "طلب محو", newOwnerUserId: peer.id }, peer.token);

    const assigned = await c.router.assignOwner({ tenantId: co.tenantId, userId: third.id, actor: "platform:op-1" });

    expect(assigned).toMatchObject({ ownerUserId: third.id, ownerEmail: "third@juno.example", ownerContactVerified: true, pendingOwner: null });
    const rows = (await c.platform.audit.query("security")).filter((row) => row.action === OwnerContactAudit.Assigned);
    expect(rows).toMatchObject([
      { actor: "platform:op-1", severity: "CRITICAL", entityId: co.tenantId, details: { code: "juno", fromUserId: owner["id"], toUserId: third.id, confirmedBy: "platform-console" } },
    ]);
  });

  it("makes a sign-in with a console-issued PIN count again once the platform has confirmed that account as the owner", async () => {
    const c = await cloud();
    const co = await company(c, "lotus");
    const owner = await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    expect((await co.signIn("inbox@elsewhere.example", reset.adminPin)).status).toBe(200);
    expect((await co.recorded()).ownerEmail).toBe("owner@lotus.example");

    await c.router.assignOwner({ tenantId: co.tenantId, userId: String(owner["id"]), actor: "platform:op-1" });

    expect(await co.recorded()).toMatchObject({ ownerEmail: "inbox@elsewhere.example", ownerContactVerified: true });
    const session = (await co.signIn("inbox@elsewhere.example", reset.adminPin)).token;
    const account = ((await co.call("GET", "/users", undefined, session)).json as Record<string, unknown>[]).find((user) => user["id"] === owner["id"]);
    expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...account, email: "final@lotus.example" }, session)).status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerEmail: "final@lotus.example", ownerContactVerified: true });
  });
});

describe("the owner stepping down", () => {
  it("is refused when the owner deactivates or demotes their own account without naming a successor", async () => {
    const c = await cloud();
    const co = await company(c, "victor");
    await secondAdmin(co);
    const owner = await co.user("owner@victor.example");
    const roles = (await co.call("GET", "/roles")).json as { id: string }[];
    const before = await co.recorded();

    const deactivated = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive" });
    const demoted = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, isCompanyAdmin: false, roleId: roles[0]?.id, acknowledge: true, reason: "اختبار" });
    const viaRoute = await co.call("POST", `/users/${String(owner["id"])}/deactivate`);

    for (const refusal of [deactivated, demoted, viaRoute]) {
      expect(refusal.status).toBe(422);
      expect(refusal.json).toMatchObject({ error: "OWNER_SUCCESSOR_REQUIRED" });
    }
    expect(await co.recorded()).toEqual(before);
    expect((await co.user("owner@victor.example"))["status"]).toBe("active");
  });

  it("hands the tenant to the admin the owner named, verified at once because the owner did it", async () => {
    const c = await cloud();
    const co = await company(c, "whiskey");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@whiskey.example");

    const stepped = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive", newOwnerUserId: peer.id });

    expect(stepped.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerUserId: peer.id, ownerEmail: "second@whiskey.example", ownerContactVerified: true });
    expect((await co.recorded()).pendingOwner ?? null).toBeNull();
    expect(await ownerAudit(c, OwnerContactAudit.HandedOver)).toEqual([expect.objectContaining({ code: "whiskey", fromUserId: owner["id"], toUserId: peer.id })]);
    expect(c.mails).toEqual([]);
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    expect((await co.signIn("second@whiskey.example", reset.adminPin)).status).toBe(200);
  });
});

describe("the owner stepping down from a session opened with a console-issued PIN", () => {
  it("is recorded as pending, because that session proves nothing about who holds the PIN", async () => {
    const c = await cloud();
    const co = await company(c, "sable");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@sable.example");
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    const session = (await co.signIn("owner@sable.example", reset.adminPin)).token;

    const stepped = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive", newOwnerUserId: peer.id }, session);

    expect(stepped.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerUserId: owner["id"], ownerEmail: "owner@sable.example", pendingOwner: { userId: peer.id } });
    expect(await ownerAudit(c, OwnerContactAudit.HandedOver)).toEqual([]);
  });
});

describe("a tenant whose owner the platform does not know by id", () => {
  async function forgetOwnerId(c: Cloud, code: string): Promise<TenantRouter> {
    await c.router.close();
    const raw = openSqliteConnection(path.join(c.dataDir, "platform.db")).sqlite;
    raw.prepare("UPDATE tenant SET owner_user_id = NULL WHERE code = ?").run(code);
    raw.close();
    const reopened = createTenantRouter({ platform: c.platform, dataDir: c.dataDir, sweepEveryMs: 0, now });
    routers.push(reopened);
    return reopened;
  }

  it("is flagged owner-needed, never guessed, when the recorded address belongs to nobody who can administer", async () => {
    const c = await cloud();
    const co = await company(c, "xray");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@xray.example");
    const roles = (await co.call("GET", "/roles")).json as { id: string }[];
    expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, isCompanyAdmin: false, roleId: roles[0]?.id, acknowledge: true, reason: "اختبار", newOwnerUserId: peer.id })).status).toBe(200);
    const raw = openSqliteConnection(path.join(c.dataDir, "platform.db")).sqlite;
    raw.prepare("UPDATE tenant SET owner_user_id = NULL, owner_email = 'owner@xray.example' WHERE code = 'xray'").run();
    raw.close();

    await c.router.reconcileOwner("xray");

    expect(await co.recorded()).toMatchObject({ ownerUserId: null, ownerEmail: "owner@xray.example", ownerNeeded: true });
    expect(await ownerAudit(c, OwnerContactAudit.OwnerNeeded)).toHaveLength(1);
    await c.router.reconcileOwner("xray");
    expect(await ownerAudit(c, OwnerContactAudit.OwnerNeeded)).toHaveLength(1);
  });

  it("still protects the account the recorded address names while the platform cannot write the link", async () => {
    const c = await cloud();
    const co = await company(c, "yankee");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@yankee.example");
    const raw = openSqliteConnection(path.join(c.dataDir, "platform.db")).sqlite;
    raw.prepare("UPDATE tenant SET owner_user_id = NULL WHERE code = 'yankee'").run();
    raw.close();
    c.faults.ownerWriteRefuses = true;

    const takeover = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "inbox@elsewhere.example", pin: "999999" }, peer.token);
    const bareErase = await co.call("POST", `/users/${String(owner["id"])}/erase`, { confirmEmail: "owner@yankee.example", reason: "طلب محو" }, peer.token);
    c.faults.ownerWriteRefuses = false;

    expect(takeover.status).toBe(403);
    expect(bareErase.status).toBe(422);
    expect(bareErase.json).toMatchObject({ error: "OWNER_SUCCESSOR_REQUIRED" });
    expect((await co.recorded()).ownerUserId).toBeNull();
  });

  it("does not link a signed-in user who matches the recorded address but cannot administer", async () => {
    const c = await cloud();
    const co = await company(c, "zulu");
    const roles = (await co.call("GET", "/roles")).json as { id: string }[];
    const clerk = await co.call("POST", "/users", {
      nameAr: "موظف", nameEn: null, email: "clerk@zulu.example", phone: null, roleId: roles[0]?.id, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active", password: "clerk-password-1", pin: "333333", acknowledge: true, reason: "اختبار",
    });
    expect(clerk.status).toBe(201);
    const reopened = await forgetOwnerId(c, "zulu");
    const raw = openSqliteConnection(path.join(c.dataDir, "platform.db")).sqlite;
    raw.prepare("UPDATE tenant SET owner_email = 'clerk@zulu.example' WHERE code = 'zulu'").run();
    raw.close();

    const signedIn = await reopened.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: "zulu" },
        body: JSON.stringify({ username: "clerk@zulu.example", pin: "333333" }),
      }),
    );

    expect(signedIn.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerUserId: null, ownerNeeded: true });
  });
});

describe("the signup request of a tenant whose owner moved", () => {
  it("follows the owner's own change of email, so the activation link still answers for the new address", async () => {
    const c = await cloud();
    const co = await company(c, "amber");
    const owner = await co.user("owner@amber.example");
    const raw = openSqliteConnection(path.join(c.dataDir, "platform.db")).sqlite;
    raw
      .prepare(
        `INSERT INTO signup_request (id, code, name_ar, name_en, owner_email, owner_name_ar, plan_id, billing_cycle, token_hash, status, expires_at, created_at, verified_at)
         VALUES ('sr-amber', 'amber', 'منشأة', NULL, 'owner@amber.example', 'المالك', 'PLAN-CORE', 'monthly', 'hash-amber', 'verified', ?, ?, ?)`,
      )
      .run(T, T, T);
    raw.close();

    expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "new@amber.example" })).status).toBe(200);

    expect((await c.platform.stores.signupRequests.findByTokenHash("hash-amber"))?.ownerEmail).toBe("new@amber.example");
  });
});
