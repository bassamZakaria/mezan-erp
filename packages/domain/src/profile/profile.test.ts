import { describe, expect, it } from "vitest";
import { createFakeUow } from "../test-support/fake-uow.js";
import { ALL_SCOPE } from "../permissions/auth-context.js";
import { InvalidUserError, DuplicateUserEmailError, UserNotFoundError } from "../users/save-user.js";
import type { SecretHasher, User } from "../users/user.js";
import {
  updateOwnProfile,
  changeOwnPassword,
  IncorrectPasswordError,
} from "./profile.js";

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

function seedUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    nameAr: "محمد الشهابي",
    nameEn: null,
    email: "mohamed@cyag.test",
    phone: "+201000000000",
    passwordHash: "hashed:CurrentPass1",
    mustChangePassword: false,
    roleId: null,
    isCompanyAdmin: true,
    employeeId: null,
    photoUrl: null,
    branchScope: ALL_SCOPE,
    warehouseScope: ALL_SCOPE,
    status: "active",
    lastLoginAt: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("updateOwnProfile", () => {
  it("updates name/email/phone and leaves everything else (including secrets and role) alone", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser());
    const updated = await updateOwnProfile(
      "user-1",
      { nameAr: "محمد أحمد", email: "mohamed.ahmed@cyag.test", phone: "+201111111111" },
      uow,
    );
    expect(updated.nameAr).toBe("محمد أحمد");
    expect(updated.email).toBe("mohamed.ahmed@cyag.test");
    expect(updated.phone).toBe("+201111111111");
    expect(updated.passwordHash).toBe("hashed:CurrentPass1");
    expect(updated.roleId).toBeNull();
    expect(updated.isCompanyAdmin).toBe(true);
    const persisted = await uow.users.findById("user-1");
    expect(persisted?.email).toBe("mohamed.ahmed@cyag.test");
  });

  it("leaves photoUrl untouched when omitted, but clears it when explicitly null", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser({ photoUrl: "data:image/png;base64,abc" }));

    const untouched = await updateOwnProfile(
      "user-1",
      { nameAr: "محمد الشهابي", email: "mohamed@cyag.test", phone: null },
      uow,
    );
    expect(untouched.photoUrl).toBe("data:image/png;base64,abc");

    const cleared = await updateOwnProfile(
      "user-1",
      { nameAr: "محمد الشهابي", email: "mohamed@cyag.test", phone: null, photoUrl: null },
      uow,
    );
    expect(cleared.photoUrl).toBeNull();
  });

  it("rejects an email already used by ANOTHER user, and writes nothing", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser({ id: "user-1", email: "one@cyag.test" }));
    await uow.users.save(seedUser({ id: "user-2", email: "two@cyag.test" }));

    await expect(
      updateOwnProfile("user-2", { nameAr: "مستخدم آخر", email: "one@cyag.test", phone: null }, uow),
    ).rejects.toBeInstanceOf(DuplicateUserEmailError);

    const untouched = await uow.users.findById("user-2");
    expect(untouched?.email).toBe("two@cyag.test");
  });

  it("allows keeping the caller's OWN current email unchanged (not a duplicate against itself)", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser({ email: "mohamed@cyag.test" }));
    const updated = await updateOwnProfile(
      "user-1",
      { nameAr: "محمد الشهابي المعدّل", email: "mohamed@cyag.test", phone: null },
      uow,
    );
    expect(updated.email).toBe("mohamed@cyag.test");
  });

  it("rejects a blank name or email", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser());
    await expect(
      updateOwnProfile("user-1", { nameAr: "   ", email: "mohamed@cyag.test", phone: null }, uow),
    ).rejects.toBeInstanceOf(InvalidUserError);
    await expect(
      updateOwnProfile("user-1", { nameAr: "محمد", email: "   ", phone: null }, uow),
    ).rejects.toBeInstanceOf(InvalidUserError);
  });

  it("throws UserNotFoundError for an id no session could actually resolve", async () => {
    const uow = createFakeUow();
    await expect(
      updateOwnProfile("ghost", { nameAr: "محمد", email: "m@cyag.test", phone: null }, uow),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe("changeOwnPassword", () => {
  it("verifies the CURRENT password before accepting a new one, and hashes the new one", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser());
    await changeOwnPassword("user-1", { currentPassword: "CurrentPass1", newPassword: "BrandNewPass1" }, uow, fakeHasher());
    const updated = await uow.users.findById("user-1");
    expect(updated?.passwordHash).toBe("hashed:BrandNewPass1");
  });

  it("rejects the WRONG current password and changes nothing", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser());
    await expect(
      changeOwnPassword("user-1", { currentPassword: "WrongPass", newPassword: "BrandNewPass1" }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(IncorrectPasswordError);
    const untouched = await uow.users.findById("user-1");
    expect(untouched?.passwordHash).toBe("hashed:CurrentPass1");
  });

  it("rejects a new password shorter than 8 characters, without touching the stored hash", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser());
    await expect(
      changeOwnPassword("user-1", { currentPassword: "CurrentPass1", newPassword: "short1" }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(InvalidUserError);
    const untouched = await uow.users.findById("user-1");
    expect(untouched?.passwordHash).toBe("hashed:CurrentPass1");
  });

  it("accepts exactly 8 characters — the boundary is inclusive", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser());
    await changeOwnPassword("user-1", { currentPassword: "CurrentPass1", newPassword: "12345678" }, uow, fakeHasher());
    const updated = await uow.users.findById("user-1");
    expect(updated?.passwordHash).toBe("hashed:12345678");
  });

  it("clears the temporary-password flag once the user picks their own", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser({ mustChangePassword: true }));
    await changeOwnPassword("user-1", { currentPassword: "CurrentPass1", newPassword: "BrandNewPass1" }, uow, fakeHasher());
    expect((await uow.users.findById("user-1"))?.mustChangePassword).toBe(false);
  });

  it("refuses a new password equal to the current one and keeps the flag", async () => {
    const uow = createFakeUow();
    await uow.users.save(seedUser({ mustChangePassword: true }));
    await expect(
      changeOwnPassword("user-1", { currentPassword: "CurrentPass1", newPassword: "CurrentPass1" }, uow, fakeHasher()),
    ).rejects.toBeInstanceOf(InvalidUserError);
    expect((await uow.users.findById("user-1"))?.mustChangePassword).toBe(true);
  });
});
