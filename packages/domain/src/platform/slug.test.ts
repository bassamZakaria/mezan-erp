import { describe, it, expect } from "vitest";
import { isReservedTenantCode, isValidSlug } from "./slug.js";

describe("isValidSlug", () => {
  it("accepts lower-case letters, digits and inner hyphens, 3 to 32 long", () => {
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("cyag-2026")).toBe(true);
    expect(isValidSlug("a".repeat(32))).toBe(true);
  });

  it("rejects upper case, edges hyphens, spaces, Arabic, and bad lengths", () => {
    expect(isValidSlug("Cyag")).toBe(false);
    expect(isValidSlug("-cyag")).toBe(false);
    expect(isValidSlug("cyag-")).toBe(false);
    expect(isValidSlug("cy ag")).toBe(false);
    expect(isValidSlug("سياج")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(33))).toBe(false);
  });
});

describe("isReservedTenantCode", () => {
  it("reserves the names the platform itself answers to, and every released tenant's code", () => {
    for (const code of ["platform", "tenants", "api", "www", "admin", "app", "signup", "demo", "released-abc", "released-0b5e5f01"]) {
      expect(isReservedTenantCode(code)).toBe(true);
    }
  });

  it("leaves an ordinary company code free, including one that only contains a reserved word", () => {
    for (const code of ["cyag", "demo-shop", "my-api", "platform2", "unreleased-1", "released"]) {
      expect(isReservedTenantCode(code)).toBe(false);
    }
  });
});
