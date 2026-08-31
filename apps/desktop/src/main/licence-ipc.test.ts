import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionGrant, SessionRegistry } from "@mezan/api";
import { createEntitlements } from "@mezan/domain";
import {
  MEZAN_LICENCE_STATUS_CHANNEL,
  type LicenceStatusResult,
} from "../shared/ipc-contract.js";
import type { DesktopEntitlementsDiagnosis } from "./entitlements.js";
import type { LanHostHandle } from "./lan-host.js";

/**
 * The only path by which a licence failure or the LAN address reaches a screen.
 * Both facts live in the main process — the diagnosis is made before the
 * backend exists, and the bound address lives on the `LanHostHandle` — so if
 * this channel gets it wrong there is no second source to correct it.
 */
type Handler = (event: unknown, ...args: unknown[]) => LicenceStatusResult;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));

const { registerLicenceStatusOverIpc } = await import("./licence-ipc.js");

const GRANT: SessionGrant = {
  userId: "USER-ADMIN",
  permissions: ["*"],
  roleCode: null,
  branchScope: "*",
  warehouseScope: "*",
};

function fakeSessions(): SessionRegistry {
  return {
    issue: () => "unused",
    find: (token: string) => (token === "good-token" ? GRANT : null),
    inspect: (token: string) => ({ grant: token === "good-token" ? GRANT : null, refusal: null }),
    revoke: () => {},
    revokeUser: () => {},
  };
}

function diagnosisOf(
  status: DesktopEntitlementsDiagnosis["status"],
  code: DesktopEntitlementsDiagnosis["code"],
  expiresAt: string | null = null,
): DesktopEntitlementsDiagnosis {
  return {
    status,
    code,
    detailAr: "رسالة بالعربية",
    entitlements: createEntitlements({
      plan: status === "licensed" || status === "expired" ? "ENTERPRISE" : "UNLICENSED",
      activeModules: [],
      features: {},
      seats: status === "licensed" || status === "expired" ? 3 : 0,
      expiresAt,
    }),
  };
}

function lanHandle(overrides: Partial<LanHostHandle>): LanHostHandle {
  return {
    enabled: true,
    ready: Promise.resolve(null),
    address: () => ({ address: "192.168.1.7", family: "IPv4", port: 4173 }),
    url: () => "https://192.168.1.7:4173",
    fingerprint: () => "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    close: async () => {},
    ...overrides,
  };
}

function call(token: unknown): LicenceStatusResult {
  const handler = handlers.get(MEZAN_LICENCE_STATUS_CHANNEL);
  if (!handler) throw new Error("channel not registered");
  return handler(null, token);
}

describe("registerLicenceStatusOverIpc", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("refuses a caller with no session, rather than reporting the shop's address to it", () => {
    registerLicenceStatusOverIpc({
      diagnosis: () => diagnosisOf("licensed", "LIC-OK"),
      lanHost: () => lanHandle({}),
      sessions: fakeSessions(),
    });

    for (const token of [undefined, "", "wrong-token", 42]) {
      const result = call(token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("reports the diagnosis code and its Arabic message to a signed-in caller", () => {
    registerLicenceStatusOverIpc({
      diagnosis: () => diagnosisOf("expired", "LIC-EXPIRED", "2026-01-01T00:00:00.000Z"),
      lanHost: () => lanHandle({}),
      sessions: fakeSessions(),
    });

    const result = call("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe("LIC-EXPIRED");
    expect(result.messageAr).toBe("رسالة بالعربية");
    expect(result.expiresAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.seats).toBe(3);
    expect(result.lan.url).toBe("https://192.168.1.7:4173");
    // The value a till pins. It reaches the screen only through this channel —
    // there is no route that reports it, and no second source to correct it.
    expect(result.lan.fingerprintSha256).toBe(
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    );
  });

  // The whole point of the null: a screen told "unknown" says unknown, and a
  // screen handed a plausible address prints one no till can reach.
  it("reports a null address — never a guess — while the socket is not yet bound", () => {
    registerLicenceStatusOverIpc({
      diagnosis: () => diagnosisOf("licensed", "LIC-OK"),
      lanHost: () => lanHandle({ address: () => null, url: () => null, fingerprint: () => null }),
      sessions: fakeSessions(),
    });

    const result = call("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lan.listening).toBe(false);
    expect(result.lan.url).toBeNull();
    expect(result.lan.fingerprintSha256).toBeNull();
  });

  it("reports not-listening when LAN mode is off, and no address with it", () => {
    registerLicenceStatusOverIpc({
      diagnosis: () => diagnosisOf("missing", "LIC-MISSING"),
      lanHost: () =>
        lanHandle({ enabled: false, address: () => null, url: () => null, fingerprint: () => null }),
      sessions: fakeSessions(),
    });

    const result = call("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe("LIC-MISSING");
    expect(result.lan.listening).toBe(false);
    expect(result.lan.url).toBeNull();
  });

  it("survives a LAN host that has not been started yet", () => {
    registerLicenceStatusOverIpc({
      diagnosis: () => diagnosisOf("licensed", "LIC-OK"),
      lanHost: () => undefined,
      sessions: fakeSessions(),
    });

    const result = call("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lan).toEqual({ listening: false, url: null, fingerprintSha256: null });
  });

  it("answers UNAVAILABLE, in Arabic, rather than rejecting across the bridge", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerLicenceStatusOverIpc({
      diagnosis: () => {
        throw new Error("boom");
      },
      lanHost: () => lanHandle({}),
      sessions: fakeSessions(),
    });

    const result = call("good-token");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNAVAILABLE");
    expect(result.message).toMatch(/[؀-ۿ]/);
  });
});
