import { describe, it, expect } from "vitest";
import { createRoleSchema } from "./roles.js";

describe("createRoleSchema", () => {
  it("accepts an upper-snake-case code", () => {
    const result = createRoleSchema.safeParse({ code: "VAN_SALES", name: "مندوب مبيعات", permissions: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a lowercase code", () => {
    const result = createRoleSchema.safeParse({ code: "van_sales", name: "مندوب مبيعات", permissions: [] });
    expect(result.success).toBe(false);
  });

  it("defaults description and permissions when omitted", () => {
    const result = createRoleSchema.parse({ code: "VAN_SALES", name: "مندوب مبيعات" });
    expect(result.description).toBe("");
    expect(result.permissions).toEqual([]);
  });
});
