import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmtpConfig } from "@mezan/api";
import { openSqliteConnection } from "@mezan/persistence";
import { CurrentSecretRefusal, type SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "./create-backend.js";

const OWNER = { nameAr: "المالك", nameEn: "Owner", email: "owner@shop.eg", pin: "731946", companyName: "متجر الاختبار" };
const PLATFORM_SMTP: SmtpConfig = {
  smtpEnabled: true, smtpHost: "smtp.mezan.test", smtpPort: 587, smtpSecurity: "STARTTLS",
  smtpUsername: "", smtpPassword: "", smtpFromName: "Mezan", smtpFromEmail: "no-reply@mezan.test",
};

const handles: BackendHandle[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const from = (address: string | null) => (address === null ? undefined : { incoming: { socket: { remoteAddress: address } } });

async function open(options: CreateBackendOptions = {}): Promise<BackendHandle> {
  const handle = await createBackend({ dbPath: ":memory:", ...options });
  handles.push(handle);
  return handle;
}

function post(h: BackendHandle, pathname: string, body: unknown, address: string | null, token?: string) {
  return h.app.fetch(
    new Request(`http://local${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    from(address),
  );
}

async function claim(h: BackendHandle): Promise<SessionDTO> {
  const res = await post(h, "/bootstrap/admin", OWNER, null);
  expect(res.status).toBe(201);
  return (await res.json()) as SessionDTO;
}

const signIn = (h: BackendHandle, pin: string, address: string | null, username = OWNER.email) => post(h, "/auth/login", { username, pin }, address);

async function twentyWrongPins(h: BackendHandle, addresses: (i: number) => string = (i) => `41.33.${i}.10`): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < 20; i += 1) statuses.push((await signIn(h, String(100000 + i), addresses(i))).status);
  return statuses;
}

describe("an account under twenty wrong PINs", () => {
  it("locks for every remote address, the right PIN included, and stays open at the machine itself", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);

    const statuses = await twentyWrongPins(h);
    expect(statuses.slice(0, 19)).toEqual(Array<number>(19).fill(401));
    expect(statuses[19]).toBe(423);

    const remote = await signIn(h, OWNER.pin, "196.221.5.5");
    expect(remote.status).toBe(423);
    expect(await remote.json()).toMatchObject({
      error: "ACCOUNT_LOCKED",
      unlockByCode: false,
      message: expect.stringContaining("اطلب من مدير النظام فكّ القفل"),
    });
    expect((await signIn(h, OWNER.pin, null)).status).toBe(200);
  }, 120_000);

  it("counts one IPv6 /64 as one caller and still stops it at twenty", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);
    const checked: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const res = await signIn(h, String(200000 + i), `2001:db8:1:2::${(i + 1).toString(16)}`);
      if (res.status === 401 || res.status === 423) checked.push(res.status);
    }
    expect(checked.filter((status) => status === 401).length).toBeLessThanOrEqual(5);
  }, 120_000);

  it("is still locked after the backend is closed and opened again on the same file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-sign-in-lock-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "tenant.db");
    const first = await createBackend({ dbPath });
    await claim(first);
    await twentyWrongPins(first);
    first.close();

    const second = await createBackend({ dbPath });
    handles.push(second);
    expect((await signIn(second, OWNER.pin, "196.221.5.5")).status).toBe(423);
  }, 120_000);

  it("is recorded as a critical security event and put in front of every company administrator", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    const session = await claim(h);
    await twentyWrongPins(h);

    const hostSession = (await (await signIn(h, OWNER.pin, null)).json()) as SessionDTO;
    const get = (pathname: string) => h.app.fetch(new Request(`http://local${pathname}`, { headers: { authorization: `Bearer ${hostSession.token}` } }));
    const notices = (await (await get("/notifications")).json()) as { title: string; body: string; recipientUserId?: string }[] | { items: { title: string; body: string }[] };
    const rows = Array.isArray(notices) ? notices : notices.items;
    const notice = rows.find((row) => row.title.includes("تم قفل حساب"));
    expect(notice?.body).toContain(OWNER.email);
    expect(notice?.body).toContain("فكّ القفل");

    const audit = await (await get("/audit?action=ACCOUNT_HARD_LOCKED")).text();
    expect(audit).toContain("ACCOUNT_HARD_LOCKED");
    expect(session.userId).toBeTruthy();
  }, 120_000);
});

describe("getting back into a locked account", () => {
  it("opens it again when an administrator unlocks it from the machine", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    const owner = await claim(h);
    await twentyWrongPins(h);
    const host = (await (await signIn(h, OWNER.pin, null)).json()) as SessionDTO;

    expect((await post(h, `/users/${owner.userId}/unlock`, {}, null, host.token)).status).toBe(200);
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(200);
  }, 120_000);

  it("opens it again, on this run and after a restart, when credentials are reset from outside the tenant's own routes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-admin-reset-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "tenant.sqlite");
    const h = await open({ dbPath });
    await claim(h);
    await twentyWrongPins(h);
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(423);

    await h.credentialsResetByAdministrator(OWNER.email);

    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(200);
    h.close();
    handles.splice(handles.indexOf(h), 1);
    const reopened = await open({ dbPath });
    expect((await signIn(reopened, OWNER.pin, "196.221.5.5")).status).toBe(200);
  }, 120_000);

  it("opens it again when an administrator resets its PIN", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    const owner = await claim(h);
    await twentyWrongPins(h);
    const host = (await (await signIn(h, OWNER.pin, null)).json()) as SessionDTO;

    const reset = await h.app.fetch(
      new Request(`http://local/users/${owner.userId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${host.token}` },
        body: JSON.stringify({
          nameAr: OWNER.nameAr, nameEn: OWNER.nameEn, email: OWNER.email, roleId: null, isCompanyAdmin: true,
          branchScope: "*", warehouseScope: "*", pin: "864201", currentPin: OWNER.pin,
        }),
      }),
    );
    expect(reset.status).toBe(200);
    expect((await signIn(h, "864201", "196.221.5.5")).status).toBe(200);
  }, 120_000);

  it("mails each administrator a one-time code when a mail server is configured, and the code opens the account once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: { to: string; subject: string; body: string }[] = [];
    const h = await open({
      securityMail: PLATFORM_SMTP,
      sendMail: async (_smtp, to, message) => {
        sent.push({ to, ...message });
        return { outcome: "sent", detail: "250" };
      },
    });
    await claim(h);
    const statuses = await twentyWrongPins(h);
    expect(statuses[19]).toBe(423);
    await h.drain();

    expect(sent.map((mail) => mail.to)).toEqual([OWNER.email]);
    const code = /: ([A-Z2-7]{16})/.exec(sent[0]!.body)?.[1];
    expect(code).toBeDefined();

    const locked = await signIn(h, OWNER.pin, "196.221.5.5");
    expect(await locked.json()).toMatchObject({ error: "ACCOUNT_LOCKED", unlockByCode: true, message: expect.stringContaining("رمز فكّ القفل") });

    const wrong = await post(h, "/auth/unlock", { username: OWNER.email, code: "AAAAAAAAAAAAAAAA" }, "196.221.5.5");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: "INVALID_UNLOCK_CODE" });
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(423);

    expect((await post(h, "/auth/unlock", { username: OWNER.email, code }, "196.221.5.5")).status).toBe(200);
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(200);
    expect((await post(h, "/auth/unlock", { username: OWNER.email, code }, "196.221.5.5")).status).toBe(400);
  }, 120_000);

  const LINK_BASE = "https://acme.mezan.test/unlock?token=";
  const linkIn = (body: string) => new RegExp(`${LINK_BASE.replace(/[.?]/g, "\\$&")}([A-Za-z0-9_-]{43})`).exec(body)?.[1];

  it("mails a single-use link built from the origin the deployment configured, and the link opens the account once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: { to: string; body: string }[] = [];
    const h = await open({
      securityMail: PLATFORM_SMTP,
      unlockLink: (token) => `${LINK_BASE}${token}`,
      sendMail: async (_smtp, to, message) => {
        sent.push({ to, body: message.body });
        return { outcome: "sent", detail: "250" };
      },
    });
    await claim(h);
    await twentyWrongPins(h);
    await h.drain();
    const token = linkIn(sent[0]!.body);
    expect(token).toBeDefined();

    const forged = await post(h, "/auth/unlock-link", { token: `${token!.slice(0, -4)}AAAA` }, "196.221.5.5");
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ error: "INVALID_UNLOCK_LINK", message: expect.stringMatching(/[\u0600-\u06FF]/) });
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(423);

    const opened = await post(h, "/auth/unlock-link", { token }, "196.221.5.5");
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ ok: true });
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(200);
    expect((await post(h, "/auth/unlock-link", { token }, "196.221.5.5")).status).toBe(400);

    const hostSession = (await (await signIn(h, OWNER.pin, null)).json()) as SessionDTO;
    const audit = (await (await h.app.fetch(new Request("http://local/audit?action=ACCOUNT_UNLOCKED_BY_LINK", { headers: { authorization: `Bearer ${hostSession.token}` } }))).text());
    expect(audit.match(/ACCOUNT_UNLOCKED_BY_LINK/g)).toHaveLength(1);
    expect(audit).not.toContain(token!);
  }, 120_000);

  it("mails the code alone where no origin is configured, whatever host the locking request named", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: string[] = [];
    const h = await open({
      securityMail: PLATFORM_SMTP,
      sendMail: async (_smtp, _to, message) => {
        sent.push(message.body);
        return { outcome: "sent", detail: "250" };
      },
    });
    await claim(h);
    for (let i = 0; i < 20; i += 1) {
      await h.app.fetch(
        new Request("http://local/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", host: "evil.example", "x-forwarded-host": "evil.example" },
          body: JSON.stringify({ username: OWNER.email, pin: String(100000 + i) }),
        }),
        from(`41.33.${i}.10`),
      );
    }
    await h.drain();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/[A-Z2-7]{16}/);
    expect(sent[0]).not.toMatch(/https?:|evil\.example/);
  }, 120_000);

  it("holds one address that keeps sending wrong unlock codes: it is told to wait, and the mailed code still opens the account from elsewhere", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: string[] = [];
    const h = await open({
      securityMail: PLATFORM_SMTP,
      sendMail: async (_smtp, _to, message) => {
        sent.push(message.body);
        return { outcome: "sent", detail: "250" };
      },
    });
    await claim(h);
    await twentyWrongPins(h);
    await h.drain();
    const code = /: ([A-Z2-7]{16})/.exec(sent[0]!)![1]!;

    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) statuses.push((await post(h, "/auth/unlock", { username: OWNER.email, code: "AAAAAAAAAAAAAAAA" }, "196.221.9.9")).status);

    expect(statuses[0]).toBe(400);
    expect(statuses).toContain(429);
    expect((await post(h, "/auth/unlock", { username: OWNER.email, code }, "196.221.9.9")).status).toBe(429);
    expect((await post(h, "/auth/unlock", { username: OWNER.email, code }, "196.221.5.5")).status).toBe(200);
  }, 120_000);

  it("holds a forged link to the same per-address wait as a forged code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);
    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) statuses.push((await post(h, "/auth/unlock-link", { token: `${"x".repeat(42)}${i % 10}` }, "196.221.9.9")).status);
    expect(statuses[0]).toBe(400);
    expect(statuses).toContain(429);
  }, 120_000);

  it("records the mailed notice once when the connection's turn is lost after the mail server answered, and never mails it again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: string[] = [];
    let letTheHolderGo: () => void = () => undefined;
    let holding: Promise<unknown> = Promise.resolve();
    const h = await open({
      securityMail: PLATFORM_SMTP,
      unlockLink: (token) => `${LINK_BASE}${token}`,
      connectionTurn: { completedRetakeTimeoutMs: 20 },
      sendMail: async (_smtp, _to, message) => {
        sent.push(message.body);
        const taken = new Promise<void>((resolve) => {
          holding = h.audit.turn!(async () => {
            resolve();
            await new Promise<void>((release) => (letTheHolderGo = release));
          });
        });
        await taken;
        return { outcome: "sent", detail: "250" };
      },
    });
    await claim(h);
    const statuses = await twentyWrongPins(h);
    expect(statuses[19]).toBe(423);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    letTheHolderGo();
    await holding;
    await h.drain();

    const hostSession = (await (await signIn(h, OWNER.pin, null)).json()) as SessionDTO;
    const authed = { authorization: `Bearer ${hostSession.token}`, "content-type": "application/json" };
    const emailStateOfTheNotice = async () => {
      const listed = (await (await h.app.fetch(new Request("http://local/notifications", { headers: authed }))).json()) as
        | { title: string; channelStatus: Record<string, string> }[]
        | { items: { title: string; channelStatus: Record<string, string> }[] };
      const rows = Array.isArray(listed) ? listed : listed.items;
      return rows.filter((row) => row.title.includes("تم قفل حساب")).map((row) => row.channelStatus["email"]);
    };
    await vi.waitFor(async () => expect(await emailStateOfTheNotice()).toEqual(["sent"]));

    await h.app.fetch(new Request("http://local/notifications/drain", { method: "POST", headers: authed, body: "{}" }));
    expect(sent).toHaveLength(1);
    expect(await emailStateOfTheNotice()).toEqual(["sent"]);

    const token = linkIn(sent[0]!)!;
    expect((await post(h, "/auth/unlock-link", { token }, "196.221.5.5")).status).toBe(200);
    expect((await post(h, "/auth/unlock-link", { token }, "196.221.5.5")).status).toBe(400);
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(200);
  }, 120_000);

  it("answers a name nobody holds exactly as it answers a locked account", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) statuses.push((await signIn(h, "000000", `41.33.${i}.10`, "ghost@shop.eg")).status);
    expect(statuses.slice(0, 19)).toEqual(Array<number>(19).fill(401));
    expect(statuses.slice(19)).toEqual([423, 423]);
  }, 120_000);
});

describe("a locked account can always be recovered", () => {
  const HOUR = 60 * 60_000;
  const LINK_BASE = "https://acme.mezan.test/unlock#token=";
  const codeIn = (body: string) => /: ([A-Z2-7]{16})/.exec(body)?.[1];
  const tokenIn = (body: string) => /#token=([A-Za-z0-9_-]{43})/.exec(body)?.[1];

  async function lockedWithMail(extra: CreateBackendOptions = {}) {
    let now = Date.parse("2026-10-13T08:00:00.000Z");
    const sent: { to: string; subject: string; body: string }[] = [];
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    }
    const h = await open({
      securityMail: PLATFORM_SMTP,
      unlockLink: (token) => `${LINK_BASE}${token}`,
      signInClock: () => now,
      sendMail: async (_smtp, to, message) => {
        sent.push({ to, ...message });
        return { outcome: "sent", detail: "250" };
      },
      ...extra,
    });
    await claim(h);
    expect((await twentyWrongPins(h))[19]).toBe(423);
    await h.drain();
    return { h, sent, logged, advance: (ms: number) => void (now += ms) };
  }

  it("leaves the held-connection watchdog silent once the lock mail has gone out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const WARN_MS = 5;
    const reports: string[] = [];
    const sent: string[] = [];
    const h = await open({
      securityMail: PLATFORM_SMTP,
      connectionTurn: { heldWarningMs: WARN_MS, onHeldTooLong: (c, heldMs) => reports.push(`${c.req.method} ${c.req.path} ${heldMs}`) },
      sendMail: async (_smtp, to) => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        sent.push(to);
        return { outcome: "sent", detail: "250" };
      },
    });
    await claim(h);
    await twentyWrongPins(h);
    await h.drain();
    expect(sent).toEqual([OWNER.email]);

    const finishedWith = reports.length;
    await new Promise((resolve) => setTimeout(resolve, WARN_MS * 10));

    expect(reports.slice(finishedWith)).toEqual([]);
  }, 120_000);

  it("keeps the mailed code alive through wrong codes from many addresses", async () => {
    const { h, sent } = await lockedWithMail();
    const code = codeIn(sent[0]!.body)!;

    for (let i = 0; i < 12; i += 1) {
      expect((await post(h, "/auth/unlock", { username: OWNER.email, code: "AAAAAAAAAAAAAAAA" }, `197.50.${i}.9`)).status).toBe(400);
    }

    expect((await post(h, "/auth/unlock", { username: OWNER.email, code }, "196.221.5.5")).status).toBe(200);
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(200);
  }, 120_000);

  it("mails a fresh code and link on the next attempt after the last ones expired, once, and the fresh link opens the account", async () => {
    const { h, sent, advance } = await lockedWithMail();
    const firstCode = codeIn(sent[0]!.body)!;
    const firstToken = tokenIn(sent[0]!.body)!;

    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(423);
    await h.drain();
    expect(sent).toHaveLength(1);

    advance(HOUR + 1);
    expect((await post(h, "/auth/unlock", { username: OWNER.email, code: firstCode }, "196.221.5.5")).status).toBe(400);
    expect((await signIn(h, "000000", "196.221.5.6")).status).toBe(423);
    await h.drain();
    expect(sent).toHaveLength(2);
    expect((await signIn(h, "000000", "196.221.5.7")).status).toBe(423);
    expect((await signIn(h, "000000", "196.221.5.8", "nobody@shop.eg")).status).not.toBe(200);
    await h.drain();
    expect(sent).toHaveLength(2);

    const freshCode = codeIn(sent[1]!.body)!;
    const freshToken = tokenIn(sent[1]!.body)!;
    expect(freshCode).not.toBe(firstCode);
    expect((await post(h, "/auth/unlock-link", { token: firstToken }, "196.221.5.5")).status).toBe(400);
    expect((await post(h, "/auth/unlock-link", { token: freshToken }, "196.221.5.5")).status).toBe(200);
    expect((await signIn(h, OWNER.pin, "196.221.5.5")).status).toBe(200);
  }, 120_000);

  it("writes the code and the link token into the mail only: no notification row, audit row or log line holds either", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-sign-in-lock-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "tenant.db");
    const { h, sent, logged } = await lockedWithMail({ dbPath });
    const code = codeIn(sent[0]!.body)!;
    const token = tokenIn(sent[0]!.body)!;
    expect(sent[0]!.body).toContain(`${LINK_BASE}${token}`);

    const hostSession = (await (await signIn(h, OWNER.pin, null)).json()) as SessionDTO;
    const get = (pathname: string) => h.app.fetch(new Request(`http://local${pathname}`, { headers: { authorization: `Bearer ${hostSession.token}` } }));
    const notices = await (await get("/notifications")).text();
    expect(notices).toContain("تم قفل حساب");
    expect(notices).toContain("أُرسل");
    await h.backupTo(path.join(dir, "backup.db"));

    const { sqlite } = openSqliteConnection(path.join(dir, "backup.db"));
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
    const everything = tables.map((table) => JSON.stringify(sqlite.prepare(`SELECT * FROM "${table}"`).all())).join("\n");
    sqlite.close();
    for (const secret of [code, token]) {
      expect(notices).not.toContain(secret);
      expect(everything).not.toContain(secret);
      expect(logged.join("\n")).not.toContain(secret);
    }
  }, 120_000);

  it("scrubs the code and the link out of lock notices an earlier build stored in full", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-sign-in-lock-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "tenant.db");
    const first = await createBackend({ dbPath });
    const session = await claim(first);
    first.close();
    const { sqlite } = openSqliteConnection(dbPath);
    const columns = (sqlite.prepare("PRAGMA table_info(notification)").all() as { name: string }[]).map((column) => column.name);
    expect(columns).toContain("event_code");
    sqlite
      .prepare(
        `INSERT INTO notification (id, rule_id, recipient_user_id, event_code, title, body, priority, channels_json, channel_status_json, status, payload_json, created_at, read_at)
         VALUES ('old-lock', NULL, ?, 'SECURITY_ACCOUNT_LOCKED', 'تم قفل حساب بعد محاولات دخول فاشلة', ?, 'urgent', '["in_app","email"]', '{"in_app":"delivered","email":"sent"}', 'unread', '{}', '2026-10-01T00:00:00.000Z', NULL)`,
      )
      .run(
        session.userId,
        ["قُفل حساب المالك بعد 20 محاولة دخول فاشلة.", "أو أدخل هذا الرمز في شاشة الدخول خلال ساعة واحدة: ABCDEFGHIJKLMNOP", `أو افتح هذا الرابط خلال ساعة واحدة: https://acme.mezan.test/unlock?token=${"t".repeat(43)}`, "إن لم تكن هذه المحاولات من صاحب الحساب فغيّر رمز PIN الخاص به."].join("\n"),
      );
    sqlite.close();

    const second = await createBackend({ dbPath });
    handles.push(second);
    const hostSession = (await (await signIn(second, OWNER.pin, null)).json()) as SessionDTO;
    const notices = await (await second.app.fetch(new Request("http://local/notifications", { headers: { authorization: `Bearer ${hostSession.token}` } }))).text();

    expect(notices).toContain("قُفل حساب المالك");
    expect(notices).not.toContain("ABCDEFGHIJKLMNOP");
    expect(notices).not.toContain("t".repeat(43));
    expect(notices).not.toContain("https://");
  }, 120_000);

  it("keeps a name nobody holds locked across a restart exactly as it keeps a real account", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-sign-in-lock-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "tenant.db");
    const first = await createBackend({ dbPath });
    await claim(first);
    await twentyWrongPins(first);
    for (let i = 0; i < 20; i += 1) await signIn(first, String(300000 + i), `41.44.${i}.10`, "ghost@shop.eg");
    const before = [await signIn(first, OWNER.pin, "196.221.5.5"), await signIn(first, "123456", "196.221.5.6", "ghost@shop.eg")];
    expect(before.map((res) => res.status)).toEqual([423, 423]);
    first.close();

    const second = await createBackend({ dbPath });
    handles.push(second);
    const real = await signIn(second, OWNER.pin, "196.221.5.5");
    const ghost = await signIn(second, "123456", "196.221.5.6", "ghost@shop.eg");

    expect([real.status, ghost.status]).toEqual([423, 423]);
    expect(await ghost.json()).toEqual(await real.json());
    expect(second.lockedAccounts()).toEqual([OWNER.email]);
  }, 120_000);

  it("tells a cloud tenant with no mail server that the platform's operator unlocks the account, and never to use a server machine", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cloud = await open({ platformOperatorUnlocks: true });
    await claim(cloud);
    await twentyWrongPins(cloud);

    const refused = (await (await signIn(cloud, OWNER.pin, "196.221.5.5")).json()) as { message: string; messageEn: string; unlockByCode: boolean };

    expect(refused.unlockByCode).toBe(false);
    expect(refused.message).toContain("دعم المنصة");
    expect(refused.message).not.toContain("جهاز الخادم");
    expect(refused.messageEn).toMatch(/platform support/i);

    const onPremises = await open();
    await claim(onPremises);
    await twentyWrongPins(onPremises);
    const local = (await (await signIn(onPremises, OWNER.pin, "196.221.5.5")).json()) as { message: string; messageEn: string };
    expect(local.message).toContain("جهاز الخادم");
    expect(local.message).not.toContain("دعم المنصة");
    expect(local.messageEn).toMatch(/server machine/i);
  }, 120_000);

  it("is unlocked by the platform's operator through the handle, listed while locked, and recorded in the tenant's own audit trail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open({ platformOperatorUnlocks: true });
    await claim(h);
    await twentyWrongPins(h);
    expect(h.lockedAccounts()).toEqual([OWNER.email]);

    expect(await h.unlockAccount("nobody@shop.eg", "platform:op-1")).toBe(false);
    expect(await h.unlockAccount(OWNER.email.toUpperCase(), "platform:op-1")).toBe(true);

    expect(h.lockedAccounts()).toEqual([]);
    const signedIn = await signIn(h, OWNER.pin, "196.221.5.5");
    expect(signedIn.status).toBe(200);
    const session = (await signedIn.json()) as SessionDTO;
    const audit = await (await h.app.fetch(new Request("http://local/audit?stream=security&action=ACCOUNT_UNLOCKED_BY_PLATFORM", { headers: { authorization: `Bearer ${session.token}` } }), from("196.221.5.5"))).text();
    expect(audit.match(/ACCOUNT_UNLOCKED_BY_PLATFORM/g)).toHaveLength(1);
    expect(audit).toContain("platform:op-1");
    expect(await h.unlockAccount(OWNER.email, "platform:op-1")).toBe(false);
  }, 120_000);
});

describe("a burst of sign-ins larger than the tenant checks at once", () => {
  it("tells the ones it has no place for that the server is busy, not that they tried too often", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);

    const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => signIn(h, "000000", "41.33.10.10", `ghost${i}@shop.eg`)));
    const busy = answers.filter((answer) => answer.status === 503);

    expect(busy.length).toBeGreaterThan(20);
    expect(await busy[0]!.json()).toMatchObject({ error: "SIGN_IN_BUSY", message: expect.stringContaining("مشغول") });
    expect(busy[0]!.headers.get("retry-after")).toBe("2");
    expect(answers.filter((answer) => answer.status !== 503 && answer.status !== 401)).toEqual([]);

    const owner = await signIn(h, OWNER.pin, "196.221.5.5");
    expect(owner.status).toBe(200);
  }, 120_000);
});

describe("a session bound to the device that signed in rather than to its address", () => {
  const DEVICE = { "x-mezan-device-binding": "1" };

  function call(h: BackendHandle, method: string, pathname: string, address: string, headers: Record<string, string>, body?: unknown) {
    return h.app.fetch(
      new Request(`http://local${pathname}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      from(address),
    );
  }

  async function deviceSession(h: BackendHandle, address: string) {
    const res = await call(h, "POST", "/auth/login", address, DEVICE, { username: OWNER.email, pin: OWNER.pin });
    expect(res.status).toBe(200);
    const session = (await res.json()) as SessionDTO & { deviceSecret?: string };
    expect(session.deviceSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    return { token: session.token, secret: session.deviceSecret! };
  }

  const auditText = async (h: BackendHandle, action: string) => {
    const host = (await (await signIn(h, OWNER.pin, null)).json()) as SessionDTO;
    const res = await h.app.fetch(new Request(`http://local/audit?action=${action}`, { headers: { authorization: `Bearer ${host.token}` } }));
    return res.text();
  };

  it("keeps working when the address changes and the device secret comes with it, and records the move once as information", async () => {
    const h = await open();
    await claim(h);
    const { token, secret } = await deviceSession(h, "41.33.10.10");
    const bearer = { authorization: `Bearer ${token}`, "x-mezan-device": secret };

    expect((await call(h, "GET", "/profile", "41.33.10.10", bearer)).status).toBe(200);
    expect((await call(h, "GET", "/profile", "102.44.7.1", bearer)).status).toBe(200);
    expect((await call(h, "GET", "/profile", "102.44.7.1", bearer)).status).toBe(200);

    const moves = (await auditText(h, "SESSION_ADDRESS_CHANGED")).match(/SESSION_ADDRESS_CHANGED/g) ?? [];
    expect(moves).toHaveLength(1);
    expect(await auditText(h, "SESSION_ADDRESS_CHANGED")).toContain("INFO");
  }, 120_000);

  it("refuses the token without its device secret and records it as critical, and the holder's own session goes on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);
    const { token, secret } = await deviceSession(h, "41.33.10.10");

    expect((await call(h, "GET", "/profile", "196.221.5.5", { authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await call(h, "GET", "/profile", "41.33.10.10", { authorization: `Bearer ${token}`, "x-mezan-device": secret })).status).toBe(200);

    const audit = await auditText(h, "SESSION_DEVICE_REJECTED");
    expect(audit.match(/SESSION_DEVICE_REJECTED/g)).toHaveLength(1);
    expect(audit).toContain("CRITICAL");
    expect(audit).toContain('"sessionEnded":false');
  }, 120_000);

  it("ends the session once the token has been presented without its secret five times in ten minutes, and records that it did", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);
    const { token, secret } = await deviceSession(h, "41.33.10.10");

    for (let i = 0; i < 5; i += 1) expect((await call(h, "GET", "/profile", "196.221.5.5", { authorization: `Bearer ${token}` })).status).toBe(401);

    expect((await call(h, "GET", "/profile", "41.33.10.10", { authorization: `Bearer ${token}`, "x-mezan-device": secret })).status).toBe(401);
    const audit = await auditText(h, "SESSION_DEVICE_REJECTED");
    expect(audit.match(/SESSION_DEVICE_REJECTED/g)).toHaveLength(5);
    expect(audit.match(/"sessionEnded":true/g)).toHaveLength(1);
  }, 120_000);

  it("asks for the PIN again before an administrative change made after the address moved, and accepts it", async () => {
    const h = await open();
    const owner = await claim(h);
    const { token, secret } = await deviceSession(h, "41.33.10.10");
    const bearer = { authorization: `Bearer ${token}`, "x-mezan-device": secret };
    const unlockSelf = (address: string) => call(h, "POST", `/users/${owner.userId}/unlock`, address, bearer, {});

    expect((await unlockSelf("41.33.10.10")).status).toBe(200);
    const moved = await unlockSelf("102.44.7.1");
    expect(moved.status).toBe(403);
    expect(await moved.json()).toMatchObject({ error: "STEP_UP_REQUIRED", message: expect.stringContaining("رمز PIN") });
    expect((await call(h, "GET", "/profile", "102.44.7.1", bearer)).status).toBe(200);

    const wrong = await call(h, "POST", "/auth/step-up", "102.44.7.1", bearer, { pin: "000000" });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ error: CurrentSecretRefusal.IncorrectPin });
    expect((await call(h, "GET", "/profile", "102.44.7.1", bearer)).status).toBe(200);
    expect((await call(h, "POST", "/auth/step-up", "102.44.7.1", bearer, { pin: OWNER.pin })).status).toBe(200);
    expect((await unlockSelf("102.44.7.1")).status).toBe(200);
  }, 120_000);

  it("still binds a session to its address when the client did not ask for a device secret", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    await claim(h);
    const session = (await (await signIn(h, OWNER.pin, "41.33.10.10")).json()) as SessionDTO & { deviceSecret?: string };
    expect(session.deviceSecret).toBeUndefined();
    expect((await call(h, "GET", "/profile", "102.44.7.1", { authorization: `Bearer ${session.token}` })).status).toBe(401);
  }, 120_000);
});

describe("a second person signing in on a device somebody else is signed in on", () => {
  const DEVICE = "41.33.7.7";
  const deviceSignIn = (h: BackendHandle, username: string, pin: string, heldSecret?: string) =>
    h.app.fetch(
      new Request("http://local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-device-binding": "1", ...(heldSecret ? { "x-mezan-device": heldSecret } : {}) },
        body: JSON.stringify({ username, pin }),
      }),
      from(DEVICE),
    );
  const profileOf = (h: BackendHandle, token: string, secret: string) =>
    h.app.fetch(new Request("http://local/profile", { headers: { authorization: `Bearer ${token}`, "x-mezan-device": secret } }), from(DEVICE));

  it("tells the first person's tab that another user signed in on this device, in Arabic, and records no theft", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await open();
    const owner = await claim(h);
    const cashier = { nameAr: "أمين الخزنة", nameEn: "Cashier", email: "cashier@shop.eg", pin: "246813" };
    const created = await post(h, "/users", { ...cashier, password: "a-long-password-1", roleId: null, isCompanyAdmin: true, branchScope: "*", warehouseScope: "*", acknowledge: true, reason: "مدير ثانٍ للاختبار" }, null, owner.token);
    expect(created.status, await created.clone().text()).toBeLessThan(300);

    const first = (await (await deviceSignIn(h, OWNER.email, OWNER.pin)).json()) as SessionDTO & { token: string; deviceSecret: string };
    expect((await profileOf(h, first.token, first.deviceSecret)).status).toBe(200);
    const second = (await (await deviceSignIn(h, cashier.email, cashier.pin, first.deviceSecret)).json()) as SessionDTO & { token: string; deviceSecret: string };
    expect(second.userId).not.toBe(first.userId);

    const displaced = await profileOf(h, first.token, second.deviceSecret);
    expect(displaced.status).toBe(401);
    expect(displaced.headers.get("x-mezan-session-ended")).toBe("displaced");
    expect(await displaced.json()).toEqual({ error: "SESSION_DISPLACED", message: "سجّل مستخدم آخر الدخول على هذا الجهاز، فانتهت جلستك هنا. سجّل الدخول من جديد للمتابعة." });
    expect((await profileOf(h, second.token, second.deviceSecret)).status).toBe(200);

    const neverIssued = await profileOf(h, "a-token-nobody-issued", second.deviceSecret);
    expect(neverIssued.status).toBe(401);
    expect(neverIssued.headers.get("x-mezan-session-ended")).toBeNull();
    expect(await neverIssued.json()).toMatchObject({ error: "UNAUTHENTICATED" });
    const gated = await h.app.fetch(new Request("http://local/customers", { headers: { authorization: `Bearer ${first.token}`, "x-mezan-device": second.deviceSecret } }), from(DEVICE));
    expect(gated.status).toBe(401);
    expect(await gated.json()).toMatchObject({ error: "SESSION_DISPLACED" });
    const gatedUnknown = await h.app.fetch(new Request("http://local/customers", { headers: { authorization: "Bearer a-token-nobody-issued" } }), from(DEVICE));
    expect(await gatedUnknown.json()).toMatchObject({ error: "SESSION_EXPIRED", message: "انتهت الجلسة. سجّل الدخول من جديد." });

    const audit = await (await h.app.fetch(new Request("http://local/audit?stream=security", { headers: { authorization: `Bearer ${owner.token}` } }))).text();
    expect(audit).toContain("LOGIN_SUCCEEDED");
    expect(audit).not.toMatch(/SESSION_DEVICE_REJECTED|SESSION_ORIGIN_REJECTED/);
  }, 120_000);
});

describe("claiming a tenant when the claim cannot be recorded", () => {
  it("claims nothing: no administrator, no session, and the tenant can still be claimed once the log records again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-claim-audit-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "tenant.db");
    const h = await createBackend({ dbPath });
    handles.push(h);
    const { sqlite: side } = openSqliteConnection(dbPath);
    side.exec(`CREATE TRIGGER refuse_claim BEFORE INSERT ON audit_event WHEN NEW.action = 'TENANT_CLAIMED' BEGIN SELECT RAISE(ABORT, 'audit log is full'); END`);

    const refused = await post(h, "/bootstrap/admin", OWNER, null);
    expect(refused.status).toBeGreaterThanOrEqual(500);
    expect((await signIn(h, OWNER.pin, null)).status).toBe(401);
    const status = (await (await h.app.fetch(new Request("http://local/bootstrap/status"))).json()) as { claimed: boolean };
    expect(status.claimed).toBe(false);

    side.exec("DROP TRIGGER refuse_claim");
    side.close();
    expect((await post(h, "/bootstrap/admin", OWNER, null)).status).toBe(201);
    expect((await signIn(h, OWNER.pin, null)).status).toBe(200);
  }, 120_000);
});
