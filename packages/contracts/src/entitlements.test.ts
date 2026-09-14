import { describe, it, expect } from "vitest";
import { featureFlagsSchema, entitlementsSchema, licensePayloadSchema } from "./entitlements.js";

describe("featureFlagsSchema", () => {
  it("accepts a record of feature name to boolean and preserves it verbatim", () => {
    const flags = { manufacturing: true, hr: false };
    const result = featureFlagsSchema.safeParse(flags);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(flags);
  });

  it("rejects a flag value that is not a boolean", () => {
    const result = featureFlagsSchema.safeParse({ manufacturing: "yes" });
    expect(result.success).toBe(false);
  });
});

describe("entitlementsSchema", () => {
  const entitlements = {
    plan: "pro",
    activeModules: ["sales", "inventory"],
    features: { manufacturing: false },
    seats: 5,
    expiresAt: "2027-08-30T00:00:00.000Z",
  };

  it("accepts a minimal valid entitlements object and preserves every field verbatim", () => {
    const result = entitlementsSchema.safeParse(entitlements);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(entitlements);
  });

  it("accepts a null expiresAt for a perpetual license", () => {
    const result = entitlementsSchema.safeParse({ ...entitlements, expiresAt: null });
    expect(result.success).toBe(true);
  });

  it("rejects entitlements missing plan", () => {
    const { plan, ...rest } = entitlements;
    const result = entitlementsSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("plan");
  });

  it("rejects entitlements missing seats", () => {
    const { seats, ...rest } = entitlements;
    const result = entitlementsSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("seats");
  });

  it("rejects a negative seat count", () => {
    const result = entitlementsSchema.safeParse({ ...entitlements, seats: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO expiresAt", () => {
    const result = entitlementsSchema.safeParse({ ...entitlements, expiresAt: "30/08/2027" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = entitlementsSchema.safeParse({ ...entitlements, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });

  it("accepts limits with branch and warehouse caps", () => {
    const result = entitlementsSchema.safeParse({ ...entitlements, limits: { branches: 3, warehouses: 3 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limits).toEqual({ branches: 3, warehouses: 3 });
  });

  it("rejects a negative branches limit", () => {
    const result = entitlementsSchema.safeParse({ ...entitlements, limits: { branches: -1, warehouses: 3 } });
    expect(result.success).toBe(false);
  });

  it("accepts entitlements with no limits", () => {
    const result = entitlementsSchema.safeParse(entitlements);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limits).toBeUndefined();
  });
});

describe("licensePayloadSchema", () => {
  const payload = {
    v: 1,
    licenseId: "lic-1",
    licensee: "Acme Co",
    edition: "desktop",
    plan: "pro",
    activeModules: ["sales"],
    features: { manufacturing: false },
    seats: 10,
    issuedAt: "2026-01-01T00:00:00.000Z",
    notBefore: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    graceDays: 14,
    machineBinding: ["machine-1"],
  };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = licensePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("rejects a payload missing licenseId", () => {
    const { licenseId, ...rest } = payload;
    const result = licensePayloadSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("licenseId");
  });

  it("rejects a payload missing expiresAt", () => {
    const { expiresAt, ...rest } = payload;
    const result = licensePayloadSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("expiresAt");
  });

  it("rejects v as zero or negative — the schema version must be a positive integer", () => {
    expect(licensePayloadSchema.safeParse({ ...payload, v: 0 }).success).toBe(false);
    expect(licensePayloadSchema.safeParse({ ...payload, v: -1 }).success).toBe(false);
  });

  it("rejects a negative graceDays", () => {
    const result = licensePayloadSchema.safeParse({ ...payload, graceDays: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO issuedAt", () => {
    const result = licensePayloadSchema.safeParse({ ...payload, issuedAt: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("accepts optional supportUntil and updateChannelUntil when supplied", () => {
    const result = licensePayloadSchema.safeParse({
      ...payload,
      supportUntil: "2027-06-01T00:00:00.000Z",
      updateChannelUntil: "2027-06-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = licensePayloadSchema.safeParse({ ...payload, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
