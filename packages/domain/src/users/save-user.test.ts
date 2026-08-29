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
  pin: "123456",
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
    expect(user.pinHash).toBe("hashed:1234");
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

  it("rejects a malformed PIN", async () => {
    const uow = createFakeUow();
    await expect(saveUser({ ...baseCmd, pin: "12" }, uow, fakeHasher())).rejects.toBeInstanceOf(
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

  it("clears the PIN when pin is explicitly null", async () => {
    const uow = createFakeUow();
    await saveUser(baseCmd, uow, fakeHasher());
    const { password: _password, ...rest } = baseCmd;
    const updated = await saveUser({ ...rest, pin: null }, uow, fakeHasher());
    expect(updated.pinHash).toBeNull();
  });
});

describe("setUserStatus", () => {
  it("deactivates and reactivates a user", async () => {
    const uow = createFakeUow();
    await saveUser(baseCmd, uow, fakeHasher());
    const deactivated = await setUserStatus("user-1", "inactive", uow);
    expect(deactivated.status).toBe("inactive");
    const reactivated = await setUserStatus("user-1", "active", uow);
    expect(reactivated.status).toBe("active");
  });
});
