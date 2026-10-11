import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmtpConfig } from "@mezan/api";
import type { SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "./create-backend.js";

const OWNER = { nameAr: "المالك", nameEn: "Owner", email: "owner@shop.eg", pin: "731946" };
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
          branchScope: "*", warehouseScope: "*", pin: "864201",
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
