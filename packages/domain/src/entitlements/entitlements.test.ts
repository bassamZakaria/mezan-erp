import { describe, it, expect } from "vitest";
import { createEntitlements, hasModule, hasFeature } from "./index.js";

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
});
