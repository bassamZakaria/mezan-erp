import { describe, it, expect } from "vitest";
import {
  loginRequestSchema,
  sessionSchema,
  loginResponseSchema,
  bootstrapAdminRequestSchema,
  bootstrapSeedResultSchema,
} from "./auth.js";

describe("loginRequestSchema", () => {
  const login = { username: "mohamed@cyag.test", password: "Cyag@2026" };

  it("accepts a minimal valid login and preserves every field verbatim", () => {
    const result = loginRequestSchema.safeParse(login);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(login);
  });

  it("rejects a login missing password", () => {
    const { password, ...rest } = login;
    const result = loginRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("password");
  });

  it("rejects an empty password", () => {
    expect(loginRequestSchema.safeParse({ ...login, password: "" }).success).toBe(false);
  });

  it("still accepts a legacy 6-digit secret, so an upgraded install signs in once to replace it", () => {
    expect(loginRequestSchema.safeParse({ ...login, password: "123456" }).success).toBe(true);
  });

  it("no longer accepts a pin in place of the password", () => {
    expect(loginRequestSchema.safeParse({ username: login.username, pin: "123456" }).success).toBe(false);
  });
});

describe("sessionSchema", () => {
  const session = {
    userId: "user-1",
    nameAr: "محمد الشهابي",
    nameEn: null,
    email: "mohamed@cyag.test",
    isCompanyAdmin: true,
    mustChangePassword: false,
    permissions: ["*"],
    roleCode: null,
    photoUrl: null,
    branchScope: "*" as const,
    warehouseScope: "*" as const,
    tenantName: "Acme Co",
    token: "opaque-token-1",
  };

  it("accepts a minimal valid session and preserves every field verbatim", () => {
    const result = sessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(session);
  });

  it("accepts a scoped-array branchScope and warehouseScope", () => {
    const result = sessionSchema.safeParse({ ...session, branchScope: ["branch-1"], warehouseScope: ["wh-1"] });
    expect(result.success).toBe(true);
  });

  it("accepts a session with no token, which is how the cloud edition's cookie session reaches the browser", () => {
    const { token, ...rest } = session;
    expect(sessionSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects a session that does not say whether the password must be changed", () => {
    const { mustChangePassword, ...rest } = session;
    expect(sessionSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an invalid branchScope — neither '*' nor an array", () => {
    const result = sessionSchema.safeParse({ ...session, branchScope: "some-branch" });
    expect(result.success).toBe(false);
  });
});

describe("loginResponseSchema", () => {
  it("is the same shape as sessionSchema", () => {
    expect(loginResponseSchema).toBe(sessionSchema);
  });
});

describe("bootstrapAdminRequestSchema", () => {
  const admin = { nameAr: "محمد الشهابي", email: "Mohamed@CYAG.test", password: "OwnerPass1", companyName: "  متجر الياسمين  " };

  it("requires the company being claimed and trims it", () => {
    const { companyName, ...unnamed } = admin;
    expect(bootstrapAdminRequestSchema.safeParse(unnamed).success).toBe(false);
    expect(bootstrapAdminRequestSchema.safeParse({ ...unnamed, companyName: null }).success).toBe(false);
    const named = bootstrapAdminRequestSchema.safeParse(admin);
    expect(named.success && named.data.companyName).toBe(companyName.trim());
  });

  it("accepts a minimal valid payload and lower-cases/trims the email", () => {
    const result = bootstrapAdminRequestSchema.safeParse(admin);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("mohamed@cyag.test");
  });

  it("defaults nameEn to null when omitted", () => {
    const result = bootstrapAdminRequestSchema.safeParse(admin);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nameEn).toBeNull();
  });

  it("rejects a malformed email", () => {
    const result = bootstrapAdminRequestSchema.safeParse({ ...admin, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a first-admin password shorter than 8 characters", () => {
    const result = bootstrapAdminRequestSchema.safeParse({ ...admin, password: "1234567" });
    expect(result.success).toBe(false);
  });
});

describe("bootstrapSeedResultSchema", () => {
  const result = { accounts: 50, taxRates: 3, branches: 1, warehouses: 1, fiscalPeriods: 12, users: 1 };

  it("accepts a minimal valid result and preserves every field verbatim", () => {
    const parsed = bootstrapSeedResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("accepts an all-zero result for an already-seeded tenant found idempotently", () => {
    const zeros = { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0 };
    expect(bootstrapSeedResultSchema.safeParse(zeros).success).toBe(true);
  });

  it("rejects a negative count", () => {
    const parsed = bootstrapSeedResultSchema.safeParse({ ...result, accounts: -1 });
    expect(parsed.success).toBe(false);
  });
});
