import { describe, it, expect } from "vitest";
import { createFakeUow } from "../test-support/fake-uow.js";
import { ALL_SCOPE } from "../permissions/auth-context.js";
import type { SecretHasher } from "./user.js";
import {
  saveUser,
  setUserStatus,
  InvalidUserError,
  DuplicateUserEmailError,
  UnknownRoleError,
  LastCompanyAdminError,
} from "./save-user.js";

/** Deterministic fake hasher — "hashed:<secret>" — so tests can assert without real crypto. */
function fakeHasher(): SecretHasher {
  return {
    async hash(secret) {
      return `hashed:${secret}`;
    },
    async verify(secret, hash) {
      return hash === `hashed:${secret}`;
    },
  };
}

const baseCmd = {
  id: "user-1",
  nameAr: "محمد الشهابي",
    nameEn: null,
  email: "mohamed@cyag.test",
  phone: "+201000000000",
  password: "TempPass123",
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: ALL_SCOPE,
  warehouseScope: ALL_SCOPE,
  status: "active" as const,
  createdAt: "2026-08-08T00:00:00.000Z",
};

describe("saveUser", () => {
  it("creates a company-admin user and hashes its secrets", async () => {
    const uow = createFakeUow();
    const user = await saveUser(baseCmd, uow, fakeHasher());
    expect(user.passwordHash).toBe("hashed:TempPass123");
    expect(user.mustChangePassword).toBe(true);
    expect(user.roleId).toBeNull();
    expect(user.isCompanyAdmin).toBe(true);
  });

  it("creates a role-scoped user (not company-admin) when a role is given", async () => {
    const uow = createFakeUow();
    uow.roleRecords.set("role-1", {
      id: "role-1",
      code: "VAN_SALES",
      name: "مندوب مبيعات",
      description: "",
      permissions: [],
      isSystem: false,
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    const user = await saveUser(
      { ...baseCmd, id: "user-2", email: "rep@cyag.test", isCompanyAdmin: false, roleId: "role-1", branchScope: ["MAIN"] },
      uow,
      fakeHasher(),
    );
    expect(user.roleId).toBe("role-1");
    expect(user.isCompanyAdmin).toBe(false);
  });

  it("rejects a user that is neither company-admin nor role-scoped", async () => {
    const uow = createFakeUow();
    await expect(
      saveUser({ ...baseCmd, isCompanyAdmin: false, roleId: null }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(InvalidUserError);
  });

  it("rejects a user that is both company-admin and role-scoped", async () => {
    const uow = createFakeUow();
    await expect(
      saveUser({ ...baseCmd, isCompanyAdmin: true, roleId: "role-1" }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(InvalidUserError);
  });

  it("rejects an empty branch scope", async () => {
    const uow = createFakeUow();
    await expect(
      saveUser({ ...baseCmd, branchScope: [] }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(InvalidUserError);
  });

  it("rejects a role id that does not exist", async () => {
    const uow = createFakeUow();
    await expect(
      saveUser({ ...baseCmd, isCompanyAdmin: false, roleId: "ghost", branchScope: ["MAIN"] }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(UnknownRoleError);
  });

  it("rejects a duplicate email on create", async () => {
    const uow = createFakeUow();
    await saveUser(baseCmd, uow, fakeHasher());
    await expect(
      saveUser({ ...baseCmd, id: "user-2" }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(DuplicateUserEmailError);
  });

  it("rejects a blank full name", async () => {
    const uow = createFakeUow();
    await expect(saveUser({ ...baseCmd, nameAr: "   ",
    nameEn: null }, uow, fakeHasher())).rejects.toBeInstanceOf(
      InvalidUserError,
    );
  });

  it("rejects a blank email", async () => {
    const uow = createFakeUow();
    await expect(saveUser({ ...baseCmd, email: "   " }, uow, fakeHasher())).rejects.toBeInstanceOf(
      InvalidUserError,
    );
  });

  it("keeps the existing password hash on update when password is omitted", async () => {
    const uow = createFakeUow();
    const created = await saveUser(baseCmd, uow, fakeHasher());
    const { password: _password, ...rest } = baseCmd;
    const updated = await saveUser({ ...rest, nameAr: "محمد الشهابي (محدث)",
    nameEn: null }, uow, fakeHasher());
    expect(updated.passwordHash).toBe(created.passwordHash);
    expect(updated.nameAr).toBe("محمد الشهابي (محدث)");
  });

  it("marks a given password temporary by default, and not when the caller says it is the user's own", async () => {
    const uow = createFakeUow();
    expect((await saveUser(baseCmd, uow, fakeHasher())).mustChangePassword).toBe(true);
    const own = await saveUser({ ...baseCmd, password: "OwnPass123", passwordIsTemporary: false }, uow, fakeHasher());
    expect(own.mustChangePassword).toBe(false);
  });

  it("keeps the prior temporary-password flag on an update that does not touch the password", async () => {
    const uow = createFakeUow();
    await saveUser(baseCmd, uow, fakeHasher());
    const { password: _password, ...rest } = baseCmd;
    expect((await saveUser({ ...rest, nameAr: "محمد" }, uow, fakeHasher())).mustChangePassword).toBe(true);
    await saveUser({ ...baseCmd, passwordIsTemporary: false }, uow, fakeHasher());
    expect((await saveUser({ ...rest, nameAr: "محمد" }, uow, fakeHasher())).mustChangePassword).toBe(false);
  });
});

/** A second active company admin, so the last-admin guard is not what is under test. */
async function seedSpareAdmin(uow: ReturnType<typeof createFakeUow>) {
  await saveUser({ ...baseCmd, id: "user-keeper", email: "keeper@cyag.test" }, uow, fakeHasher());
}

describe("setUserStatus", () => {
  it("deactivates and reactivates a user", async () => {
    const uow = createFakeUow();
    await seedSpareAdmin(uow);
    await saveUser(baseCmd, uow, fakeHasher());
    const deactivated = await setUserStatus("user-1", "inactive", uow);
    expect(deactivated.status).toBe("inactive");
    const reactivated = await setUserStatus("user-1", "active", uow);
    expect(reactivated.status).toBe("active");
  });
});

/**
 * The tenant must never be left without a way in. There is no support console
 * behind this product: an admin flag that can be removed from the last account
 * holding it is a one-click, irreversible lockout (D117).
 */
describe("the last active company admin", () => {
  it("refuses to deactivate the only one, and leaves the record untouched", async () => {
    const uow = createFakeUow();
    await saveUser(baseCmd, uow, fakeHasher());

    await expect(setUserStatus("user-1", "inactive", uow)).rejects.toBeInstanceOf(LastCompanyAdminError);
    expect((await uow.users.findById("user-1"))?.status).toBe("active");
  });

  it("refuses to demote the only one through saveUser, keeping the admin flag", async () => {
    const uow = createFakeUow();
    uow.roleRecords.set("role-1", {
      id: "role-1",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: [],
      isSystem: false,
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    await saveUser(baseCmd, uow, fakeHasher());

    const { password: _password, ...rest } = baseCmd;
    await expect(
      saveUser({ ...rest, isCompanyAdmin: false, roleId: "role-1", branchScope: ["MAIN"] }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(LastCompanyAdminError);

    const after = await uow.users.findById("user-1");
    expect(after?.isCompanyAdmin).toBe(true);
    expect(after?.roleId).toBeNull();
    // The rest of the command must not have landed either.
    expect(after?.branchScope).toBe(ALL_SCOPE);
  });

  it("allows the demotion once a SECOND active admin exists (negative control)", async () => {
    const uow = createFakeUow();
    uow.roleRecords.set("role-1", {
      id: "role-1",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: [],
      isSystem: false,
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    await saveUser(baseCmd, uow, fakeHasher());
    await seedSpareAdmin(uow);

    const { password: _password, ...rest } = baseCmd;
    const demoted = await saveUser(
      { ...rest, isCompanyAdmin: false, roleId: "role-1", branchScope: ["MAIN"] },
      uow,
      fakeHasher(),
    );
    expect(demoted.isCompanyAdmin).toBe(false);
    expect((await uow.users.findById("user-keeper"))?.isCompanyAdmin).toBe(true);
  });

  it("does not count an INACTIVE admin as the way back in", async () => {
    const uow = createFakeUow();
    await saveUser(baseCmd, uow, fakeHasher());
    await saveUser({ ...baseCmd, id: "user-old", email: "old@cyag.test", status: "inactive" }, uow, fakeHasher());

    // Two admins on the books, one of them unable to sign in — deactivating
    // the active one still ends with nobody who can administer the tenant.
    await expect(setUserStatus("user-1", "inactive", uow)).rejects.toBeInstanceOf(LastCompanyAdminError);
    expect((await uow.users.findById("user-1"))?.status).toBe("active");
  });

  it("leaves an ordinary user's deactivation alone", async () => {
    const uow = createFakeUow();
    uow.roleRecords.set("role-1", {
      id: "role-1",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: [],
      isSystem: false,
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    await saveUser(baseCmd, uow, fakeHasher());
    await saveUser(
      { ...baseCmd, id: "user-clerk", email: "clerk@cyag.test", isCompanyAdmin: false, roleId: "role-1", branchScope: ["MAIN"] },
      uow,
      fakeHasher(),
    );

    expect((await setUserStatus("user-clerk", "inactive", uow)).status).toBe("inactive");
  });
});
