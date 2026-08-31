import { describe, it, expect } from "vitest";
import { createFakeUow } from "../test-support/fake-uow.js";
import { ALL_SCOPE } from "../permissions/auth-context.js";
import type { SecretHasher } from "./user.js";
import {
  saveUser,
  setUserStatus,
  emailDomain,
  InvalidUserError,
  EmailDomainNotAllowedError,
  UserNotFoundError,
} from "./save-user.js";

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

describe("saveUser — malformed (non-empty) email", () => {
  it("rejects a non-empty email that does not match the email pattern", async () => {
    const uow = createFakeUow();
    await expect(saveUser({ ...baseCmd, email: "not-an-email" }, uow, fakeHasher())).rejects.toBeInstanceOf(
      InvalidUserError,
    );
  });
});

describe("saveUser — allowed email domains", () => {
  it("accepts an email whose domain is in the allowlist", async () => {
    const uow = createFakeUow();
    const user = await saveUser(baseCmd, uow, fakeHasher(), { allowedEmailDomains: ["cyag.test"] });
    expect(user.email).toBe("mohamed@cyag.test");
  });

  it("rejects an email whose domain is not in the allowlist", async () => {
    const uow = createFakeUow();
    await expect(
      saveUser(baseCmd, uow, fakeHasher(), { allowedEmailDomains: ["other.test"] }),
    ).rejects.toBeInstanceOf(EmailDomainNotAllowedError);
  });
});

describe("saveUser — the pin field left unset", () => {
  it("leaves the pin unset (no prior record) when the command omits pin entirely", async () => {
    const uow = createFakeUow();
    const { pin: _pin, ...cmdWithoutPin } = baseCmd;
    const user = await saveUser(cmdWithoutPin, uow, fakeHasher());
    expect(user.pinHash).toBeNull();
  });

  it("keeps the prior record's pin hash unchanged when an update omits pin entirely", async () => {
    const uow = createFakeUow();
    const created = await saveUser(baseCmd, uow, fakeHasher());
    expect(created.pinHash).toBe(`hashed:${baseCmd.pin}`);

    const { pin: _pin, password: _password, ...cmdWithoutPin } = baseCmd;
    const updated = await saveUser({ ...cmdWithoutPin, nameAr: "محمد الشهابي (محدث)" }, uow, fakeHasher());
    expect(updated.pinHash).toBe(created.pinHash);
  });
});

describe("emailDomain", () => {
  it("returns an empty string for an address with no @", () => {
    expect(emailDomain("not-an-email")).toBe("");
  });
});

describe("saveUser — a new user with no password", () => {
  it("refuses to create a user that has no password and no prior record to inherit one from", async () => {
    const uow = createFakeUow();
    const { password: _password, ...cmdWithoutPassword } = baseCmd;
    await expect(saveUser(cmdWithoutPassword, uow, fakeHasher())).rejects.toBeInstanceOf(InvalidUserError);
  });
});

describe("saveUser — explicit photo URL", () => {
  it("stores an explicitly provided photo URL rather than falling back to the prior one", async () => {
    const uow = createFakeUow();
    const user = await saveUser({ ...baseCmd, photoUrl: "data:image/png;base64,xyz" }, uow, fakeHasher());
    expect(user.photoUrl).toBe("data:image/png;base64,xyz");
  });
});

describe("setUserStatus — an unknown user id", () => {
  it("throws UserNotFoundError when the user does not exist", async () => {
    const uow = createFakeUow();
    await expect(setUserStatus("ghost-user", "inactive", uow)).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
