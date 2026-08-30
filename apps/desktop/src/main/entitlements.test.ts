import { describe, it, expect, vi, afterEach } from "vitest";
import { diagnoseDesktopEntitlements, resolveDesktopEntitlements } from "./entitlements.js";

const VALID = {
  plan: "ENTERPRISE",
  activeModules: ["sales", "pos"],
  features: { "lan.multi_till": true },
  seats: 4,
  expiresAt: null,
};

function clockAt(iso: string) {
  return { now: () => Date.parse(iso) };
}

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
    const ent = resolveDesktopEntitlements({ MEZAN_ENTITLEMENTS_JSON: JSON.stringify(VALID) });
    expect(ent.plan).toBe("ENTERPRISE");
    expect(ent.seats).toBe(4);
    expect(ent.has("pos")).toBe(true);
    expect(ent.hasFeature("lan.multi_till")).toBe(true);
  });
});

/**
 * The half that was missing. Every failure below used to be a `console.warn`
 * and an app that silently did less — no message, no date, and no code an
 * owner could read down the phone.
 */
describe("diagnoseDesktopEntitlements", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports LIC-MISSING, in Arabic, when no entitlements source is configured", () => {
    const result = diagnoseDesktopEntitlements({});
    expect(result.status).toBe("missing");
    expect(result.code).toBe("LIC-MISSING");
    expect(result.detailAr).toMatch(/[؀-ۿ]/);
    expect(result.entitlements.seats).toBe(0);
  });

  it("reports LIC-MALFORMED for JSON that will not parse", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = diagnoseDesktopEntitlements({ MEZAN_ENTITLEMENTS_JSON: "{not json" });
    expect(result.code).toBe("LIC-MALFORMED");
    expect(result.entitlements.plan).toBe("UNLICENSED");
  });

  it("reports LIC-INVALID for JSON that parses but is not an entitlements payload", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = diagnoseDesktopEntitlements({
      MEZAN_ENTITLEMENTS_JSON: JSON.stringify({ plan: "ENTERPRISE" }),
    });
    expect(result.code).toBe("LIC-INVALID");
    expect(result.entitlements.plan).toBe("UNLICENSED");
  });

  it("reports LIC-OK for a current licence", () => {
    const result = diagnoseDesktopEntitlements(
      { MEZAN_ENTITLEMENTS_JSON: JSON.stringify({ ...VALID, expiresAt: "2027-01-01T00:00:00.000Z" }) },
      clockAt("2026-08-30T00:00:00.000Z"),
    );
    expect(result.status).toBe("licensed");
    expect(result.code).toBe("LIC-OK");
  });

  it("reports LIC-OK for a perpetual grant, where expiresAt is null", () => {
    const result = diagnoseDesktopEntitlements(
      { MEZAN_ENTITLEMENTS_JSON: JSON.stringify(VALID) },
      clockAt("2099-01-01T00:00:00.000Z"),
    );
    expect(result.code).toBe("LIC-OK");
  });

  it("reports LIC-EXPIRED past expiresAt", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = diagnoseDesktopEntitlements(
      { MEZAN_ENTITLEMENTS_JSON: JSON.stringify({ ...VALID, expiresAt: "2026-01-01T00:00:00.000Z" }) },
      clockAt("2026-08-30T00:00:00.000Z"),
    );
    expect(result.status).toBe("expired");
    expect(result.code).toBe("LIC-EXPIRED");
    expect(result.entitlements.expiresAt).toBe("2026-01-01T00:00:00.000Z");
  });

  // The ethic licensing/license.ts states, and the reason expiry is DIAGNOSED
  // here rather than enforced: `entitlementsSchema` carries no `graceDays`, so
  // a cutover invented here would shut a shop down on a date with no grace.
  it("does not withhold capability on an expired licence — it only says so", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = diagnoseDesktopEntitlements(
      { MEZAN_ENTITLEMENTS_JSON: JSON.stringify({ ...VALID, expiresAt: "2026-01-01T00:00:00.000Z" }) },
      clockAt("2026-08-30T00:00:00.000Z"),
    );
    expect(result.entitlements.plan).toBe("ENTERPRISE");
    expect(result.entitlements.seats).toBe(4);
    expect(result.entitlements.hasFeature("lan.multi_till")).toBe(true);
  });

  it("is still licensed at the exact instant of expiry, matching verifyLicense's `now <= expiresAt`", () => {
    const result = diagnoseDesktopEntitlements(
      { MEZAN_ENTITLEMENTS_JSON: JSON.stringify({ ...VALID, expiresAt: "2026-08-30T00:00:00.000Z" }) },
      clockAt("2026-08-30T00:00:00.000Z"),
    );
    expect(result.code).toBe("LIC-OK");
  });

  it("hands every failure a distinct code, so support can tell them apart on the phone", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const codes = [
      diagnoseDesktopEntitlements({}).code,
      diagnoseDesktopEntitlements({ MEZAN_ENTITLEMENTS_JSON: "{" }).code,
      diagnoseDesktopEntitlements({ MEZAN_ENTITLEMENTS_JSON: "{}" }).code,
    ];
    expect(new Set(codes).size).toBe(3);
  });
});
