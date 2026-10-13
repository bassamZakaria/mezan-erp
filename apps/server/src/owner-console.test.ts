import { afterEach, describe, expect, it } from "vitest";
import type { SmtpConfig } from "@mezan/api";
import { bootCloudHarness, type CloudHarness, type SendInit } from "./cloud-harness.js";
import { MailOutcome, type PlatformMail } from "./platform-mail.js";

const harnesses: CloudHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

const SMTP: SmtpConfig = {
  smtpEnabled: true, smtpHost: "smtp.mezan.test", smtpPort: 465, smtpSecurity: "TLS", smtpUsername: "mailer", smtpPassword: "mail-pass",
  smtpFromName: "ميزان", smtpFromEmail: "no-reply@mezan.test",
};

interface Sent {
  readonly to: string;
  readonly mail: PlatformMail;
}

interface World {
  readonly cloud: CloudHarness;
  readonly sent: Sent[];
  readonly platform: string;
  readonly tenantId: string;
  readonly ownerPin: string;
  platformCall(method: string, route: string, body?: unknown, token?: string | null): Promise<{ status: number; json: Record<string, unknown> }>;
  tenantCall(method: string, route: string, token: string, body?: unknown): Promise<{ status: number; json: unknown }>;
  signIn(username: string, pin: string): Promise<string>;
}

interface Setup {
  readonly clock?: { at: Date };
  readonly mailFails?: { on: boolean };
}

async function world(vars: Record<string, string> = { MEZAN_PUBLIC_URL: "https://app.mezan.example" }, setup: Setup = {}): Promise<World> {
  const sent: Sent[] = [];
  const cloud = await bootCloudHarness({
    vars,
    env: { platformSmtp: SMTP },
    options: {
      ...(setup.clock ? { now: () => setup.clock!.at } : {}),
      mailer: {
        send: async (to, mail) => {
          if (setup.mailFails?.on) return { outcome: MailOutcome.Rejected, detail: "smtp down" };
          sent.push({ to, mail });
          return { outcome: MailOutcome.Sent };
        },
      },
    },
  });
  harnesses.push(cloud);
  const platform = await cloud.platformToken();
  const call = async (pathname: string, init: SendInit) => {
    const res = await cloud.send(pathname, init);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const platformCall: World["platformCall"] = (method, route, body, token = platform) =>
    call(`/api/platform${route}`, { method, ...(token ? { token } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const created = await platformCall("POST", "/tenants", {
    code: "nile", nameAr: "شركة النيل", ownerEmail: "owner@nile.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true,
  });
  expect(created.status).toBe(201);
  const tenantCall: World["tenantCall"] = async (method, route, token, body) => {
    const res = await cloud.send(`/api${route}`, { method, token, tenant: "nile", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const signIn: World["signIn"] = async (username, pin) => {
    const res = await cloud.send("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username, pin }) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  };
  return {
    cloud, sent, platform, platformCall, tenantCall, signIn,
    tenantId: String((created.json["tenant"] as Record<string, unknown>)["id"]),
    ownerPin: String(created.json["adminPin"]),
  };
}

async function addAdmin(w: World, ownerToken: string, email: string, pin: string): Promise<string> {
  const created = await w.tenantCall("POST", "/users", ownerToken, {
    nameAr: "مدير ثان", nameEn: null, email, phone: null, roleId: null, isCompanyAdmin: true, employeeId: null,
    branchScope: "*", warehouseScope: "*", status: "active", password: "second-password-1", pin, acknowledge: true, reason: "اختبار",
  });
  expect(created.status).toBe(201);
  return String((created.json as Record<string, unknown>)["id"]);
}

const tenantOf = (json: Record<string, unknown>) => json["tenant"] as Record<string, unknown>;

async function ownerStepsDownOnConsolePin(w: World): Promise<{ peer: string; peerToken: string; owner: Record<string, unknown> }> {
  const ownerToken = await w.signIn("owner@nile.example", w.ownerPin);
  const owner = ((await w.tenantCall("GET", "/users", ownerToken)).json as Record<string, unknown>[]).find((user) => user["email"] === "owner@nile.example") ?? {};
  const peer = await addAdmin(w, ownerToken, "second@nile.example", "222222");
  const peerToken = await w.signIn("second@nile.example", "222222");
  const reset = await w.platformCall("POST", `/tenants/${w.tenantId}/owner-pin/reset`);
  const session = await w.signIn("owner@nile.example", String(reset.json["adminPin"]));
  const stepped = await w.tenantCall("PUT", `/users/${String(owner["id"])}`, session, { ...owner, status: "inactive", newOwnerUserId: peer });
  expect(stepped.status).toBe(200);
  return { peer, peerToken, owner };
}

describe("the platform owner assigns a tenant's owner from the console", () => {
  it("lists the tenant's active company admins, to the platform owner only", async () => {
    const w = await world();
    const ownerToken = await w.signIn("owner@nile.example", w.ownerPin);
    const second = await addAdmin(w, ownerToken, "second@nile.example", "222222");

    const listed = await w.cloud.send(`/api/platform/tenants/${w.tenantId}/owner/candidates`, { token: w.platform });
    const unauthenticated = await w.platformCall("GET", `/tenants/${w.tenantId}/owner/candidates`, undefined, null);
    const asTenant = await w.platformCall("GET", `/tenants/${w.tenantId}/owner/candidates`, undefined, ownerToken);

    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { id: string; email: string }[]).map((admin) => admin.email).sort()).toEqual(["owner@nile.example", "second@nile.example"]);
    expect(second).not.toBe("");
    expect(unauthenticated.status).toBe(401);
    expect(asTenant.status).toBe(401);
  });

  it("makes the chosen admin the verified owner, with a CRITICAL row inside the tenant naming the platform operator", async () => {
    const w = await world();
    const ownerToken = await w.signIn("owner@nile.example", w.ownerPin);
    const second = await addAdmin(w, ownerToken, "second@nile.example", "222222");

    const assigned = await w.platformCall("POST", `/tenants/${w.tenantId}/owner`, { userId: second });

    expect(assigned.status).toBe(200);
    expect(tenantOf(assigned.json)).toMatchObject({ ownerEmail: "second@nile.example", ownerContactVerified: true, ownerNeeded: false, pendingOwner: null });
    const audit = (await w.tenantCall("GET", "/audit?stream=security&action=COMPANY_OWNER_ASSIGNED", ownerToken)).json as { events: Record<string, unknown>[] };
    expect(audit.events).toMatchObject([{ entityId: second, severity: "CRITICAL", details: { confirmedBy: "platform-console" } }]);
    expect(String(audit.events[0]?.["actor"])).toMatch(/^platform:/);
    const reset = await w.platformCall("POST", `/tenants/${w.tenantId}/owner-pin/reset`);
    expect(reset.json).toMatchObject({ adminEmail: "second@nile.example", signInEmail: "second@nile.example" });
  });

  it("refuses an account that is not an active admin of that tenant, in Arabic, and changes nothing", async () => {
    const w = await world();
    const before = tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json);

    const refused = await w.platformCall("POST", `/tenants/${w.tenantId}/owner`, { userId: "nobody" });
    const empty = await w.platformCall("POST", `/tenants/${w.tenantId}/owner`, {});

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ error: "TENANT_OWNER_CANDIDATE_NOT_FOUND", message: "الحساب المختار ليس مديرًا نشطًا في هذه المنشأة" });
    expect(empty.status).toBe(400);
    expect(tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json)).toEqual(before);
  });

  it("lets a peer admin erase the former owner only after the console has assigned another owner, and refuses it in Arabic before", async () => {
    const w = await world();
    const ownerToken = await w.signIn("owner@nile.example", w.ownerPin);
    const owner = ((await w.tenantCall("GET", "/users", ownerToken)).json as Record<string, unknown>[]).find((user) => user["email"] === "owner@nile.example") ?? {};
    const peer = await addAdmin(w, ownerToken, "second@nile.example", "222222");
    const peerToken = await w.signIn("second@nile.example", "222222");
    const erase = () => w.tenantCall("POST", `/users/${String(owner["id"])}/erase`, peerToken, { confirmEmail: "owner@nile.example", reason: "طلب محو", newOwnerUserId: peer });

    const before = await erase();
    const assigned = await w.platformCall("POST", `/tenants/${w.tenantId}/owner`, { userId: peer });
    const after = await erase();

    expect(before.status).toBe(403);
    expect(before.json).toMatchObject({
      error: "OWNER_ACCOUNT_PROTECTED",
      message: "هذا حساب مالك المنشأة ولا تُمحى بياناته. ينقل المالك ملكية المنشأة إلى مدير آخر أولًا، وبعدها يُمحى حسابه كأي حساب آخر.",
    });
    expect(assigned.status).toBe(200);
    expect(after.status).toBe(200);
    expect(after.json).toMatchObject({ alreadyErased: false });
    expect(tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json)).toMatchObject({ ownerEmail: "second@nile.example", ownerContactVerified: true });
  });

  it("shows a hand-over the owner asked for on a console-issued PIN as pending, and confirming it makes the successor the verified owner once", async () => {
    const w = await world();
    const { peer } = await ownerStepsDownOnConsolePin(w);

    const pending = tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json);
    expect(pending).toMatchObject({ ownerEmail: "owner@nile.example", pendingOwner: { userId: peer, email: "second@nile.example" } });
    expect(JSON.stringify(pending)).not.toContain("tokenHash");

    const confirmed = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/confirm`);
    const again = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/confirm`);

    expect(confirmed.status).toBe(200);
    expect(tenantOf(confirmed.json)).toMatchObject({ ownerEmail: "second@nile.example", ownerContactVerified: true, pendingOwner: null });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ error: "TENANT_NO_PENDING_OWNER", message: "لا يوجد مالك بانتظار التأكيد لهذه المنشأة" });
  });

  it("mails the previously recorded owner a link on the configured origin, and the link confirms the hand-over exactly once", async () => {
    const w = await world();
    await ownerStepsDownOnConsolePin(w);

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]?.to).toBe("owner@nile.example");
    const link = /https:\/\/\S+/.exec(w.sent[0]?.mail.body ?? "")?.[0] ?? "";
    expect(link.startsWith("https://app.mezan.example/signup/owner-handover?token=")).toBe(true);
    expect(w.sent[0]?.mail.body).toContain("second@nile.example");
    const token = new URL(link).searchParams.get("token") ?? "";
    const confirm = (value: string) => w.cloud.send("/api/signup/owner-handover", { method: "POST", body: JSON.stringify({ token: value }) });

    const wrong = await confirm(`${token}x`);
    const first = await confirm(token);
    const second = await confirm(token);

    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: "OWNER_HANDOVER_LINK_INVALID", message: "رابط التأكيد غير صالح أو سبق استخدامه." });
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json)).toMatchObject({ ownerEmail: "second@nile.example", ownerContactVerified: true, pendingOwner: null });
  });

  it("records the hand-over as pending with no link when no public origin is configured, so only the console can confirm it", async () => {
    const w = await world({});
    const { peer } = await ownerStepsDownOnConsolePin(w);

    expect(w.sent).toEqual([]);
    expect(tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json)).toMatchObject({ pendingOwner: { userId: peer } });
    expect((await w.platformCall("POST", `/tenants/${w.tenantId}/owner/confirm`)).status).toBe(200);
  });
});

describe("a pending hand-over that is not confirmed", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const START = new Date("2026-10-13T09:00:00.000Z");
  const tokenIn = (w: World, index: number) => new URL(/https:\/\/\S+/.exec(w.sent[index]?.mail.body ?? "")?.[0] ?? "https://none.invalid").searchParams.get("token") ?? "";
  const confirmByLink = (w: World, token: string) => w.cloud.send("/api/signup/owner-handover", { method: "POST", body: JSON.stringify({ token }) });
  const pendingOf = async (w: World) => tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json)["pendingOwner"] as Record<string, unknown> | null;

  async function pendingWorld(setup: Setup = {}, vars?: Record<string, string>) {
    const clock = { at: START };
    const w = await world(vars, { clock, ...setup });
    const made = await ownerStepsDownOnConsolePin(w);
    return { w, clock, ...made };
  }

  it("stops answering its link seven days after it was asked for, with the same answer a wrong link gets, and shows when it lapses", async () => {
    const { w, clock } = await pendingWorld();
    const token = tokenIn(w, 0);
    expect(await pendingOf(w)).toMatchObject({ requestedAt: START.toISOString(), expiresAt: new Date(START.getTime() + 7 * DAY).toISOString(), linkMailed: true });

    clock.at = new Date(START.getTime() + 7 * DAY);
    const late = await confirmByLink(w, token);
    const wrong = await confirmByLink(w, "not-a-token");

    expect(late.status).toBe(400);
    expect(await late.json()).toEqual(await wrong.json());
    expect(tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json)).toMatchObject({ ownerEmail: "owner@nile.example", pendingOwner: { email: "second@nile.example" } });
  });

  it("still answers its link one second before the seven days are up", async () => {
    const { w, clock } = await pendingWorld();

    clock.at = new Date(START.getTime() + 7 * DAY - 1000);

    expect((await confirmByLink(w, tokenIn(w, 0))).status).toBe(200);
  });

  it("is refused in Arabic from the console too once it has lapsed, until the link is sent again", async () => {
    const { w, clock } = await pendingWorld();
    const first = tokenIn(w, 0);
    clock.at = new Date(START.getTime() + 8 * DAY);

    const lapsed = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/confirm`);
    const resent = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/resend`);

    expect(lapsed.status).toBe(409);
    expect(lapsed.json).toMatchObject({ error: "TENANT_PENDING_OWNER_EXPIRED", message: "انتهت مهلة تأكيد نقل الملكية. أرسل رابط التأكيد من جديد أو ألغِ الطلب." });
    expect(resent.status).toBe(200);
    expect(tenantOf(resent.json)["pendingOwner"]).toMatchObject({ requestedAt: clock.at.toISOString(), linkMailed: true });
    expect(w.sent).toHaveLength(2);
    expect(w.sent[1]?.to).toBe("owner@nile.example");
    expect((await confirmByLink(w, first)).status).toBe(400);
    expect((await confirmByLink(w, tokenIn(w, 1))).status).toBe(200);
  });

  it("is declined from the console by the platform owner only: the request is dropped and its link stops answering", async () => {
    const { w } = await pendingWorld();
    const token = tokenIn(w, 0);

    const declined = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/decline`);
    const again = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/decline`);
    const unauthenticated = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/decline`, undefined, null);

    expect(declined.status).toBe(200);
    expect(tenantOf(declined.json)).toMatchObject({ ownerEmail: "owner@nile.example", pendingOwner: null });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ error: "TENANT_NO_PENDING_OWNER", message: "لا يوجد مالك بانتظار التأكيد لهذه المنشأة" });
    expect(unauthenticated.status).toBe(401);
    expect((await confirmByLink(w, token)).status).toBe(400);
  });

  it("says no link was mailed when the mail could not be delivered, to the owner and on the console, and that link confirms nothing", async () => {
    const mailFails = { on: true };
    const clock = { at: START };
    const w = await world(undefined, { clock, mailFails });
    const ownerToken = await w.signIn("owner@nile.example", w.ownerPin);
    const owner = ((await w.tenantCall("GET", "/users", ownerToken)).json as Record<string, unknown>[]).find((user) => user["email"] === "owner@nile.example") ?? {};
    const peer = await addAdmin(w, ownerToken, "second@nile.example", "222222");
    const reset = await w.platformCall("POST", `/tenants/${w.tenantId}/owner-pin/reset`);
    const session = await w.signIn("owner@nile.example", String(reset.json["adminPin"]));

    const stepped = await w.tenantCall("PUT", `/users/${String(owner["id"])}`, session, { ...owner, status: "inactive", newOwnerUserId: peer });

    expect(stepped.json).toMatchObject({ ownerHandOver: "pending_unmailed" });
    expect(await pendingOf(w)).toMatchObject({ email: "second@nile.example", linkMailed: false });
    mailFails.on = false;
    const resent = await w.platformCall("POST", `/tenants/${w.tenantId}/owner/resend`);
    expect(tenantOf(resent.json)["pendingOwner"]).toMatchObject({ linkMailed: true });
    expect(w.sent).toHaveLength(1);
  });

  it("says a link was mailed when one was", async () => {
    const { w } = await pendingWorld();

    expect(await pendingOf(w)).toMatchObject({ linkMailed: true });
  });

  it("says no link was mailed when no public origin is configured", async () => {
    const { w } = await pendingWorld({}, {});

    expect(await pendingOf(w)).toMatchObject({ linkMailed: false });
    expect(w.sent).toEqual([]);
  });
});

describe("a platform operator who is not the platform owner", () => {
  const SUPPORT = { email: "support@mezan.local", password: "support-password-123" };

  async function supportToken(w: World): Promise<string> {
    const created = await w.platformCall("POST", "/users", { ...SUPPORT, role: "support" });
    expect(created.status).toBe(201);
    const signedIn = await w.cloud.send("/api/platform/auth/login", { method: "POST", body: JSON.stringify(SUPPORT) });
    expect(signedIn.status).toBe(200);
    return ((await signedIn.json()) as { token: string }).token;
  }

  it.each([
    ["list the candidates for owner", "GET", "/owner/candidates", undefined],
    ["assign an owner", "POST", "/owner", { userId: "any" }],
    ["confirm a pending hand-over", "POST", "/owner/confirm", undefined],
    ["decline a pending hand-over", "POST", "/owner/decline", undefined],
    ["send the confirmation link again", "POST", "/owner/resend", undefined],
    ["release the tenant", "POST", "/release", undefined],
    ["reset the owner's PIN", "POST", "/owner-pin/reset", undefined],
  ])("cannot %s: 403, and the tenant's owner, its pending hand-over and its link are as they were", async (_label, method, route, body) => {
    const clock = { at: new Date("2026-10-12T10:00:00.000Z") };
    const w = await world(undefined, { clock });
    const { peer } = await ownerStepsDownOnConsolePin(w);
    const support = await supportToken(w);
    const before = tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json);
    const mailsBefore = w.sent.length;

    const refused = await w.platformCall(method, `/tenants/${w.tenantId}${route}`, body, support);

    expect(refused.status).toBe(403);
    expect(refused.json["adminPin"]).toBeUndefined();
    expect(tenantOf((await w.platformCall("GET", `/tenants/${w.tenantId}`)).json)).toEqual(before);
    expect(before).toMatchObject({ ownerEmail: "owner@nile.example", status: "active", pendingOwner: { userId: peer } });
    expect(w.sent).toHaveLength(mailsBefore);
  });
});

describe("the link a signup mails", () => {
  const body = (code: string) =>
    JSON.stringify({ code, nameAr: "متجر الياسمين", ownerEmail: `owner@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly" });

  it("is built on the configured public origin, never on a forwarded host the caller wrote", async () => {
    const w = await world();

    const started = await w.cloud.send("/api/signup", {
      method: "POST", body: body("forged"), headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "http", host: "evil.example" },
    });

    expect(started.status).toBe(201);
    expect(await started.json()).toEqual({ devVerifyUrl: null });
    const mail = w.sent.find((entry) => entry.to === "owner@forged.example");
    const links = (mail?.mail.body ?? "").match(/https?:\/\/\S+/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.startsWith("https://app.mezan.example/signup/verify?token=")).toBe(true);
    expect(mail?.mail.body).not.toContain("evil.example");
  });

  it.each(["2130706433/x?.mezan.example", "[::1]/?.mezan.example", "user@evil.example/?.mezan.example"])(
    "is never built on a forwarded host that only ends in the tenant domain: %s",
    async (hostile) => {
      const w = await world({ MEZAN_PUBLIC_URL: "https://app.mezan.example", MEZAN_TENANT_DOMAIN: "mezan.example" });

      const started = await w.cloud.send("/api/signup", { method: "POST", body: body("victim"), headers: { "x-forwarded-host": hostile } });

      expect(started.status).toBe(201);
      const links = (w.sent.find((entry) => entry.to === "owner@victim.example")?.mail.body ?? "").match(/https?:\/\/\S+/g) ?? [];
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(new URL(link).origin).toBe("https://app.mezan.example");
    },
  );

  it("is built on the tenant subdomain the request really arrived on", async () => {
    const w = await world({ MEZAN_PUBLIC_URL: "https://app.mezan.example", MEZAN_TENANT_DOMAIN: "mezan.example" });

    await w.cloud.send("/api/signup", { method: "POST", body: body("honest"), headers: { "x-forwarded-host": "nile.mezan.example" } });

    const links = (w.sent.find((entry) => entry.to === "owner@honest.example")?.mail.body ?? "").match(/https?:\/\/\S+/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(new URL(link).origin).toBe("https://nile.mezan.example");
  });

  it.each(["honest.mezan.example", "www.mezan.example", "blog.mezan.example"])(
    "is built on the configured origin when the request arrived on %s, a subdomain no tenant answers on",
    async (host) => {
      const w = await world({ MEZAN_PUBLIC_URL: "https://app.mezan.example", MEZAN_TENANT_DOMAIN: "mezan.example" });

      const started = await w.cloud.send("/api/signup", { method: "POST", body: body("honest"), headers: { "x-forwarded-host": host } });

      expect(started.status).toBe(201);
      const links = (w.sent.find((entry) => entry.to === "owner@honest.example")?.mail.body ?? "").match(/https?:\/\/\S+/g) ?? [];
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(new URL(link).origin).toBe("https://app.mezan.example");
    },
  );

  it("is refused when no public origin is configured and the request arrived on a subdomain no tenant answers on", async () => {
    const w = await world({ MEZAN_TENANT_DOMAIN: "mezan.example" });

    const started = await w.cloud.send("/api/signup", { method: "POST", body: body("honest"), headers: { "x-forwarded-host": "honest.mezan.example" } });

    expect(started.status).toBe(503);
    expect(await started.json()).toMatchObject({ error: "SIGNUP_LINK_ORIGIN_UNKNOWN" });
    expect(w.sent).toEqual([]);
  });

  it("is refused, with no mail and no signup recorded, when mail is configured but no origin can be trusted", async () => {
    const w = await world({});

    const started = await w.cloud.send("/api/signup", { method: "POST", body: body("nowhere"), headers: { "x-forwarded-host": "evil.example" } });

    expect(started.status).toBe(503);
    expect(await started.json()).toMatchObject({ error: "SIGNUP_LINK_ORIGIN_UNKNOWN", message: "التسجيل غير متاح الآن. حاول لاحقًا أو تواصل مع الدعم." });
    expect(w.sent).toEqual([]);
    const free = await w.cloud.send("/api/signup/check-code?code=nowhere");
    expect(await free.json()).toEqual({ available: true });
  });
});

describe("a company code the platform keeps for itself", () => {
  const signup = (code: string) =>
    JSON.stringify({ code, nameAr: "متجر الياسمين", ownerEmail: `owner@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly" });

  it.each(["platform", "released-abc", "api", "www", "admin", "demo"])("is refused at signup in Arabic and reported as taken: %s", async (code) => {
    const w = await world();

    const started = await w.cloud.send("/api/signup", { method: "POST", body: signup(code) });
    const checked = await w.cloud.send(`/api/signup/check-code?code=${code}`);

    expect(started.status).toBe(400);
    expect(String(((await started.json()) as { message: string }).message)).toContain("رمز المنشأة محجوز للنظام. اختر رمزًا آخر.");
    expect(await checked.json()).toEqual({ available: false });
    expect(w.sent).toEqual([]);
  });

  it("is refused when the platform owner creates a tenant from the console, and no tenant is recorded", async () => {
    const w = await world();

    const created = await w.platformCall("POST", "/tenants", {
      code: "platform", nameAr: "شركة", ownerEmail: "o@x.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true,
    });

    expect(created.status).toBe(422);
    expect(created.json).toMatchObject({ error: "TENANT_CODE_RESERVED", message: "رمز المنشأة محجوز للنظام. اختر رمزًا آخر." });
    const listed = await w.cloud.send("/api/platform/tenants", { token: w.platform });
    expect(((await listed.json()) as { tenant: { code: string } }[]).map((row) => row.tenant.code)).toEqual(["nile"]);
  });
});

describe("the local test checkout page", () => {
  it.each([
    ["opened", "GET", "/billing/test-checkout/no-such-checkout"],
    ["completed", "POST", "/billing/test-checkout/no-such-checkout/complete"],
  ])("answers in Arabic, never in English, when a checkout that does not exist is %s", async (_label, method, route) => {
    const cloud = await bootCloudHarness({ vars: { MEZAN_PAYMOB_TEST_MODE: "1" } });
    harnesses.push(cloud);

    const res = await cloud.send(route, { method });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("صفحة الدفع التجريبية غير موجودة");
  });
});
