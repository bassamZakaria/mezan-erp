import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveDesktopEntitlements } from "./entitlements.js";

describe("resolveDesktopEntitlements", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to unlicensed (zero seats, no LAN flag) when the env var is unset", () => {
    const ent = resolveDesktopEntitlements({});
    expect(ent.plan).toBe("UNLICENSED");
    expect(ent.seats).toBe(0);
    expect(ent.hasFeature("lan.multi_till")).toBe(false);
  });

  it("falls back to unlicensed on malformed JSON, without throwing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ent = resolveDesktopEntitlements({ MEZAN_ENTITLEMENTS_JSON: "{not json" });
    expect(ent.plan).toBe("UNLICENSED");
  });

  it("falls back to unlicensed when the JSON fails schema validation", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ent = resolveDesktopEntitlements({
      MEZAN_ENTITLEMENTS_JSON: JSON.stringify({ plan: "ENTERPRISE" /* missing required fields */ }),
    });
    expect(ent.plan).toBe("UNLICENSED");
  });

  it("resolves a real EntitlementsView from a valid entitlements JSON blob", () => {
    const ent = resolveDesktopEntitlements({
      MEZAN_ENTITLEMENTS_JSON: JSON.stringify({
        plan: "ENTERPRISE",
        activeModules: ["sales", "pos"],
        features: { "lan.multi_till": true },
        seats: 4,
        expiresAt: null,
      }),
    });
    expect(ent.plan).toBe("ENTERPRISE");
    expect(ent.seats).toBe(4);
    expect(ent.has("pos")).toBe(true);
    expect(ent.hasFeature("lan.multi_till")).toBe(true);
  });
});
