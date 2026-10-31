import { describe, expect, it } from "vitest";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { EmailInAnotherCompanyError, UserStatusCode, type SignInEmailGuard, type User } from "@mezan/domain";
import { withSignInEmailGuard } from "./sign-in-email-guard.js";
import { SEED_ADMIN_USER_ID } from "./seed.js";

function listGuard(heldElsewhere: readonly string[] = []) {
  const held = new Set<string>();
  const guard: SignInEmailGuard = {
    claim: async (email) => {
      if (heldElsewhere.includes(email)) throw new EmailInAnotherCompanyError(email);
      held.add(email);
    },
    release: async (email) => {
      held.delete(email);
    },
    sync: async () => [],
  };
  return { guard, held };
}

const user = (id: string, email: string): User => ({
  id, nameAr: "مستخدم", nameEn: null, email, phone: null, passwordHash: "x", mustChangePassword: false, roleId: null, isCompanyAdmin: false,
  employeeId: null, photoUrl: null, branchScope: "*", warehouseScope: "*", status: UserStatusCode.Active, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z",
});

describe("withSignInEmailGuard", () => {
  it("claims a new email, moves the claim when it changes, and refuses one another company holds", async () => {
    const { guard, held } = listGuard(["taken@example.com"]);
    const uow = withSignInEmailGuard(createSqliteUnitOfWork(), guard, (fn) => fn(), () => {});
    await uow.users.save(user("u1", "Ali@Example.com"));
    expect([...held]).toEqual(["ali@example.com"]);
    await uow.users.save(user("u1", "ali2@example.com"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...held]).toEqual(["ali2@example.com"]);
    await expect(uow.users.save(user("u2", "taken@example.com"))).rejects.toBeInstanceOf(EmailInAnotherCompanyError);
    expect(await uow.users.findById("u2")).toBeNull();
  });

  it("undoes a claim and keeps the old email when the transaction rolls back", async () => {
    const { guard, held } = listGuard();
    const uow = withSignInEmailGuard(createSqliteUnitOfWork(), guard, (fn) => fn(), () => {});
    await uow.users.save(user("u1", "old@example.com"));
    await expect(
      uow.transaction(async (tx) => {
        await tx.users.save(user("u1", "new@example.com"));
        await tx.users.save(user("u2", "other@example.com"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect([...held].sort()).toEqual(["old@example.com"]);
    expect((await uow.users.findById("u1"))?.email).toBe("old@example.com");
  });

  it("never puts the seeded recovery admin on the list", async () => {
    const { guard, held } = listGuard();
    const uow = withSignInEmailGuard(createSqliteUnitOfWork(), guard, (fn) => fn(), () => {});
    await uow.users.save(user(SEED_ADMIN_USER_ID, "admin@cyag.example"));
    expect([...held]).toEqual([]);
  });
});
