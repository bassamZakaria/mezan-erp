import { describe, it, expect } from "vitest";
import { createEntitlements, hasModule, hasFeature, UNLICENSED_ENTITLEMENTS } from "./index.js";

const ent = createEntitlements({
  plan: "ENTERPRISE",
  activeModules: ["sales", "purchases", "inventory", "accounting", "pos"],
  features: {
    "pos.restaurant_mode": true,
    "accounting.multi_currency": true,
    "hr.attendance_biometric": false,
  },
  seats: 10,
  expiresAt: "2027-01-01T00:00:00.000Z",
});

describe("entitlements", () => {
  it("has(module) reflects activeModules", () => {
    expect(ent.has("sales")).toBe(true);
    expect(ent.has("whatsapp")).toBe(false);
    expect(hasModule(ent, "pos")).toBe(true);
  });

  it("hasFeature(flag) reflects the features map (true only when explicitly true)", () => {
    expect(ent.hasFeature("pos.restaurant_mode")).toBe(true);
    expect(ent.hasFeature("hr.attendance_biometric")).toBe(false);
    expect(ent.hasFeature("not.configured")).toBe(false);
    expect(hasFeature(ent, "accounting.multi_currency")).toBe(true);
  });

  it("exposes the raw fields", () => {
    expect(ent.plan).toBe("ENTERPRISE");
    expect(ent.seats).toBe(10);
    expect(ent.expiresAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("preserves limits when given", () => {
    const withLimits = createEntitlements({
      plan: "core", activeModules: [], features: {}, seats: 1, expiresAt: null,
      limits: { branches: 3, warehouses: 3 },
    });
    expect(withLimits.limits).toEqual({ branches: 3, warehouses: 3 });
  });

  it("leaves limits undefined when not given", () => {
    expect(ent.limits).toBeUndefined();
  });
});

describe("UNLICENSED_ENTITLEMENTS", () => {
  it("has plan UNLICENSED, no modules, no features, 0 seats, no expiry, no limits", () => {
    expect(UNLICENSED_ENTITLEMENTS.plan).toBe("UNLICENSED");
    expect(UNLICENSED_ENTITLEMENTS.activeModules).toEqual([]);
    expect(UNLICENSED_ENTITLEMENTS.features).toEqual({});
    expect(UNLICENSED_ENTITLEMENTS.seats).toBe(0);
    expect(UNLICENSED_ENTITLEMENTS.expiresAt).toBeNull();
    expect(UNLICENSED_ENTITLEMENTS.limits).toBeUndefined();
  });
});
