import { describe, it, expect } from "vitest";
import { createUserSchema } from "./users.js";

const base = {
  fullName: "محمد الشهابي",
  email: "mohamed@cyag.test",
  phone: null,
  employeeId: null,
  branchScope: "*" as const,
  warehouseScope: "*" as const,
  status: "active" as const,
  password: "TempPass123",
};

describe("createUserSchema", () => {
  it("accepts a company-admin user with roleId null", () => {
    const result = createUserSchema.safeParse({ ...base, roleId: null, isCompanyAdmin: true });
    expect(result.success).toBe(true);
  });

  it("accepts a role-scoped user", () => {
    const result = createUserSchema.safeParse({ ...base, roleId: "role-1", isCompanyAdmin: false });
    expect(result.success).toBe(true);
  });

  it("rejects a user that is both company-admin and role-scoped", () => {
    const result = createUserSchema.safeParse({ ...base, roleId: "role-1", isCompanyAdmin: true });
    expect(result.success).toBe(false);
  });

  it("rejects a user that is neither", () => {
    const result = createUserSchema.safeParse({ ...base, roleId: null, isCompanyAdmin: false });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed PIN", () => {
    const result = createUserSchema.safeParse({ ...base, roleId: null, isCompanyAdmin: true, pin: "12" });
    expect(result.success).toBe(false);
  });

  it("rejects a short password", () => {
    const result = createUserSchema.safeParse({ ...base, roleId: null, isCompanyAdmin: true, password: "short" });
    expect(result.success).toBe(false);
  });
});
