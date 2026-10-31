import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmtpConfig } from "@mezan/api";
import { createSqlitePasswordResetTokens, openSqliteConnection } from "@mezan/persistence";
import { PasswordChangeRefusal, type SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "./create-backend.js";

const OWNER = { nameAr: "المالك", nameEn: "Owner", email: "owner@shop.eg", password: "pw-731946", companyName: "متجر الاختبار" };
const PLATFORM_SMTP: SmtpConfig = {
  smtpEnabled: true, smtpHost: "smtp.mezan.test", smtpPort: 587, smtpSecurity: "STARTTLS",
  smtpUsername: "", smtpPassword: "", smtpFromName: "Mezan", smtpFromEmail: "no-reply@mezan.test",
};
const RESET_LINK = "https://mezan.test/reset-password#token=";
const STAFF = {
  nameAr: "موظف جديد",
  nameEn: null,
  email: "staff@shop.eg",
  phone: null,
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: "*",
  warehouseScope: "*",
  status: "active",
  acknowledge: true,
  reason: "مدير ثانٍ",
};

type Mail = { to: string; subject: string; body: string };

const handles: BackendHandle[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function open(options: CreateBackendOptions = {}): Promise<{ h: BackendHandle; mails: Mail[]; dbPath: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-password-reset-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "tenant.db");
  const mails: Mail[] = [];
  const sendMail = vi.fn(async (_config: SmtpConfig, to: string, message: { subject: string; body: string }) => {
    mails.push({ to, subject: message.subject, body: message.body });
    return { outcome: "sent" as const };
  });
  const h = await createBackend({
    dbPath,
    securityMail: PLATFORM_SMTP,
    passwordResetLink: (token) => `${RESET_LINK}${token}`,
    sendMail: sendMail as unknown as CreateBackendOptions["sendMail"],
    ...options,
  });
  handles.push(h);
  return { h, mails, dbPath };
}

function call(h: BackendHandle, method: string, pathname: string, body?: unknown, token?: string) {
  return h.app.fetch(
    new Request(`http://local${pathname}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function claim(h: BackendHandle): Promise<SessionDTO> {
  const res = await call(h, "POST", "/bootstrap/admin", OWNER);
  expect(res.status).toBe(201);
  return (await res.json()) as SessionDTO;
}

const signIn = (h: BackendHandle, username: string, password: string) => call(h, "POST", "/auth/login", { username, password });
const forgot = (h: BackendHandle, username: string) => call(h, "POST", "/auth/forgot-password", { username });
const reset = (h: BackendHandle, token: string, password: string) => call(h, "POST", "/auth/reset-password", { token, password });

async function invite(h: BackendHandle, owner: SessionDTO): Promise<{ id: string; temporaryPassword: string }> {
  const res = await call(h, "POST", "/users", STAFF, owner.token);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; temporaryPassword: string };
}

function tokenIn(mail: Mail | undefined): string {
  const at = mail?.body.indexOf(RESET_LINK) ?? -1;
  expect(at).toBeGreaterThanOrEqual(0);
  return /^[A-Za-z0-9_-]+/.exec(mail!.body.slice(at + RESET_LINK.length))![0];
}

const resetMails = (mails: Mail[], to: string) => mails.filter((mail) => mail.to === to && mail.body.includes(RESET_LINK));

describe("forgot-password and reset-password through the composed backend", () => {
  it("answers the same neutral 202 for a known and an unknown address, and mails a link only to the active account", async () => {
    const { h, mails } = await open();
    await claim(h);

    const known = await forgot(h, OWNER.email);
    const unknown = await forgot(h, "nobody@shop.eg");
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());

    await vi.waitFor(() => expect(resetMails(mails, OWNER.email)).toHaveLength(1));
    expect(mails.some((mail) => mail.to === "nobody@shop.eg")).toBe(false);
  }, 60_000);

  it("issues no second link to the same account within five minutes", async () => {
    const { h, mails } = await open();
    await claim(h);

    await forgot(h, OWNER.email);
    await vi.waitFor(() => expect(resetMails(mails, OWNER.email)).toHaveLength(1));
    const first = tokenIn(resetMails(mails, OWNER.email)[0]);
    expect((await forgot(h, OWNER.email)).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(resetMails(mails, OWNER.email)).toHaveLength(1);
    expect((await reset(h, first, "Fresh-Pass-1")).status).toBe(200);
  }, 60_000);

  it("resets with the mailed token once: the new password signs in, old sessions end, and the token is spent", async () => {
    const { h, mails } = await open();
    const owner = await claim(h);

    await forgot(h, OWNER.email);
    await vi.waitFor(() => expect(resetMails(mails, OWNER.email)).toHaveLength(1));
    const token = tokenIn(resetMails(mails, OWNER.email)[0]);

    expect((await reset(h, token, "Fresh-Pass-1")).status).toBe(200);
    expect((await call(h, "GET", "/profile", undefined, owner.token)).status).toBe(401);
    expect((await signIn(h, OWNER.email, OWNER.password)).status).toBe(401);
    const after = await signIn(h, OWNER.email, "Fresh-Pass-1");
    expect(after.status).toBe(200);
    expect(((await after.json()) as SessionDTO).mustChangePassword).toBe(false);

    const again = await reset(h, token, "Another-Pass-2");
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe("INVALID_RESET_LINK");
  }, 60_000);

  it("refuses an expired token with 400 INVALID_RESET_LINK", async () => {
    const { h, dbPath } = await open();
    const owner = await claim(h);
    const token = "expired-token-0123456789abcdef";
    const { sqlite } = openSqliteConnection(dbPath);
    try {
      await createSqlitePasswordResetTokens(sqlite).issue(owner.userId, createHash("sha256").update(token).digest("hex"), Date.now() - 1000);
    } finally {
      sqlite.close();
    }

    const res = await reset(h, token, "Fresh-Pass-1");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_RESET_LINK");
    expect((await signIn(h, OWNER.email, OWNER.password)).status).toBe(200);
  }, 60_000);

  it("holds a temporary-password session to the change before a reset, and signs it in normally after", async () => {
    const { h, mails } = await open();
    const owner = await claim(h);
    const staff = await invite(h, owner);

    const first = await signIn(h, STAFF.email, staff.temporaryPassword);
    expect(first.status).toBe(200);
    const flagged = (await first.json()) as SessionDTO;
    expect(flagged.mustChangePassword).toBe(true);
    expect(flagged.permissions).toEqual([]);
    const refused = await call(h, "GET", "/accounts", undefined, flagged.token);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe(PasswordChangeRefusal.Required);

    await forgot(h, STAFF.email);
    await vi.waitFor(() => expect(resetMails(mails, STAFF.email)).toHaveLength(1));
    expect((await reset(h, tokenIn(resetMails(mails, STAFF.email)[0]), "Staff-Own-Pass-1")).status).toBe(200);
    expect((await call(h, "GET", "/profile", undefined, flagged.token)).status).toBe(401);

    const after = await signIn(h, STAFF.email, "Staff-Own-Pass-1");
    expect(after.status).toBe(200);
    const session = (await after.json()) as SessionDTO;
    expect(session.mustChangePassword).toBe(false);
    expect(session.permissions).not.toEqual([]);
    expect((await call(h, "GET", "/accounts", undefined, session.token)).status).toBe(200);
  }, 60_000);
});

describe("the invitation email for an admin-created user", () => {
  it("mails the temporary password once to the new user's address and never logs it", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    }
    const { h, mails } = await open();
    const owner = await claim(h);
    const staff = await invite(h, owner);

    await vi.waitFor(() => expect(mails.filter((mail) => mail.to === STAFF.email)).toHaveLength(1));
    const [invitation] = mails.filter((mail) => mail.to === STAFF.email);
    expect(invitation!.body).toContain(staff.temporaryPassword);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mails.filter((mail) => mail.to === STAFF.email)).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(staff.temporaryPassword);
  }, 60_000);

  it("sends nothing when no mail server is configured", async () => {
    const { h, mails } = await open({ securityMail: undefined });
    const owner = await claim(h);
    const staff = await invite(h, owner);

    expect(staff.temporaryPassword).toHaveLength(12);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mails).toEqual([]);
  }, 60_000);
});
