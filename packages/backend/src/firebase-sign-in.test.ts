import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmtpConfig } from "@mezan/api";
import { FirebaseRefusal, type SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle, type CreateBackendOptions, type FirebaseAccounts } from "./create-backend.js";
import type { FirebaseIdentity } from "./auth-routes.js";

const OWNER = { nameAr: "المالك", nameEn: "Owner", email: "owner@shop.eg", password: "pw-731946", companyName: "متجر الاختبار" };
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
const PLATFORM_SMTP: SmtpConfig = {
  smtpEnabled: true, smtpHost: "smtp.mezan.test", smtpPort: 587, smtpSecurity: "STARTTLS",
  smtpUsername: "", smtpPassword: "", smtpFromName: "Mezan", smtpFromEmail: "no-reply@mezan.test",
};
const SET_PASSWORD_LINK = "https://mezan-erp-staging.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=x&lang=ar";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const token = (identity: Partial<FirebaseIdentity> & { email: string }) =>
  JSON.stringify({ emailVerified: true, authTimeSeconds: nowSeconds(), ...identity });

function fakeFirebase(): FirebaseAccounts & { linksFor: string[] } {
  const linksFor: string[] = [];
  return {
    linksFor,
    async verify(idToken) {
      try {
        return JSON.parse(idToken) as FirebaseIdentity;
      } catch {
        return null;
      }
    },
    async setPasswordLink(email) {
      // As slow as Google: a call awaited inside a request's transaction would surface here.
      await new Promise((resolve) => setTimeout(resolve, 20));
      linksFor.push(email);
      return SET_PASSWORD_LINK;
    },
  };
}

type Mail = { to: string; body: string };
const handles: BackendHandle[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function open(options: CreateBackendOptions = {}): Promise<{ h: BackendHandle; mails: Mail[] }> {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-firebase-"));
  dirs.push(dir);
  const mails: Mail[] = [];
  const sendMail = vi.fn(async (_config: SmtpConfig, to: string, message: { body: string }) => {
    mails.push({ to, body: message.body });
    return { outcome: "sent" as const };
  });
  const h = await createBackend({ dbPath: path.join(dir, "tenant.db"), securityMail: PLATFORM_SMTP, sendMail: sendMail as unknown as CreateBackendOptions["sendMail"], ...options });
  handles.push(h);
  return { h, mails };
}

function call(h: BackendHandle, method: string, pathname: string, body?: unknown, sessionToken?: string) {
  return h.app.fetch(
    new Request(`http://local${pathname}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function claimed(options: CreateBackendOptions) {
  const opened = await open(options);
  const res = await call(opened.h, "POST", "/bootstrap/admin", OWNER);
  expect(res.status).toBe(201);
  return { ...opened, owner: (await res.json()) as SessionDTO & { token: string } };
}

const firebaseSignIn = (h: BackendHandle, idToken: string) => call(h, "POST", "/auth/firebase", { idToken });
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("Firebase sign-in on the cloud edition", () => {
  it("is not offered where Mezan holds the passwords itself", async () => {
    const { h } = await claimed({});
    expect((await firebaseSignIn(h, token({ email: OWNER.email }))).status).toBe(404);
    expect((await call(h, "POST", "/auth/login", { username: OWNER.email, password: OWNER.password })).status).toBe(200);
  });

  it("signs the owner in with a verified Firebase token and returns the usual session", async () => {
    const { h } = await claimed({ firebase: fakeFirebase() });
    const res = await firebaseSignIn(h, token({ email: "Owner@Shop.eg" }));
    expect(res.status).toBe(200);
    const session = (await res.json()) as SessionDTO & { token: string };
    expect(session.email).toBe(OWNER.email);
    expect(session.permissions).toEqual(["*"]);
    expect(session.token).toBeTruthy();
  });

  it.each([
    ["an unverified email", token({ email: OWNER.email, emailVerified: false })],
    ["an email no user holds", token({ email: "stranger@shop.eg" })],
    ["a token Firebase does not recognise", "not-a-token"],
  ])("refuses %s with the same answer as a wrong password", async (_case, idToken) => {
    const { h } = await claimed({ firebase: fakeFirebase() });
    const res = await firebaseSignIn(h, idToken);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "INVALID_CREDENTIALS" });
  });

  it("closes the password routes Firebase replaced", async () => {
    const { h } = await claimed({ firebase: fakeFirebase() });
    for (const [pathname, body] of [
      ["/auth/login", { username: OWNER.email, password: OWNER.password }],
      ["/auth/forgot-password", { username: OWNER.email }],
      ["/auth/reset-password", { token: "t", password: "new-password-1" }],
      ["/auth/unlock", { username: OWNER.email, code: "123" }],
    ] as const) {
      const res = await call(h, "POST", pathname, body);
      expect(res.status, pathname).toBe(410);
      expect(await res.json()).toMatchObject({ error: FirebaseRefusal.SignInWithFirebase });
    }
  });

  it("refuses an in-app password or email change for a Firebase user", async () => {
    const { h } = await claimed({ firebase: fakeFirebase() });
    const session = (await (await firebaseSignIn(h, token({ email: OWNER.email }))).json()) as { token: string };
    const res = await call(h, "POST", "/profile/change-password", { currentPassword: OWNER.password, newPassword: "another-password-9" }, session.token);
    expect(res.status).toBe(410);
  });

  it("invites a new user with a Firebase set-password link instead of a temporary password", async () => {
    const firebase = fakeFirebase();
    const { h, mails } = await claimed({ firebase });
    const owner = (await (await firebaseSignIn(h, token({ email: OWNER.email }))).json()) as { token: string };
    const created = await call(h, "POST", "/users", STAFF, owner.token);
    expect(created.status).toBe(201);
    expect(await created.json()).not.toHaveProperty("temporaryPassword");
    await settle();
    expect(firebase.linksFor).toContain(STAFF.email);
    const invitation = mails.find((m) => m.to === STAFF.email);
    expect(invitation?.body).toContain(SET_PASSWORD_LINK);

    const staff = await firebaseSignIn(h, token({ email: STAFF.email }));
    expect(staff.status).toBe(200);
    const session = (await staff.json()) as SessionDTO;
    expect(session.mustChangePassword).toBe(false);
    expect(session.permissions).toEqual(["*"]);
  });

  it("takes the old Firebase password away when support resets the owner", async () => {
    const firebase = fakeFirebase();
    const { h, mails } = await claimed({ firebase });
    const account = await h.ownerAccount({ email: OWNER.email });
    expect(account).not.toBeNull();
    await h.resetOwnerPassword({ userId: account!.id, email: OWNER.email, password: "unused-Temp-123", onlyIfNeverSignedIn: false, actor: "platform:support" });
    await settle();
    expect(firebase.linksFor).toContain(OWNER.email);
    expect(mails.find((m) => m.to === OWNER.email)?.body).toContain(SET_PASSWORD_LINK);
  });

  it("never touches the Firebase account of an address another company holds", async () => {
    const firebase = fakeFirebase();
    let heldElsewhere = false;
    const signInEmails = {
      async claim(email: string) {
        if (heldElsewhere && email === OWNER.email) throw new Error("held by another company");
      },
      async sync() {
        return [];
      },
    };
    const { h } = await claimed({ firebase, signInEmails });
    const account = await h.ownerAccount({ email: OWNER.email });
    heldElsewhere = true;
    await h.resetOwnerPassword({ userId: account!.id, email: OWNER.email, password: "unused-Temp-123", onlyIfNeverSignedIn: false, actor: "platform:support" });
    await settle();
    expect(firebase.linksFor).not.toContain(OWNER.email);
  });

  it("lets an admin reset another user's password and takes the old Firebase one away", async () => {
    const firebase = fakeFirebase();
    const { h } = await claimed({ firebase });
    const owner = (await (await firebaseSignIn(h, token({ email: OWNER.email }))).json()) as { token: string };
    const created = (await (await call(h, "POST", "/users", STAFF, owner.token)).json()) as { id: string };
    await settle();
    firebase.linksFor.length = 0;
    const reset = await call(h, "PUT", `/users/${created.id}`, { ...STAFF, password: "Admin-Set-9876" }, owner.token);
    expect(reset.status).toBe(200);
    await settle();
    expect(firebase.linksFor).toEqual([STAFF.email]);
  });

  it("confirms a step-up only with a fresh Firebase sign-in of the same user", async () => {
    const { h } = await claimed({ firebase: fakeFirebase() });
    const session = (await (await firebaseSignIn(h, token({ email: OWNER.email }))).json()) as { token: string };
    const stepUp = (idToken: string) => call(h, "POST", "/auth/step-up", { idToken }, session.token);

    const stale = await stepUp(token({ email: OWNER.email, authTimeSeconds: nowSeconds() - 3600 }));
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: FirebaseRefusal.ReauthenticationTooOld });
    expect((await stepUp(token({ email: "someone-else@shop.eg" }))).status).toBe(403);
    expect((await call(h, "POST", "/auth/step-up", { password: OWNER.password }, session.token)).status).toBe(410);
    expect((await stepUp(token({ email: OWNER.email }))).status).toBe(200);
  });
});
