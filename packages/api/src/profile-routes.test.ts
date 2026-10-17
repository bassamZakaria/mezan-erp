import { describe, it, expect, afterEach } from "vitest";
import { createSqliteUnitOfWork, createScryptHasher, type SqliteUnitOfWorkHandle } from "@mezan/persistence";
import type { AuditEvent, AuditSink } from "@mezan/domain";
import { createProfileRoutes } from "./profile-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteUnitOfWorkHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function fakeAudit(): AuditSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async append(event) {
      events.push(event);
    },
    async query(stream, limit = 500) {
      return events.filter((e) => e.stream === stream).slice(0, limit);
    },
  };
}

const hasher = createScryptHasher();

function newApp(opts: { withAudit?: boolean } = { withAudit: true }) {
  const uow = createSqliteUnitOfWork();
  handles.push(uow);
  const audit = opts.withAudit === false ? undefined : fakeAudit();
  const app = createProfileRoutes(uow, hasher, insecureHeaderAuthContextResolver, audit);
  return { app, uow, audit };
}

function req(path: string, init: RequestInit & { userId?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function json(res: Response) {
  return res.json();
}

const CURRENT_PASSWORD = "CurrentPass1";

async function seedUser(uow: ReturnType<typeof newApp>["uow"], overrides: Record<string, unknown> = {}) {
  await uow.users.save({
    id: "u1",
    nameAr: "محمد الشهابي",
    nameEn: null,
    email: "mohamed@cyag.test",
    phone: "+201000000000",
    passwordHash: await hasher.hash(CURRENT_PASSWORD),
    pinHash: null,
    roleId: null,
    isCompanyAdmin: false,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    photoUrl: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as never);
}

describe("profile router — authentication", () => {
  it("refuses every route with no resolvable caller", async () => {
    const { app } = newApp();
    expect((await app.fetch(req("/"))).status).toBe(401);
    expect((await app.fetch(req("/", { method: "PUT", body: "{}" }))).status).toBe(401);
    expect((await app.fetch(req("/change-password", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await app.fetch(req("/change-pin", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await app.fetch(req("/activity"))).status).toBe(401);
  });

  it("404s GET / for an authenticated caller whose user record does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { userId: "ghost" }));
    expect(res.status).toBe(404);
  });
});

describe("profile router — GET /", () => {
  it("serializes the profile WITHOUT leaking the password or pin hash", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, { pinHash: await hasher.hash("123456") });
    const res = await app.fetch(req("/", { userId: "u1" }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    expect(body.passwordHash).toBeUndefined();
    expect(body.pinHash).toBeUndefined();
    expect(body.hasPin).toBe(true);
    expect(body.nameAr).toBe("محمد الشهابي");
    expect(body.isCompanyAdmin).toBe(false);
  });
});

describe("profile router — PUT / cannot escalate the caller's own privileges", () => {
  it("updates name/email/phone but the request cannot touch role, admin flag, or scope even when it tries to", async () => {
    const { app, uow } = newApp();
    await uow.roles.save({
      id: "role-clerk",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: ["sales.invoice.view"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
    await seedUser(uow, { roleId: "role-clerk", isCompanyAdmin: false, branchScope: ["BR-CAIRO"], warehouseScope: ["WH-MAIN"] });

    const res = await app.fetch(
      req("/", {
        method: "PUT",
        userId: "u1",
        body: JSON.stringify({
          nameAr: "محمد أحمد",
          nameEn: null,
          email: "mohamed.ahmed@cyag.test",
          phone: "+201111111111",
          currentPassword: CURRENT_PASSWORD,
          // Every one of these is an attempted privilege escalation through
          // the self-service profile form.
          isCompanyAdmin: true,
          roleId: "role-super-admin",
          permissions: ["*"],
          branchScope: "*",
          warehouseScope: "*",
          status: "active",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await json(res)) as { nameAr: string; email: string; isCompanyAdmin: boolean; roleId: string | null };
    expect(body.nameAr).toBe("محمد أحمد");
    expect(body.email).toBe("mohamed.ahmed@cyag.test");
    // Not escalated on the response...
    expect(body.isCompanyAdmin).toBe(false);
    expect(body.roleId).toBe("role-clerk");

    // ...and not escalated in the STORE either — the defect this class of bug
    // actually causes is a 200 that quietly wrote the wider grant.
    const stored = await uow.users.findById("u1");
    expect(stored?.isCompanyAdmin).toBe(false);
    expect(stored?.roleId).toBe("role-clerk");
    expect(stored?.branchScope).toEqual(["BR-CAIRO"]);
    expect(stored?.warehouseScope).toEqual(["WH-MAIN"]);
  });

  it("keeps photoUrl when the request resends it, and clears it when explicitly null", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, { photoUrl: "data:image/png;base64,abc" });
    const kept = await app.fetch(
      req("/", {
        method: "PUT",
        userId: "u1",
        body: JSON.stringify({ nameAr: "محمد", email: "mohamed@cyag.test", phone: null, photoUrl: "data:image/png;base64,abc" }),
      }),
    );
    expect(((await json(kept)) as { photoUrl: string }).photoUrl).toBe("data:image/png;base64,abc");

    const cleared = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ nameAr: "محمد", email: "mohamed@cyag.test", phone: null, photoUrl: null }) }),
    );
    expect(((await json(cleared)) as { photoUrl: string | null }).photoUrl).toBeNull();
  });

  it("PUT is a full replace: omitting photoUrl clears it too — the client must resend what it wants kept", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, { photoUrl: "data:image/png;base64,abc" });
    const res = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ nameAr: "محمد", email: "mohamed@cyag.test", phone: null }) }),
    );
    expect(((await json(res)) as { photoUrl: string | null }).photoUrl).toBeNull();
  });

  it("rejects a malformed body (invalid email) with 400, and writes nothing", async () => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ nameAr: "محمد", email: "not-an-email", phone: null }) }),
    );
    expect(res.status).toBe(400);
    expect((await uow.users.findById("u1"))?.email).toBe("mohamed@cyag.test");
  });

  it("rejects a blank name with 400, and writes nothing", async () => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ nameAr: "   ", email: "mohamed@cyag.test", phone: null }) }),
    );
    expect(res.status).toBe(400);
    expect((await uow.users.findById("u1"))?.nameAr).toBe("محمد الشهابي");
  });

  it("rejects an email already used by another user with 409, and writes nothing", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, { id: "u1", email: "one@cyag.test" });
    await seedUser(uow, { id: "u2", email: "two@cyag.test" });
    const res = await app.fetch(
      req("/", { method: "PUT", userId: "u2", body: JSON.stringify({ nameAr: "آخر", email: "one@cyag.test", phone: null, currentPassword: CURRENT_PASSWORD }) }),
    );
    expect(res.status).toBe(409);
    expect((await uow.users.findById("u2"))?.email).toBe("two@cyag.test");
  });

  it("allows keeping the caller's own current email (not a duplicate against itself)", async () => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ nameAr: "محمد المعدّل", email: "mohamed@cyag.test", phone: null }) }),
    );
    expect(res.status).toBe(200);
  });
});

describe("profile router — changing the email (the login id) needs the current password", () => {
  const changeTo = (extra: Record<string, unknown> = {}) =>
    req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ nameAr: "محمد", email: "new@cyag.test", phone: null, ...extra }) });

  it("refuses a new email sent without the current password, and writes nothing", async () => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const res = await app.fetch(changeTo());
    expect(res.status).toBe(400);
    expect(((await json(res)) as { error: string }).error).toBe("CURRENT_PASSWORD_REQUIRED");
    expect((await uow.users.findById("u1"))?.email).toBe("mohamed@cyag.test");
  });

  it("refuses a wrong current password with 401, writes nothing, and audits the refusal", async () => {
    const { app, uow, audit } = newApp();
    await seedUser(uow);
    const res = await app.fetch(changeTo({ currentPassword: "wrong-password" }));
    expect(res.status).toBe(401);
    expect((await uow.users.findById("u1"))?.email).toBe("mohamed@cyag.test");
    expect(audit?.events.map((e) => e.action)).toContain("EMAIL_CHANGE_REFUSED");
  });

  it("changes the email with the right password and audits old and new address", async () => {
    const { app, uow, audit } = newApp();
    await seedUser(uow);
    const res = await app.fetch(changeTo({ currentPassword: CURRENT_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await uow.users.findById("u1"))?.email).toBe("new@cyag.test");
    const event = audit?.events.find((e) => e.action === "EMAIL_CHANGED");
    expect(event?.stream).toBe("security");
    expect(event?.details).toMatchObject({ from: "mohamed@cyag.test", to: "new@cyag.test" });
  });

  it("does not ask for the password when only the case of the email differs", async () => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ nameAr: "محمد", email: "Mohamed@cyag.test", phone: null }) }),
    );
    expect(res.status).toBe(200);
  });
});

describe("profile router — change-password", () => {
  it("verifies the current password, hashes the new one, and audits the change under the caller's own id", async () => {
    const { app, uow, audit } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/change-password", {
        method: "POST",
        userId: "u1",
        body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: "BrandNewPass1" }),
      }),
    );
    expect(res.status).toBe(204);
    const updated = await uow.users.findById("u1");
    expect(await hasher.verify("BrandNewPass1", updated!.passwordHash)).toBe(true);
    expect(await hasher.verify(CURRENT_PASSWORD, updated!.passwordHash)).toBe(false);
    expect(audit!.events).toHaveLength(1);
    expect(audit!.events[0]).toMatchObject({ action: "PASSWORD_CHANGED", actor: "u1", entityId: "u1", stream: "security" });
  });

  it("rejects the wrong current password with 401, changes nothing, and audits nothing", async () => {
    const { app, uow, audit } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/change-password", { method: "POST", userId: "u1", body: JSON.stringify({ currentPassword: "WrongPass1", newPassword: "BrandNewPass1" }) }),
    );
    expect(res.status).toBe(401);
    const untouched = await uow.users.findById("u1");
    expect(await hasher.verify(CURRENT_PASSWORD, untouched!.passwordHash)).toBe(true);
    expect(audit!.events).toHaveLength(0);
  });

  it("rejects a new password under 8 characters (schema-level) with 400, and changes nothing", async () => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/change-password", { method: "POST", userId: "u1", body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: "short1" }) }),
    );
    expect(res.status).toBe(400);
    const untouched = await uow.users.findById("u1");
    expect(await hasher.verify(CURRENT_PASSWORD, untouched!.passwordHash)).toBe(true);
  });
});

describe("profile router — change-pin", () => {
  it("sets a new PIN once the current password verifies, and it round-trips through hasPin", async () => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const res = await app.fetch(
      req("/change-pin", { method: "POST", userId: "u1", body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPin: "654321" }) }),
    );
    expect(res.status).toBe(204);
    const updated = await uow.users.findById("u1");
    expect(await hasher.verify("654321", updated!.pinHash!)).toBe(true);

    const getRes = await app.fetch(req("/", { userId: "u1" }));
    expect(((await json(getRes)) as { hasPin: boolean }).hasPin).toBe(true);
  });

  it("clears the PIN when newPin is null, and audits PIN_CLEARED (not PIN_CHANGED)", async () => {
    const { app, uow, audit } = newApp();
    await seedUser(uow, { pinHash: await hasher.hash("111111") });
    const res = await app.fetch(
      req("/change-pin", { method: "POST", userId: "u1", body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPin: null }) }),
    );
    expect(res.status).toBe(204);
    expect((await uow.users.findById("u1"))?.pinHash).toBeNull();
    expect(audit!.events[0]).toMatchObject({ action: "PIN_CLEARED" });
  });

  it("rejects a PIN outside 4-6 digits at the contract level with 400, and leaves the stored PIN unchanged", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, { pinHash: await hasher.hash("111111") });
    const res = await app.fetch(
      req("/change-pin", { method: "POST", userId: "u1", body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPin: "123" }) }),
    );
    expect(res.status).toBe(400);
    const untouched = await uow.users.findById("u1");
    expect(await hasher.verify("111111", untouched!.pinHash!)).toBe(true);
  });

  it("rejects the wrong current password with 401 before ever looking at the new PIN", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, { pinHash: await hasher.hash("111111") });
    const res = await app.fetch(
      req("/change-pin", { method: "POST", userId: "u1", body: JSON.stringify({ currentPassword: "WrongPass1", newPin: "222222" }) }),
    );
    expect(res.status).toBe(401);
    const untouched = await uow.users.findById("u1");
    expect(await hasher.verify("111111", untouched!.pinHash!)).toBe(true);
  });
});

describe("profile router — GET /activity", () => {
  it("shows only the CALLER's own events, newest first, never another user's", async () => {
    const { app, uow, audit } = newApp();
    await seedUser(uow, { id: "u1" });
    await seedUser(uow, { id: "u2", email: "u2@cyag.test" });
    await audit!.append({ stream: "security", module: "profile", entityType: "USER", entityId: "u1", action: "PASSWORD_CHANGED", actor: "u1", branchId: null, timestamp: "2026-08-01T00:00:00.000Z", severity: "WARNING", details: null });
    await audit!.append({ stream: "security", module: "profile", entityType: "USER", entityId: "u2", action: "PASSWORD_CHANGED", actor: "u2", branchId: null, timestamp: "2026-08-02T00:00:00.000Z", severity: "WARNING", details: null });
    await audit!.append({ stream: "sensitive", module: "profile", entityType: "USER", entityId: "u1", action: "PIN_CHANGED", actor: "u1", branchId: null, timestamp: "2026-08-03T00:00:00.000Z", severity: "WARNING", details: null });

    const res = await app.fetch(req("/activity", { userId: "u1" }));
    expect(res.status).toBe(200);
    const events = (await json(res)) as Array<{ actor: string; action: string }>;
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.actor === "u1")).toBe(true);
    expect(events[0]!.action).toBe("PIN_CHANGED"); // newest first
  });

  it("respects the ?limit= query, capped at 200", async () => {
    const { app, uow, audit } = newApp();
    await seedUser(uow);
    for (let i = 0; i < 5; i += 1) {
      await audit!.append({ stream: "security", module: "profile", entityType: "USER", entityId: "u1", action: `EVT_${i}`, actor: "u1", branchId: null, timestamp: `2026-08-01T00:0${i}:00.000Z`, severity: "INFO", details: null });
    }
    const res = await app.fetch(req("/activity?limit=2", { userId: "u1" }));
    const events = (await json(res)) as unknown[];
    expect(events).toHaveLength(2);
  });

  it("returns an empty list when no audit sink is wired, rather than failing", async () => {
    const { app, uow } = newApp({ withAudit: false });
    await seedUser(uow);
    const res = await app.fetch(req("/activity", { userId: "u1" }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([]);
  });
});

describe("profile router — the audit row rides in the credential change's transaction (D298)", () => {
  function failingAuditApp() {
    const uow = createSqliteUnitOfWork();
    handles.push(uow);
    const audit: AuditSink = {
      async append() {
        throw new Error("audit sink is down");
      },
      async query() {
        return [];
      },
    };
    return { app: createProfileRoutes(uow, hasher, insecureHeaderAuthContextResolver, audit), uow };
  }

  it("a password change whose audit append fails leaves the OLD password in force", async () => {
    const { app, uow } = failingAuditApp();
    await seedUser(uow);
    const before = (await uow.users.findById("u1"))!.passwordHash;

    const res = await app.fetch(
      req("/change-password", {
        method: "POST",
        userId: "u1",
        body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: "BrandNewPass1" }),
      }),
    );

    expect(res.status).toBe(500);
    expect((await uow.users.findById("u1"))!.passwordHash).toBe(before);
    expect(await hasher.verify(CURRENT_PASSWORD, (await uow.users.findById("u1"))!.passwordHash)).toBe(true);
  });

  it("a PIN change whose audit append fails leaves no PIN set", async () => {
    const { app, uow } = failingAuditApp();
    await seedUser(uow);

    const res = await app.fetch(
      req("/change-pin", {
        method: "POST",
        userId: "u1",
        body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPin: "4321" }),
      }),
    );

    expect(res.status).toBe(500);
    expect((await uow.users.findById("u1"))!.pinHash).toBeNull();
  });
});

describe("profile router — a credential change never gives the event loop away inside its transaction", () => {
  function turnCounting(uow: ReturnType<typeof newApp>["uow"]) {
    const yielded: boolean[] = [];
    const transaction = uow.transaction.bind(uow);
    uow.transaction = (fn) =>
      transaction(async (tx) => {
        let turned = false;
        const probe = setImmediate(() => {
          turned = true;
        });
        try {
          return await fn(tx);
        } finally {
          clearImmediate(probe);
          yielded.push(turned);
        }
      });
    return yielded;
  }

  it.each([
    ["/change-password", { currentPassword: CURRENT_PASSWORD, newPassword: "BrandNewPass1" }, 204],
    ["/change-pin", { currentPassword: CURRENT_PASSWORD, newPin: "482913" }, 204],
    ["/change-pin", { currentPassword: CURRENT_PASSWORD, newPin: null }, 204],
    ["/change-password", { currentPassword: "WrongPass1", newPassword: "BrandNewPass1" }, 401],
  ])("POST %s %j", async (path, body, status) => {
    const { app, uow } = newApp();
    await seedUser(uow);
    const yielded = turnCounting(uow);

    const res = await app.fetch(req(path, { method: "POST", userId: "u1", body: JSON.stringify(body) }));

    expect(res.status).toBe(status);
    expect(yielded).toEqual([false]);
  });
});
