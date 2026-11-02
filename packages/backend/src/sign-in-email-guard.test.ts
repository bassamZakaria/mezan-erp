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
    sync: async () => [],
  };
  return { guard, held };
}

const user = (id: string, email: string): User => ({
  id, nameAr: "مستخدم", nameEn: null, email, phone: null, passwordHash: "x", mustChangePassword: false, roleId: null, isCompanyAdmin: false,
  employeeId: null, photoUrl: null, branchScope: "*", warehouseScope: "*", status: UserStatusCode.Active, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z",
});

describe("withSignInEmailGuard", () => {
  it("claims every new email before it is written, and writes nothing another company holds", async () => {
    const { guard, held } = listGuard(["taken@example.com"]);
    const uow = withSignInEmailGuard(createSqliteUnitOfWork(), guard);
    await uow.users.save(user("u1", "Ali@Example.com"));
    await uow.users.save(user("u1", "ali2@example.com"));
    expect([...held].sort()).toEqual(["ali2@example.com", "ali@example.com"]);
    await expect(uow.users.save(user("u2", "taken@example.com"))).rejects.toBeInstanceOf(EmailInAnotherCompanyError);
    expect(await uow.users.findById("u2")).toBeNull();
  });

  it("says in English, too, that the email belongs to another company", () => {
    expect(new EmailInAnotherCompanyError("taken@example.com").messageEn).toContain("another company");
  });

  it("claims inside a transaction too, and a rollback never drops an email the company still holds", async () => {
    const { guard, held } = listGuard(["taken@example.com"]);
    const uow = withSignInEmailGuard(createSqliteUnitOfWork(), guard);
    await uow.users.save(user("u1", "old@example.com"));
    await expect(
      uow.transaction(async (tx) => {
        await tx.users.save(user("u1", "new@example.com"));
        await tx.users.save(user("u2", "taken@example.com"));
      }),
    ).rejects.toBeInstanceOf(EmailInAnotherCompanyError);
    expect(held.has("old@example.com")).toBe(true);
    expect((await uow.users.findById("u1"))?.email).toBe("old@example.com");
  });

  it("never puts the seeded recovery admin on the list", async () => {
    const { guard, held } = listGuard();
    const uow = withSignInEmailGuard(createSqliteUnitOfWork(), guard);
    await uow.users.save(user(SEED_ADMIN_USER_ID, "admin@cyag.example"));
    expect([...held]).toEqual([]);
  });
});
