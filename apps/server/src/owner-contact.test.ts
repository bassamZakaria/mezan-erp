import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindTenantDatabase, openSqliteConnection } from "@mezan/persistence";
import { createSessionRegistry } from "@mezan/api";
import {
  createBackend,
  createPlatform,
  createPlatformAuth,
  createPlatformRoutes,
  OwnerPinResetOutcome,
  PlatformAuditAction,
  PlatformAuditUnavailableError,
  type BackendHandle,
  type PlatformHandle,
  type SignedInUser,
} from "@mezan/backend";
import { DEVICE_BINDING_HEADER, DEVICE_SECRET_HEADER } from "@mezan/contracts";
import { activateTenant, AuditSeverityCode, createPlatformUser, createTenant, pendingOwnerExpiresAt, type Tenant } from "@mezan/domain";
import { createCardCheckoutService } from "./card-checkout.js";
import {
  createOwnerContact,
  hashHandOverToken,
  NoPendingOwnerError,
  OwnerCandidateNotFoundError,
  OwnerConfirmation,
  OwnerContactAudit,
  OwnerRecordDueError,
  PendingOwnerExpiredError,
  PREVIOUS_OWNER_ACTOR,
  type OwnerContact,
  type PendingHandOverMail,
} from "./owner-contact.js";
import { createPaymobTestProvider } from "./paymob-provider.js";
import { provisionTenant } from "./provision-tenant.js";
import { createTenantRouter, TENANT_HEADER, type TenantRouter, type TenantRouterOptions } from "./tenant-router.js";
import { resetTenantOwnerPin } from "./owner-pin-reset.js";
import { reachable } from "./cloud-harness.js";

function reachableRouter(options: TenantRouterOptions): TenantRouter {
  const router = createTenantRouter(options);
  reachable(router.app);
  return router;
}

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

async function cloud(observe: { onSignedIn?: (user: SignedInUser) => void; mailTakesMs?: number; platformTakesMs?: number } = {}): Promise<Cloud> {
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
    if (observe.platformTakesMs !== undefined) await new Promise((resolve) => setTimeout(resolve, observe.platformTakesMs));
    if (faults.ownerWriteRefuses) throw new Error("the platform database refused the owner contact");
    if (faults.ownerWritesLost > 0) {
      faults.ownerWritesLost -= 1;
      return false;
    }
    return platform.stores.tenants.compareAndSetOwner(before, after, sideEffect);
  };
  const faulty: PlatformHandle = { ...platform, audit, stores: { ...platform.stores, tenants } };
  const router = reachableRouter({
    platform: faulty,
    dataDir,
    sweepEveryMs: 0,
    now,
    mailPendingHandOver: async (mail) => {
      if (observe.mailTakesMs !== undefined) await new Promise((resolve) => setTimeout(resolve, observe.mailTakesMs));
      mails.push({ to: mail.to, code: mail.tenant.code, successorEmail: mail.successorEmail, token: mail.token });
    },
    ...(observe.onSignedIn
      ? {
          openBackend: async (_code, dbPath, resolvers, hooks, connection) => {
            mkdirSync(path.dirname(dbPath), { recursive: true });
            return createBackend({
              dbPath,
              connection,
              resolveEntitlements: () => resolvers.resolveEntitlements(),
              resolveLicenseState: () => resolvers.resolveLicenseState(),
              onUserEmailChanged: hooks.onUserEmailChanged,
              onUserSignedIn: async (user) => {
                observe.onSignedIn?.(user);
                await hooks.onUserSignedIn(user);
              },
              companyOwner: hooks.companyOwner,
              claimedElsewhere: hooks.claimedElsewhere,
            });
          },
        }
      : {}),
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
    const reopened = reachableRouter({ platform: c.platform, dataDir: c.dataDir, sweepEveryMs: 0, now });
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
      expect(await co.recorded()).toEqual(before);
      expect(await ownerAudit(c, OwnerContactAudit.EmailChanged)).toEqual([]);
      expect((await co.user("moved@delta.example"))["id"]).toBe(owner["id"]);

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

  it("does not announce a sign-in from a device session that is presented again without a PIN, so a console-issued PIN is never taken as proof through it", async () => {
    const announced: SignedInUser[] = [];
    const c = await cloud({ onSignedIn: (user) => announced.push(user) });
    const co = await company(c, "sierra");
    const onDevice = (route: string, init: { method?: string; token?: string; deviceSecret?: string; body?: unknown }) =>
      c.router.app.fetch(
        new Request(`http://ignored${route}`, {
          method: init.method ?? "GET",
          headers: {
            "content-type": "application/json",
            [TENANT_HEADER]: co.code,
            [DEVICE_BINDING_HEADER]: "1",
            ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
            ...(init.deviceSecret ? { [DEVICE_SECRET_HEADER]: init.deviceSecret } : {}),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
      );
    const beforeTheDevice = announced.length;
    const first = await onDevice("/auth/login", { method: "POST", body: { username: "owner@sierra.example", pin: co.ownerPin } });
    expect(first.status).toBe(200);
    const device = (await first.json()) as { token: string; deviceSecret: string };
    expect(device.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(announced.length).toBe(beforeTheDevice + 1);
    expect(announced.at(-1)).toMatchObject({ email: "owner@sierra.example", credentialIsOwn: true });

    await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    const afterReset = announced.length;

    const again = await onDevice("/users", { token: device.token, deviceSecret: device.deviceSecret });
    const withoutPin = await onDevice("/auth/login", { method: "POST", deviceSecret: device.deviceSecret, body: { username: "inbox@elsewhere.example" } });
    const wrongPin = await onDevice("/auth/login", { method: "POST", deviceSecret: device.deviceSecret, body: { username: "inbox@elsewhere.example", pin: "000000" } });

    expect([200, 401]).toContain(again.status);
    expect([withoutPin.status, wrongPin.status]).toEqual([400, 401]);
    expect(announced.length).toBe(afterReset);
    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@sierra.example", ownerContactVerified: false });

    const withTheResetPin = await onDevice("/auth/login", { method: "POST", deviceSecret: device.deviceSecret, body: { username: "inbox@elsewhere.example", pin: reset.adminPin } });
    expect(withTheResetPin.status).toBe(200);
    expect(announced.at(-1)).toMatchObject({ email: "inbox@elsewhere.example", credentialIsOwn: false });
    expect(await co.recorded()).toMatchObject({ ownerEmail: "owner@sierra.example", ownerContactVerified: false });
  });

  it("saves an owner's new address, and the platform follows it, when the platform's database takes its time", async () => {
    const c = await cloud({ platformTakesMs: 20 });
    const co = await company(c, "uniform");
    const owner = await co.user("owner@uniform.example");

    const moved = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, email: "moved@uniform.example" });

    expect(moved.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerEmail: "moved@uniform.example" });
    expect((await co.signIn("moved@uniform.example", co.ownerPin)).status).toBe(200);
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

const OWNER_ERASURE_REFUSAL = {
  error: "OWNER_ACCOUNT_PROTECTED",
  message: "هذا حساب مالك المنشأة ولا تُمحى بياناته. ينقل المالك ملكية المنشأة إلى مدير آخر أولًا، وبعدها يُمحى حسابه كأي حساب آخر.",
};

async function ownerStepsDownOnConsolePin(c: Cloud, co: Company, successorId: string): Promise<{ owner: Record<string, unknown>; status: number }> {
  const owner = await co.user(`owner@${co.code}.example`);
  const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
  const session = (await co.signIn(`owner@${co.code}.example`, reset.adminPin)).token;
  const stepped = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive", newOwnerUserId: successorId }, session);
  return { owner, status: stepped.status };
}

describe("erasing the recorded owner", () => {
  const erase = (co: Company, id: string, body: Record<string, unknown>, token: string) => co.call("POST", `/users/${id}/erase`, body, token);

  it("is refused for a peer admin, whoever they name as the new owner, and nothing about the owner changes", async () => {
    const c = await cloud();
    const co = await company(c, "juliet");
    const peer = await secondAdmin(co);
    const third = await secondAdmin(co, "third@juliet.example");
    const owner = await co.user("owner@juliet.example");
    const before = await co.recorded();
    const request = { confirmEmail: "owner@juliet.example", reason: "طلب محو" };

    const bare = await erase(co, String(owner["id"]), request, peer.token);
    const forSelf = await erase(co, String(owner["id"]), { ...request, newOwnerUserId: peer.id }, peer.token);
    const forThird = await erase(co, String(owner["id"]), { ...request, newOwnerUserId: third.id }, peer.token);

    for (const refusal of [bare, forSelf, forThird]) {
      expect(refusal.status).toBe(403);
      expect(refusal.json).toMatchObject(OWNER_ERASURE_REFUSAL);
    }
    expect(await co.recorded()).toEqual(before);
    expect(await co.user("owner@juliet.example")).toMatchObject({ id: owner["id"], status: "active", isCompanyAdmin: true });
    expect(c.mails).toEqual([]);
    expect(await ownerAudit(c, OwnerContactAudit.HandOverPending)).toEqual([]);
    expect(await tenantAudit(co, "PERSONAL_DATA_ERASED", peer.token)).toEqual([]);
  });

  it("is refused for the owner themself with the same reason", async () => {
    const c = await cloud();
    const co = await company(c, "golf2");
    const owner = await co.user("owner@golf2.example");

    const refused = await erase(co, String(owner["id"]), { confirmEmail: "owner@golf2.example", reason: "طلب محو" }, (await co.signIn("owner@golf2.example", co.ownerPin)).token);

    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject(OWNER_ERASURE_REFUSAL);
  });

  it("is allowed once the owner has handed the company over: the former owner is an ordinary account", async () => {
    const c = await cloud();
    const co = await company(c, "kilo");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@kilo.example");
    expect((await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive", newOwnerUserId: peer.id })).status).toBe(200);

    const erased = await erase(co, String(owner["id"]), { confirmEmail: "owner@kilo.example", reason: "طلب محو" }, peer.token);

    expect(erased.status).toBe(200);
    expect(erased.json).toMatchObject({ alreadyErased: false });
    expect(await co.recorded()).toMatchObject({ ownerUserId: peer.id, ownerEmail: "second@kilo.example", ownerContactVerified: true });
  });

  it("is allowed once the platform has assigned another admin as the owner", async () => {
    const c = await cloud();
    const co = await company(c, "romeo");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@romeo.example");
    await c.router.assignOwner({ tenantId: co.tenantId, userId: peer.id, actor: "platform:op-1" });

    const erased = await erase(co, String(owner["id"]), { confirmEmail: "owner@romeo.example", reason: "طلب محو" }, peer.token);

    expect(erased.status).toBe(200);
    expect(await co.recorded()).toMatchObject({ ownerUserId: peer.id, ownerEmail: "second@romeo.example" });
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

describe("a hand-over the platform cannot take as the owner's own act", () => {
  it("is recorded as PENDING: the recorded owner and address stay, and the old address is mailed", async () => {
    const c = await cloud();
    const co = await company(c, "sable");
    const peer = await secondAdmin(co);

    const { owner, status } = await ownerStepsDownOnConsolePin(c, co, peer.id);

    expect(status).toBe(200);
    expect(await co.recorded()).toMatchObject({
      ownerUserId: owner["id"],
      ownerEmail: "owner@sable.example",
      pendingOwner: { userId: peer.id, email: "second@sable.example", requestedBy: `tenant:sable:${String(owner["id"])}` },
    });
    expect(await ownerAudit(c, OwnerContactAudit.HandOverPending)).toEqual([
      expect.objectContaining({ code: "sable", fromUserId: owner["id"], toUserId: peer.id }),
    ]);
    expect(await ownerAudit(c, OwnerContactAudit.HandedOver)).toEqual([]);
    expect(c.mails).toEqual([expect.objectContaining({ to: "owner@sable.example", code: "sable", successorEmail: "second@sable.example" })]);
    expect(await tenantAudit(co, "COMPANY_OWNER_HAND_OVER", peer.token)).toMatchObject([
      { entityId: peer.id, severity: "CRITICAL", details: { fromUserId: owner["id"], toUserId: peer.id, outcome: "pending" } },
    ]);
  });

  it("saves the owner's step-down and records it pending when the mail server takes its time over the confirmation link", async () => {
    const c = await cloud({ mailTakesMs: 20 });
    const co = await company(c, "tango");
    const peer = await secondAdmin(co);

    const { owner, status } = await ownerStepsDownOnConsolePin(c, co, peer.id);

    expect(status).toBe(200);
    const accounts = (await co.call("GET", "/users", undefined, peer.token)).json as { email: string; status: string }[];
    expect(accounts.find((account) => account.email === "owner@tango.example")?.status).toBe("inactive");
    expect(await co.recorded()).toMatchObject({ ownerUserId: owner["id"], pendingOwner: { userId: peer.id, email: "second@tango.example" } });
    expect(c.mails).toEqual([expect.objectContaining({ to: "owner@tango.example", successorEmail: "second@tango.example" })]);
    expect(await tenantAudit(co, "COMPANY_OWNER_HAND_OVER", peer.token)).toMatchObject([{ entityId: peer.id, details: { outcome: "pending" } }]);
  });

  it("makes the pending successor the verified owner when the previous owner opens the link they were mailed, once", async () => {
    const c = await cloud();
    const co = await company(c, "sierra");
    const peer = await secondAdmin(co);
    await ownerStepsDownOnConsolePin(c, co, peer.id);
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

  it("refuses the link, and the console, once the successor is no longer an active admin, and the pending hand-over stays as it was", async () => {
    const c = await cloud();
    const co = await company(c, "oscar");
    const peer = await secondAdmin(co);
    const third = await secondAdmin(co, "third@oscar.example");
    await ownerStepsDownOnConsolePin(c, co, peer.id);
    const token = c.mails[0]?.token ?? "";
    const before = await co.recorded();
    expect((await co.call("POST", `/users/${peer.id}/deactivate`, undefined, third.token)).status).toBe(200);

    const byLink = await c.router.confirmPendingOwnerByToken(token);
    const byConsole = await c.router.confirmPendingOwner({ tenantId: co.tenantId, actor: "platform:op-1" }).catch((err: unknown) => err);

    expect(byLink).toBeNull();
    expect(byConsole).toBeInstanceOf(OwnerCandidateNotFoundError);
    expect(await co.recorded()).toEqual(before);
    expect(await ownerAudit(c, OwnerContactAudit.HandedOver)).toEqual([]);
  });

  it("retries a hand-over whose first write lost a race, and records it once", async () => {
    const c = await cloud();
    const co = await company(c, "uniform");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@uniform.example");
    const reset = await resetTenantOwnerPin({ platform: c.platform, router: c.router }, { tenant: await co.recorded(), actorId: "op-1" });
    const session = (await co.signIn("owner@uniform.example", reset.adminPin)).token;

    c.faults.ownerWritesLost = 1;
    const stepped = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive", newOwnerUserId: peer.id }, session);

    expect(stepped.status).toBe(200);
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

    expect(await contact.handOver(co.tenantId, handOver)).toBe("pending");
    expect(await contact.handOver(co.tenantId, handOver)).toBe("pending");

    expect(await ownerAudit(c, OwnerContactAudit.HandOverPending)).toHaveLength(1);
    expect(sent).toEqual(["owner@indigo.example"]);
  });
});

describe("the platform console's own acts on a pending hand-over", () => {
  it("declines it with one CRITICAL row naming the operator, and the row and the change are one write", async () => {
    const c = await cloud();
    const co = await company(c, "delta2");
    const peer = await secondAdmin(co);
    const { owner } = await ownerStepsDownOnConsolePin(c, co, peer.id);
    const before = await co.recorded();

    c.faults.auditRefuses = true;
    const unaudited = await c.router.declinePendingOwner({ tenantId: co.tenantId, actor: "platform:op-1" }).catch((err: unknown) => err);
    c.faults.auditRefuses = false;
    const stillPending = await co.recorded();
    const declined = await c.router.declinePendingOwner({ tenantId: co.tenantId, actor: "platform:op-1" });

    expect(unaudited).toBeInstanceOf(PlatformAuditUnavailableError);
    expect(stillPending).toEqual(before);
    expect(declined).toMatchObject({ ownerUserId: owner["id"], ownerEmail: "owner@delta2.example", pendingOwner: null });
    const rows = (await c.platform.audit.query("security")).filter((row) => row.action === OwnerContactAudit.HandOverDeclined);
    expect(rows).toMatchObject([{ actor: "platform:op-1", severity: "CRITICAL", entityId: co.tenantId, details: { code: "delta2", toUserId: peer.id } }]);
  });

  it("sends the link again with one row naming the operator, and the old link dies with the new one's birth", async () => {
    const c = await cloud();
    const co = await company(c, "echo2");
    const peer = await secondAdmin(co);
    await ownerStepsDownOnConsolePin(c, co, peer.id);
    const first = c.mails[0]?.token ?? "";

    await c.router.resendPendingOwner({ tenantId: co.tenantId, actor: "platform:op-1" });

    expect(c.mails).toHaveLength(2);
    expect(c.mails[1]).toMatchObject({ to: "owner@echo2.example", successorEmail: "second@echo2.example" });
    expect(c.mails[1]?.token).not.toBe(first);
    expect(await c.router.confirmPendingOwnerByToken(first)).toBeNull();
    const rows = (await c.platform.audit.query("security")).filter((row) => row.action === OwnerContactAudit.HandOverLinkResent);
    expect(rows).toMatchObject([{ actor: "platform:op-1", entityId: co.tenantId }]);
    expect(await c.router.confirmPendingOwnerByToken(c.mails[1]?.token ?? "")).toMatchObject({ ownerUserId: peer.id });
  });
});

describe("the audit of an owner the console assigns or confirms", () => {
  const assignedInTenant = (co: Company, token: string) => tenantAudit(co, "COMPANY_OWNER_ASSIGNED", token);

  it("changes nothing when the platform audit cannot record the assignment", async () => {
    const c = await cloud();
    const co = await company(c, "foxtrot2");
    const peer = await secondAdmin(co);
    const before = await co.recorded();

    c.faults.auditRefuses = true;
    const refused = await c.router.assignOwner({ tenantId: co.tenantId, userId: peer.id, actor: "platform:op-1" }).catch((err: unknown) => err);
    c.faults.auditRefuses = false;

    expect(refused).toBeInstanceOf(PlatformAuditUnavailableError);
    expect(await co.recorded()).toEqual(before);
    expect(await assignedInTenant(co, peer.token)).toEqual([]);
  });

  it("writes the tenant's own row on the next open when it could not be written at the time, exactly once", async () => {
    const c = await cloud();
    const co = await company(c, "hotel2");
    const peer = await secondAdmin(co);
    const backend = await c.router.backendOf(co.tenantId);
    const record = backend.recordOwnerAssigned;
    backend.recordOwnerAssigned = async () => {
      throw new Error("the tenant database refused the row");
    };

    const assigned = await c.router.assignOwner({ tenantId: co.tenantId, userId: peer.id, actor: "platform:op-1" });
    const missing = await assignedInTenant(co, peer.token);
    backend.recordOwnerAssigned = record;
    await c.router.reconcileOwner("hotel2");
    await c.router.reconcileOwner("hotel2");

    expect(assigned).toMatchObject({ ownerUserId: peer.id });
    expect(missing).toEqual([]);
    expect(await assignedInTenant(co, peer.token)).toMatchObject([{ entityId: peer.id, actor: "platform:op-1", details: { confirmedBy: "platform-console" } }]);
    expect((await co.recorded()).ownerRecordDue ?? null).toBeNull();
  });

  it("writes the tenant's own row once even when it is asked to write the same event twice", async () => {
    const c = await cloud();
    const co = await company(c, "india2");
    const peer = await secondAdmin(co);
    const backend = await c.router.backendOf(co.tenantId);
    const event = { eventId: "evt-1", userId: peer.id, previousUserId: null, actor: "platform:op-1", confirmedBy: OwnerConfirmation.PlatformConsole };

    await backend.recordOwnerAssigned(event);
    await backend.recordOwnerAssigned(event);

    expect(await assignedInTenant(co, peer.token)).toHaveLength(1);
  });

  it("records the confirmation of a pending hand-over the same way", async () => {
    const c = await cloud();
    const co = await company(c, "kilo2");
    const peer = await secondAdmin(co);
    await ownerStepsDownOnConsolePin(c, co, peer.id);
    const backend = await c.router.backendOf(co.tenantId);
    const record = backend.recordOwnerAssigned;
    backend.recordOwnerAssigned = async () => {
      throw new Error("the tenant database refused the row");
    };

    await c.router.confirmPendingOwner({ tenantId: co.tenantId, actor: "platform:op-1" });
    backend.recordOwnerAssigned = record;
    await c.router.reconcileOwner("kilo2");

    expect(await assignedInTenant(co, peer.token)).toMatchObject([{ entityId: peer.id, details: { confirmedBy: "platform-console" } }]);
  });
});

describe("a console PIN reset the platform audit cannot record", () => {
  it("resets nothing: the owner's own PIN still signs in", async () => {
    const c = await cloud();
    const co = await company(c, "lima2");
    const fenceBefore = await c.platform.stores.signupRequests.takeProvisionFence(T);

    const refused = await resetTenantOwnerPin(
      { platform: c.platform, router: c.router },
      { tenant: await co.recorded(), actorId: "op-1", recordIntent: async () => { throw new PlatformAuditUnavailableError(new Error("down")); } },
    ).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(PlatformAuditUnavailableError);
    expect((await co.signIn("owner@lima2.example", co.ownerPin)).status).toBe(200);
    expect(await c.platform.stores.signupRequests.takeProvisionFence(T)).toBe(fenceBefore + 1);
  });

  it("writes its audit row before the PIN moves", async () => {
    const c = await cloud();
    const co = await company(c, "mike2");
    const order: string[] = [];
    const backend = await c.router.backendOf(co.tenantId);
    const resetPin = backend.resetOwnerPin;
    backend.resetOwnerPin = (cmd) => (order.push("pin"), resetPin(cmd));

    const reset = await resetTenantOwnerPin(
      { platform: c.platform, router: c.router },
      { tenant: await co.recorded(), actorId: "op-1", recordIntent: async () => void order.push("audit") },
    );

    expect(order).toEqual(["audit", "pin"]);
    expect((await co.signIn("owner@mike2.example", reset.adminPin)).status).toBe(200);
  });
});

describe("the audit of a console PIN reset", () => {
  const OPERATOR = { id: "PU-OP", email: "op@mezan.example", password: "correct horse battery" };

  async function console(c: Cloud) {
    await createPlatformUser({ ...OPERATOR, role: "owner", now: T }, c.platform.stores.platformUsers, c.platform.hasher);
    const auth = createPlatformAuth({ platform: c.platform, sessions: createSessionRegistry(), now });
    const signedIn = await auth.app.fetch(
      new Request("http://x/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }) }),
    );
    const { token, deviceSecret } = (await signedIn.json()) as { token: string; deviceSecret: string };
    const app = createPlatformRoutes({
      platform: c.platform,
      auth,
      now,
      provisionTenant: async () => {
        throw new Error("not used");
      },
      resetOwnerPin: (input) => resetTenantOwnerPin({ platform: c.platform, router: c.router, now }, input),
      invalidateEntitlements: (code) => c.router.invalidate(code),
    });
    const reset = async (tenantId: string) => {
      const res = await app.fetch(new Request(`http://x/tenants/${tenantId}/owner-pin/reset`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-mezan-device": deviceSecret } }));
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    const rows = async () =>
      (await c.platform.audit.query("security"))
        .filter((row) => row.action.startsWith("TENANT_OWNER_PIN_RESET"))
        .reverse()
        .map((row) => ({ action: row.action, actor: row.actor, severity: row.severity, entityId: row.entityId, details: row.details as Record<string, unknown> }));
    return { reset, rows };
  }

  it("records that the reset was asked for and then that it happened, each naming the account and the address that really got the PIN", async () => {
    const c = await cloud();
    const co = await company(c, "papa2");
    await ownerMovedWhilePlatformWasDown(c, co, "inbox@elsewhere.example");
    const owner = await co.user("inbox@elsewhere.example");
    const desk = await console(c);

    const answered = await desk.reset(co.tenantId);

    expect(answered.status).toBe(200);
    const account = { userId: owner["id"], signInEmail: "inbox@elsewhere.example", adminEmail: "owner@papa2.example" };
    expect(await desk.rows()).toMatchObject([
      { action: PlatformAuditAction.TenantOwnerPinResetRequested, actor: OPERATOR.id, severity: AuditSeverityCode.Critical, entityId: co.tenantId, details: account },
      { action: PlatformAuditAction.TenantOwnerPinReset, actor: OPERATOR.id, severity: AuditSeverityCode.Critical, entityId: co.tenantId, details: { ...account, outcome: OwnerPinResetOutcome.Reset } },
    ]);
    expect(JSON.stringify(await desk.rows())).not.toContain(String(answered.json["adminPin"]));
    expect((await co.signIn("inbox@elsewhere.example", String(answered.json["adminPin"]))).status).toBe(200);
  });

  it.each([OwnerPinResetOutcome.Superseded, OwnerPinResetOutcome.OwnerVanished])(
    "records that the reset was asked for and then refused (%s), and never says a PIN was reset when none was",
    async (outcome) => {
      const c = await cloud();
      const co = await company(c, "quebec2");
      const owner = await co.user("owner@quebec2.example");
      const backend = await c.router.backendOf(co.tenantId);
      backend.resetOwnerPin = async () => outcome;
      const desk = await console(c);

      const answered = await desk.reset(co.tenantId);

      expect(answered).toMatchObject({ status: 409, json: { error: "TENANT_OWNER_ACCOUNT_NOT_FOUND" } });
      expect(answered.json["adminPin"]).toBeUndefined();
      expect(await desk.rows()).toMatchObject([
        { action: PlatformAuditAction.TenantOwnerPinResetRequested, details: { userId: owner["id"], signInEmail: "owner@quebec2.example" } },
        { action: PlatformAuditAction.TenantOwnerPinResetRefused, severity: AuditSeverityCode.Critical, details: { reason: "TENANT_OWNER_ACCOUNT_NOT_FOUND", outcome } },
      ]);
      expect((await co.signIn("owner@quebec2.example", co.ownerPin)).status).toBe(200);
    },
  );
});

describe("the platform assigning a tenant's owner", () => {
  it("writes one CRITICAL platform row naming the operator, the previous owner and the new one, and clears a pending successor", async () => {
    const c = await cloud();
    const co = await company(c, "juno");
    const peer = await secondAdmin(co);
    const third = await secondAdmin(co, "third@juno.example");
    const { owner } = await ownerStepsDownOnConsolePin(c, co, peer.id);
    expect((await co.recorded()).pendingOwner).toMatchObject({ userId: peer.id });

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

describe("an owner's step-down the platform cannot record", () => {
  it("is committed first and handed over after: a platform that refuses the hand-over leaves the tenant flagged, not owned by the successor", async () => {
    const c = await cloud();
    const co = await company(c, "tango");
    const peer = await secondAdmin(co);
    const owner = await co.user("owner@tango.example");

    c.faults.ownerWriteRefuses = true;
    const stepped = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive", newOwnerUserId: peer.id });
    c.faults.ownerWriteRefuses = false;

    expect(stepped.status).toBe(200);
    expect(await tenantAudit(co, "COMPANY_OWNER_HAND_OVER", peer.token)).toMatchObject([{ details: { outcome: "failed" } }]);
    const users = (await co.call("GET", "/users", undefined, peer.token)).json as Record<string, unknown>[];
    expect(users.find((user) => user["id"] === owner["id"])?.["status"]).toBe("inactive");
    await c.router.reconcileOwner("tango");
    expect(await co.recorded()).toMatchObject({ ownerUserId: owner["id"], ownerEmail: "owner@tango.example", ownerNeeded: true });
  });

  it("is refused when the successor named is not an active company admin", async () => {
    const c = await cloud();
    const co = await company(c, "lima");
    await secondAdmin(co);
    const roles = (await co.call("GET", "/roles")).json as { id: string }[];
    const clerk = await co.call("POST", "/users", {
      nameAr: "موظف", nameEn: null, email: "clerk@lima.example", phone: null, roleId: roles[0]?.id, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active", password: "clerk-password-1", acknowledge: true, reason: "اختبار",
    });
    const owner = await co.user("owner@lima.example");
    const before = await co.recorded();

    const refused = await co.call("PUT", `/users/${String(owner["id"])}`, { ...owner, status: "inactive", newOwnerUserId: (clerk.json as Record<string, unknown>)["id"] });

    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ error: "OWNER_SUCCESSOR_REQUIRED" });
    expect(await co.recorded()).toEqual(before);
    expect((await co.user("owner@lima.example"))["status"]).toBe("active");
  });
});

describe("a tenant whose owner the platform does not know by id", () => {
  async function forgetOwnerId(c: Cloud, code: string): Promise<TenantRouter> {
    await c.router.close();
    const raw = openSqliteConnection(path.join(c.dataDir, "platform.db")).sqlite;
    raw.prepare("UPDATE tenant SET owner_user_id = NULL WHERE code = ?").run(code);
    raw.close();
    const reopened = reachableRouter({ platform: c.platform, dataDir: c.dataDir, sweepEveryMs: 0, now });
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
    expect(bareErase.status).toBe(403);
    expect(bareErase.json).toMatchObject(OWNER_ERASURE_REFUSAL);
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

describe("an owner change racing another one", () => {
  const START = new Date("2026-10-12T10:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const ADMINS = [
    { id: "U-OWNER", nameAr: "المالك", email: "owner@x.example" },
    { id: "U-X", nameAr: "س", email: "x@x.example" },
    { id: "U-Y", nameAr: "ص", email: "y@x.example" },
  ];
  const PLATFORM_ACTOR = "platform:P";

  interface Desk {
    readonly platform: PlatformHandle;
    readonly contact: OwnerContact;
    readonly mails: PendingHandOverMail[];
    readonly clock: { at: Date };
    readonly id: string;
    readonly dataDir: string;
    stored(): Promise<Tenant>;
    nominate(toUserId: string, toEmail: string): ReturnType<OwnerContact["handOver"]>;
  }

  async function desk(): Promise<Desk> {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-owner-race-"));
    dirs.push(dir);
    const clock = { at: START };
    const platform = await createPlatform({ dbPath: path.join(dir, "platform.db"), now: () => clock.at });
    platforms.push(platform);
    const tenant = await createTenant({ id: "T-RACE", code: "race", nameAr: "شركة", ownerEmail: "owner@x.example", now: START.toISOString() }, platform.stores.tenants);
    const active = await activateTenant({ id: tenant.id, now: START.toISOString() }, platform.stores.tenants);
    await platform.stores.tenants.save({ ...active, ownerUserId: "U-OWNER" });
    const mails: PendingHandOverMail[] = [];
    let issued = 0;
    const contact = createOwnerContact({
      platform,
      now: () => clock.at,
      mailPendingHandOver: async (mail) => void mails.push(mail),
      tokenOf: () => `tok-${(issued += 1)}`,
    });
    const stored = async () => (await platform.stores.tenants.findById(tenant.id))!;
    const nominate: Desk["nominate"] = (toUserId, toEmail) => contact.handOver(tenant.id, { fromUserId: "U-OWNER", toUserId, toEmail, actorId: "U-Y" });
    return { platform, contact, mails, clock, id: tenant.id, dataDir: dir, stored, nominate };
  }

  it("does not confirm a successor other than the one the mailed link was for, when the request is replaced while the link is being confirmed", async () => {
    const d = await desk();
    await d.nominate("U-X", "x@x.example");
    const recorded: string[] = [];
    const backend = {
      recordOwnerAssigned: async (due: { userId: string }) => void recorded.push(due.userId),
      companyAdmins: async () => {
        await d.nominate("U-Y", "y@x.example");
        return ADMINS;
      },
    };

    const refused = await d.contact
      .confirmPending(d.id, PREVIOUS_OWNER_ACTOR, OwnerConfirmation.PreviousOwnerLink, backend, { tokenHash: hashHandOverToken("tok-1") })
      .catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(NoPendingOwnerError);
    expect(await d.stored()).toMatchObject({ ownerUserId: "U-OWNER", ownerEmail: "owner@x.example", pendingOwner: { userId: "U-Y" } });
    expect((await d.stored()).ownerRecordDue ?? null).toBeNull();
    expect(recorded).toEqual([]);
  });

  it("does not confirm from the console a successor other than the one it read, when the request is replaced meanwhile", async () => {
    const d = await desk();
    await d.nominate("U-X", "x@x.example");
    const backend = {
      recordOwnerAssigned: async () => undefined,
      companyAdmins: async () => {
        await d.nominate("U-Y", "y@x.example");
        return ADMINS;
      },
    };

    const refused = await d.contact.confirmPending(d.id, PLATFORM_ACTOR, OwnerConfirmation.PlatformConsole, backend).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(NoPendingOwnerError);
    expect(await d.stored()).toMatchObject({ ownerUserId: "U-OWNER", pendingOwner: { userId: "U-Y" } });
  });

  it("does not answer a link whose token was replaced by a resend for the same successor", async () => {
    const d = await desk();
    await d.nominate("U-X", "x@x.example");
    await d.contact.resendPending(d.id, PLATFORM_ACTOR);
    const backend = { recordOwnerAssigned: async () => undefined, companyAdmins: async () => ADMINS };

    const refused = await d.contact
      .confirmPending(d.id, PREVIOUS_OWNER_ACTOR, OwnerConfirmation.PreviousOwnerLink, backend, { tokenHash: hashHandOverToken("tok-1") })
      .catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(NoPendingOwnerError);
    expect((await d.stored()).ownerUserId).toBe("U-OWNER");
  });

  describe("through the router the mailed link is answered by", () => {
    interface Routed {
      readonly router: TenantRouter;
      readonly work: { companyAdmins: number; recorded: number };
    }

    function routed(d: Desk, dataDir: string, during: { opening?: (router: TenantRouter) => Promise<unknown>; readingAdmins?: (router: TenantRouter) => Promise<unknown> }): Routed {
      mkdirSync(path.join(dataDir, "tenants"), { recursive: true });
      const { sqlite } = openSqliteConnection(path.join(dataDir, "tenants", `${d.id}.db`));
      bindTenantDatabase(sqlite, d.id);
      sqlite.close();
      const work = { companyAdmins: 0, recorded: 0 };
      const backend = {
        ownerAccount: async () => ({ id: "U-OWNER", email: "owner@x.example", canAdminister: true }),
        recordOwnerAssigned: async () => void (work.recorded += 1),
        companyAdmins: async () => {
          work.companyAdmins += 1;
          await during.readingAdmins?.(router);
          return ADMINS;
        },
        close: () => undefined,
      } as unknown as BackendHandle;
      const router: TenantRouter = createTenantRouter({
        platform: d.platform,
        dataDir,
        sweepEveryMs: 0,
        now: () => d.clock.at,
        mailPendingHandOver: async (mail) => void d.mails.push(mail),
        openBackend: async () => {
          await during.opening?.(router);
          return backend;
        },
      });
      routers.push(router);
      return { router, work };
    }

    function resendOnce(d: Desk): (router: TenantRouter) => Promise<unknown> {
      let sent = false;
      return async (router) => {
        if (sent) return;
        sent = true;
        await router.resendPendingOwner({ tenantId: d.id, actor: PLATFORM_ACTOR });
      };
    }

    it("does not confirm on the old link when the console sends a new one while the tenant's admins are being read", async () => {
      const d = await desk();
      await d.nominate("U-X", "x@x.example");
      const { router } = routed(d, d.dataDir, { readingAdmins: resendOnce(d) });

      const byOldLink = await router.confirmPendingOwnerByToken("tok-1");

      expect(byOldLink).toBeNull();
      expect(d.mails).toHaveLength(2);
      expect(await d.stored()).toMatchObject({ ownerUserId: "U-OWNER", ownerEmail: "owner@x.example", pendingOwner: { userId: "U-X", tokenHash: hashHandOverToken(d.mails[1]?.token ?? "") } });
      expect(await router.confirmPendingOwnerByToken(d.mails[1]?.token ?? "")).toMatchObject({ ownerUserId: "U-X" });
    });

    it("does none of the tenant's work for a link that was replaced while the tenant's database was being opened", async () => {
      const d = await desk();
      await d.nominate("U-X", "x@x.example");
      const { router, work } = routed(d, d.dataDir, { opening: resendOnce(d) });

      const byOldLink = await router.confirmPendingOwnerByToken("tok-1");

      expect(byOldLink).toBeNull();
      expect(work).toEqual({ companyAdmins: 0, recorded: 0 });
      expect(await d.stored()).toMatchObject({ ownerUserId: "U-OWNER", pendingOwner: { userId: "U-X" } });
    });
  });

  it("refuses a confirmation that crossed the seven days while the tenant's admins were being read", async () => {
    const d = await desk();
    await d.nominate("U-X", "x@x.example");
    const backend = {
      recordOwnerAssigned: async () => undefined,
      companyAdmins: async () => {
        d.clock.at = new Date(START.getTime() + 8 * DAY_MS);
        return ADMINS;
      },
    };

    const refused = await d.contact.confirmPending(d.id, PLATFORM_ACTOR, OwnerConfirmation.PlatformConsole, backend).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(PendingOwnerExpiredError);
    expect(await d.stored()).toMatchObject({ ownerUserId: "U-OWNER", pendingOwner: { userId: "U-X" } });
  });

  it("takes a nomination again once the first one lapsed: a new link is mailed and the seven days restart", async () => {
    const d = await desk();
    expect(await d.nominate("U-X", "x@x.example")).toBe("pending");
    const lapsedAt = (await d.stored()).pendingOwner?.expiresAt;
    d.clock.at = new Date(START.getTime() + 8 * DAY_MS);

    const again = await d.nominate("U-X", "x@x.example");

    expect(again).toBe("pending");
    expect(d.mails.map((mail) => mail.token)).toEqual(["tok-1", "tok-2"]);
    expect(lapsedAt).toBe(pendingOwnerExpiresAt(START.toISOString()));
    expect((await d.stored()).pendingOwner).toMatchObject({ userId: "U-X", expiresAt: pendingOwnerExpiresAt(d.clock.at.toISOString()), tokenHash: hashHandOverToken("tok-2") });
    expect(await d.contact.pendingByToken("tok-1")).toBeNull();
    expect((await d.contact.pendingByToken("tok-2"))?.id).toBe(d.id);
  });

  it("answers a nomination repeated inside the seven days with the outcome it already has, and mails nothing more", async () => {
    const d = await desk();
    await d.nominate("U-X", "x@x.example");
    d.clock.at = new Date(START.getTime() + 6 * DAY_MS);

    expect(await d.nominate("U-X", "x@x.example")).toBe("pending");
    expect(d.mails).toHaveLength(1);
  });

  it("refuses a second console assignment, retryably, while the tenant's own record of the first is still unwritten, and writes both in order once it can", async () => {
    const d = await desk();
    const written: string[] = [];
    const tenantDb = { down: true };
    const backend = {
      companyAdmins: async () => ADMINS,
      recordOwnerAssigned: async (due: { userId: string }) => {
        if (tenantDb.down) throw new Error("tenant db busy");
        written.push(due.userId);
      },
    };
    await d.contact.assign(d.id, "U-X", PLATFORM_ACTOR, backend);

    const refused = await d.contact.assign(d.id, "U-Y", PLATFORM_ACTOR, backend).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(OwnerRecordDueError);
    expect(refused).toMatchObject({ code: "TENANT_OWNER_RECORD_DUE", retryable: true, message: "سجل المالك السابق لم يُكتب بعد في بيانات المنشأة. أعد المحاولة بعد لحظات." });
    expect(await d.stored()).toMatchObject({ ownerUserId: "U-X", ownerRecordDue: { userId: "U-X" } });

    tenantDb.down = false;
    await d.contact.assign(d.id, "U-Y", PLATFORM_ACTOR, backend);

    expect(written).toEqual(["U-X", "U-Y"]);
    expect(await d.stored()).toMatchObject({ ownerUserId: "U-Y" });
    expect((await d.stored()).ownerRecordDue ?? null).toBeNull();
  });

  it("refuses to confirm a pending hand-over while the tenant's own record of an earlier assignment is still unwritten", async () => {
    const d = await desk();
    const tenantDb = { down: true };
    const written: string[] = [];
    const backend = {
      companyAdmins: async () => ADMINS,
      recordOwnerAssigned: async (due: { userId: string }) => {
        if (tenantDb.down) throw new Error("tenant db busy");
        written.push(due.userId);
      },
    };
    await d.contact.assign(d.id, "U-X", PLATFORM_ACTOR, backend);
    await d.contact.handOver(d.id, { fromUserId: "U-X", toUserId: "U-Y", toEmail: "y@x.example", actorId: "U-OWNER" });

    const refused = await d.contact.confirmPending(d.id, PLATFORM_ACTOR, OwnerConfirmation.PlatformConsole, backend).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(OwnerRecordDueError);
    expect(await d.stored()).toMatchObject({ ownerUserId: "U-X", pendingOwner: { userId: "U-Y" }, ownerRecordDue: { userId: "U-X" } });

    tenantDb.down = false;
    await d.contact.confirmPending(d.id, PLATFORM_ACTOR, OwnerConfirmation.PlatformConsole, backend);

    expect(written).toEqual(["U-X", "U-Y"]);
  });
});
