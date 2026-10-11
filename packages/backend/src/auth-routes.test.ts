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
  let checked!: () => void;
  const checking = new Promise<void>((resolve) => {
    checked = resolve;
  });
  let asked!: () => void;
  const verifyAsked = new Promise<void>((resolve) => {
    asked = resolve;
  });
  const hasher: SecretHasher = {
    hash: async (secret) => `hash:${secret}`,
    verify: async (secret, hash) => {
      asked();
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
  const signIn = () =>
    app.fetch(
      new Request("http://local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: cashier.email, pin: "135790" }),
      }),
    );
  return { users, signIn, verifyAsked, finishChecking: checked, issued: () => issued };
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

  it("signs in an account nothing happened to", async () => {
    const t = mounted();

    const answer = t.signIn();
    await t.verifyAsked;
    t.finishChecking();

    expect((await answer).status).toBe(200);
    expect(t.issued()).toBe(1);
  });
});
