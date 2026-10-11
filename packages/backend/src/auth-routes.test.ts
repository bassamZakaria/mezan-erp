import { describe, expect, it } from "vitest";
import { ALL_SCOPE, createDefaultSettings, type SecretHasher, type UnitOfWork, type User } from "@mezan/domain";
import { createSessionRegistry } from "@mezan/api";
import { createAuthRoutes, type AuthRoutesDeps } from "./auth-routes.js";

const cashier: User = {
  id: "user-1",
  nameAr: "أمين الخزنة",
  nameEn: "Cashier",
  email: "cashier@example.eg",
  phone: null,
  passwordHash: "hash:password",
  pinHash: "hash:135790",
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: ALL_SCOPE,
  warehouseScope: ALL_SCOPE,
  status: "active",
  photoUrl: null,
  lastLoginAt: null,
  createdAt: "2026-09-01T08:00:00.000Z",
};

function mounted() {
  const users = new Map<string, User>([[cashier.id, cashier]]);
  let checked: () => void = () => undefined;
  let asked!: () => void;
  let verifyAsked = new Promise<void>((resolve) => {
    asked = resolve;
  });
  const firstVerify = verifyAsked;
  const hasher: SecretHasher = {
    hash: async (secret) => `hash:${secret}`,
    verify: async (secret, hash) => {
      const checking = new Promise<void>((resolve) => {
        checked = resolve;
      });
      const announce = asked;
      verifyAsked = new Promise<void>((resolve) => {
        asked = resolve;
      });
      announce();
      await checking;
      return hash === `hash:${secret}`;
    },
  };
  const uow = {
    users: {
      findById: async (id: string) => users.get(id) ?? null,
      findByEmail: async (email: string) => [...users.values()].find((user) => user.email === email) ?? null,
      list: async () => [...users.values()],
      save: async (user: User) => void users.set(user.id, user),
    },
    roles: { findById: async () => null },
  } as unknown as UnitOfWork;
  const sessions = createSessionRegistry();
  let issued = 0;
  const deps: AuthRoutesDeps = {
    uow,
    hasher,
    settings: { get: async () => createDefaultSettings(), save: async () => undefined },
    seedStores: undefined as never,
    sessions: { ...sessions, issue: (grant, origin) => ((issued += 1), sessions.issue(grant, origin)) },
  };
  const app = createAuthRoutes(deps);
  let pending = firstVerify;
  const signIn = (from?: string) => {
    pending = verifyAsked;
    return app.fetch(
      new Request("http://local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: cashier.email, pin: "135790" }),
      }),
      from ? { incoming: { socket: { remoteAddress: from } } } : undefined,
    );
  };
  return { users, signIn, verifyAsked: firstVerify, nextVerify: () => pending, finishChecking: () => checked(), issued: () => issued };
}

describe("a sign-in whose account changes while its PIN is being checked", () => {
  it("issues no session to an account deactivated during the check", async () => {
    const t = mounted();

    const answer = t.signIn();
    await t.verifyAsked;
    t.users.set(cashier.id, { ...cashier, status: "inactive" });
    t.finishChecking();

    expect((await answer).status).toBe(401);
    expect(t.issued()).toBe(0);
  });

  it("issues no session on a PIN that was replaced during the check", async () => {
    const t = mounted();

    const answer = t.signIn();
    await t.verifyAsked;
    t.users.set(cashier.id, { ...cashier, pinHash: "hash:999999" });
    t.finishChecking();

    expect((await answer).status).toBe(401);
    expect(t.issued()).toBe(0);
  });

  it("does not count a PIN replaced during the check as a failed attempt against the account", async () => {
    const t = mounted();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const answer = t.signIn("41.33.10.10");
      await t.nextVerify();
      t.users.set(cashier.id, { ...cashier, pinHash: `hash:replaced-${attempt}` });
      t.finishChecking();
      expect((await answer).status).toBe(401);
      t.users.set(cashier.id, cashier);
    }

    const honest = t.signIn("41.33.10.10");
    await t.nextVerify();
    t.finishChecking();
    expect((await honest).status).toBe(200);
  });

  it("issues the session for the account as it stands after the check, not as it was read before it", async () => {
    const t = mounted();

    const answer = t.signIn();
    await t.verifyAsked;
    t.users.set(cashier.id, { ...cashier, isCompanyAdmin: false, nameAr: "اسم جديد", branchScope: ["BR-2"] });
    t.finishChecking();

    const session = (await (await answer).json()) as { isCompanyAdmin: boolean; nameAr: string; permissions: string[]; branchScope: unknown };
    expect(session.isCompanyAdmin).toBe(false);
    expect(session.permissions).toEqual([]);
    expect(session.nameAr).toBe("اسم جديد");
    expect(session.branchScope).toEqual(["BR-2"]);
  });

  it("signs in an account nothing happened to", async () => {
    const t = mounted();

    const answer = t.signIn();
    await t.verifyAsked;
    t.finishChecking();

    expect((await answer).status).toBe(200);
    expect(t.issued()).toBe(1);
  });
});
