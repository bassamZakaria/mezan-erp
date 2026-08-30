import { describe, it, expect } from "vitest";
import { profileSchema, updateProfileSchema, changePasswordSchema, changePinSchema } from "./profile.js";

describe("profileSchema", () => {
  const profile = {
    id: "user-1",
    nameAr: "محمد الشهابي",
    nameEn: null,
    email: "mohamed@cyag.test",
    phone: null,
    isCompanyAdmin: true,
    roleId: null,
    hasPin: false,
    photoUrl: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid profile and preserves every field verbatim", () => {
    const result = profileSchema.safeParse(profile);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(profile);
  });

  it("rejects a profile missing email", () => {
    const { email, ...rest } = profile;
    const result = profileSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("email");
  });

  it("rejects a malformed email", () => {
    const result = profileSchema.safeParse({ ...profile, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised branchScope — a real dimension a caller could lose", () => {
    const result = profileSchema.safeParse({ ...profile, branchScope: "*" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchScope");
  });
});

describe("updateProfileSchema", () => {
  const update = { nameAr: "محمد الشهابي", email: "mohamed@cyag.test" };

  it("accepts a minimal valid payload and defaults nullable fields to null", () => {
    const result = updateProfileSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nameEn).toBeNull();
      expect(result.data.phone).toBeNull();
      expect(result.data.photoUrl).toBeNull();
    }
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = update;
    const result = updateProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("rejects a malformed email", () => {
    const result = updateProfileSchema.safeParse({ ...update, email: "bad" });
    expect(result.success).toBe(false);
  });

  it("rejects a photoUrl longer than PHOTO_MAX_CHARS", () => {
    const result = updateProfileSchema.safeParse({ ...update, photoUrl: "data:image/png;base64," + "A".repeat(250_000) });
    expect(result.success).toBe(false);
  });

  it("accepts a photoUrl at exactly PHOTO_MAX_CHARS", () => {
    const result = updateProfileSchema.safeParse({ ...update, photoUrl: "A".repeat(250_000) });
    expect(result.success).toBe(true);
  });
});

describe("changePasswordSchema", () => {
  const payload = { currentPassword: "OldPass123", newPassword: "NewPass456" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = changePasswordSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("rejects a payload missing currentPassword", () => {
    const { currentPassword, ...rest } = payload;
    const result = changePasswordSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("currentPassword");
  });

  it("rejects a newPassword shorter than 8 characters", () => {
    const result = changePasswordSchema.safeParse({ ...payload, newPassword: "short" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.newPassword?.[0]).toContain("8 characters");
  });
});

describe("changePinSchema", () => {
  const payload = { currentPassword: "OldPass123", newPin: "1234" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = changePinSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("accepts a null newPin to remove it", () => {
    const result = changePinSchema.safeParse({ ...payload, newPin: null });
    expect(result.success).toBe(true);
  });

  it("rejects a 3-digit PIN", () => {
    const result = changePinSchema.safeParse({ ...payload, newPin: "123" });
    expect(result.success).toBe(false);
  });

  it("rejects a 7-digit PIN", () => {
    const result = changePinSchema.safeParse({ ...payload, newPin: "1234567" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric PIN", () => {
    const result = changePinSchema.safeParse({ ...payload, newPin: "abcd" });
    expect(result.success).toBe(false);
  });
});
