import { describe, it, expect, beforeAll } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex, saltedFingerprintHash, type Clock, type FingerprintSource, type LicensePayload, type MonotonicClockStore } from "@mezan/domain";
import {
  decideLicense,
  mapVerifyResult,
  NO_PUBLIC_KEY_MESSAGE_AR,
  reevaluateLicenseState,
  type DecideLicenseInput,
} from "./license.js";

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let secretKey: Uint8Array;
let publicKeyHex: string;

const clockAt = (iso: string): Clock => ({ now: () => Date.parse(iso) });
const fingerprint: FingerprintSource = { read: async () => "RAW-MACHINE" };
const memStore = (): MonotonicClockStore => {
  let hw: number | null = null;
  return {
    getHighWaterMark: async () => hw,
    record: async (v) => {
      hw = v;
    },
  };
};

async function signLicense(overrides: Partial<LicensePayload> = {}): Promise<string> {
  const payload: LicensePayload = {
    v: 1,
    licenseId: "lic-1",
    licensee: "النور للتجارة",
    edition: "desktop",
    plan: "ENTERPRISE",
    activeModules: ["sales", "inventory"],
    features: {},
    seats: 5,
    issuedAt: "2026-01-01T00:00:00.000Z",
    notBefore: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    graceDays: 14,
    machineBinding: [], // unbound — fingerprint irrelevant for these branches
    ...overrides,
  };
  const payloadB64 = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await signAsync(new TextEncoder().encode(payloadB64), secretKey);
  return `${payloadB64}.${base64Url(sig)}`;
}

function baseInput(over: Partial<DecideLicenseInput>): DecideLicenseInput {
  return {
    licenseRaw: null,
    publicKey: publicKeyHex,
    fingerprintSalt: "salt",
    packaged: true,
    devEntitlements: null,
    clock: clockAt("2026-06-01T00:00:00.000Z"),
    fingerprintSource: fingerprint,
    monotonicStore: memStore(),
    ...over,
  };
}

beforeAll(async () => {
  secretKey = new Uint8Array(32).fill(7);
  publicKeyHex = bytesToHex(await getPublicKeyAsync(secretKey));
});

describe("decideLicense", () => {
  it("packaged build with NO license fails closed — unlicensed, read-only", async () => {
    const r = await decideLicense(baseInput({ packaged: true, licenseRaw: null }));
    expect(r.state.state).toBe("UNLICENSED");
    expect(r.state.canWrite).toBe(false);
    expect(r.state.usable).toBe(true); // data still viewable
    expect(r.entitlements.plan).toBe("UNLICENSED");
  });

  it("dev build with nothing configured stays writable so first-run works", async () => {
    const r = await decideLicense(baseInput({ packaged: false, licenseRaw: null }));
    expect(r.state.canWrite).toBe(true);
  });

  it("a license present but NO public key configured fails closed (cannot verify)", async () => {
    const raw = await signLicense();
    const r = await decideLicense(baseInput({ licenseRaw: raw, publicKey: null }));
    expect(r.state.state).toBe("UNLICENSED");
    expect(r.state.reason).toBe("NO_PUBLIC_KEY");
    expect(r.state.canWrite).toBe(false);
  });

  it("a valid, current license is ACTIVE and writable, with its entitlements", async () => {
    const raw = await signLicense();
    const r = await decideLicense(baseInput({ licenseRaw: raw }));
    expect(r.state.state).toBe("ACTIVE");
    expect(r.state.canWrite).toBe(true);
    expect(r.state.licensee).toBe("النور للتجارة");
    expect(r.entitlements.plan).toBe("ENTERPRISE");
    expect(r.entitlements.has("sales")).toBe(true);
  });

  it("a license past expiry AND past grace resolves to READ_ONLY — viewable, not writable", async () => {
    const raw = await signLicense({ expiresAt: "2026-02-01T00:00:00.000Z", graceDays: 14 });
    const r = await decideLicense(baseInput({ licenseRaw: raw, clock: clockAt("2026-06-01T00:00:00.000Z") }));
    expect(r.state.state).toBe("READ_ONLY");
    expect(r.state.canWrite).toBe(false);
    expect(r.state.usable).toBe(true);
  });

  it("a tampered signature is not authentic — not writable", async () => {
    const raw = await signLicense();
    const tampered = `${raw.slice(0, -4)}AAAA`;
    const r = await decideLicense(baseInput({ licenseRaw: tampered }));
    expect(r.state.canWrite).toBe(false);
    expect(r.state.state).toBe("INVALID");
  });
});

describe("mapVerifyResult", () => {
  it("exposes graceEndsAt while in GRACE", async () => {
    const raw = await signLicense({ expiresAt: "2026-05-25T00:00:00.000Z", graceDays: 10 });
    const r = await decideLicense(baseInput({ licenseRaw: raw, clock: clockAt("2026-05-30T00:00:00.000Z") }));
    expect(r.state.state).toBe("GRACE");
    expect(r.state.canWrite).toBe(true);
    expect(r.state.graceEndsAt).toBe("2026-06-04T00:00:00.000Z");
  });
});

/** guards L-1 */
describe("a build with no vendor key blames the build, not the shop", () => {
  it("carries its own Arabic message, distinct from «no licence»", async () => {
    const raw = await signLicense();
    const withKey = await decideLicense(baseInput({ licenseRaw: null, packaged: true }));
    const withoutKey = await decideLicense(baseInput({ licenseRaw: raw, publicKey: null }));

    expect(withoutKey.state.reason).toBe("NO_PUBLIC_KEY");
    expect(withoutKey.state.messageAr).toBe(NO_PUBLIC_KEY_MESSAGE_AR);
    expect(withoutKey.state.messageAr).toMatch(/[؀-ۿ]/);
    // The unlicensed state must NOT borrow it: the two sentences send the owner
    // to two different places.
    expect(withKey.state.messageAr).toBeUndefined();
  });
});

/** guards L-3, L-4 */
describe("the licence's identity reaches the check-in", () => {
  it("exposes payload.licenseId, notBefore and the salted fingerprint", async () => {
    const raw = await signLicense({ licenseId: "lic-77", notBefore: "2026-01-05T00:00:00.000Z" });
    const r = await decideLicense(baseInput({ licenseRaw: raw }));
    expect(r.verified).toBe(true);
    expect(r.identity.licenseId).toBe("lic-77");
    expect(r.identity.notBefore).toBe("2026-01-05T00:00:00.000Z");
    // The SALTED hash of "RAW-MACHINE" under salt "salt" — never the raw id.
    expect(r.identity.fingerprint).toBe(await saltedFingerprintHash("RAW-MACHINE", "salt"));
    expect(r.identity.fingerprint).not.toContain("RAW-MACHINE");
  });

  it("is not verified for a dev build, so nothing is module-gated by an absence", async () => {
    const r = await decideLicense(baseInput({ packaged: false, licenseRaw: null }));
    expect(r.verified).toBe(false);
  });
});

/** guards L-3, L-7 */
describe("reevaluateLicenseState", () => {
  const ok = { verdict: "ok" as const, daysSince: 0, blocking: false };

  it("notices an expiry that happens mid-session, without a restart", async () => {
    const raw = await signLicense({ expiresAt: "2026-06-02T00:00:00.000Z", graceDays: 0 });
    const base = await decideLicense(
      baseInput({ licenseRaw: raw, clock: clockAt("2026-06-01T00:00:00.000Z") }),
    );
    expect(base.state.state).toBe("ACTIVE");

    const later = reevaluateLicenseState(base, {
      now: Date.parse("2026-06-03T00:00:00.000Z"),
      checkin: ok,
    });
    expect(later.state).toBe("READ_ONLY");
    expect(later.canWrite).toBe(false);
    expect(later.usable).toBe(true);
  });

  it("lifts read-only the moment a check-in succeeds — no restart", async () => {
    const raw = await signLicense();
    const base = await decideLicense(baseInput({ licenseRaw: raw }));

    const overdue = reevaluateLicenseState(base, {
      now: Date.parse("2026-06-01T00:00:00.000Z"),
      checkin: { verdict: "read-only", daysSince: 12, blocking: false },
    });
    expect(overdue.canWrite).toBe(false);
    expect(overdue.reason).toBe("CHECKIN_OVERDUE");
    expect(overdue.daysSince).toBe(12);

    const cleared = reevaluateLicenseState(base, {
      now: Date.parse("2026-06-01T00:00:00.000Z"),
      checkin: ok,
    });
    expect(cleared.canWrite).toBe(true);
  });

  it("asks for a blocking notice past thirty days, and still leaves the data usable", async () => {
    const raw = await signLicense();
    const base = await decideLicense(baseInput({ licenseRaw: raw }));
    const blocked = reevaluateLicenseState(base, {
      now: Date.parse("2026-06-01T00:00:00.000Z"),
      checkin: { verdict: "blocked", daysSince: 44, blocking: true },
    });
    expect(blocked.state).toBe("READ_ONLY");
    expect(blocked.blocking).toBe(true);
    expect(blocked.usable).toBe(true);
    expect(blocked.messageAr).toMatch(/[؀-ۿ]/);
  });

  it("enforces a revocation as READ_ONLY with its own reason", async () => {
    const raw = await signLicense();
    const base = await decideLicense(baseInput({ licenseRaw: raw }));
    const revoked = reevaluateLicenseState(base, {
      now: Date.parse("2026-06-01T00:00:00.000Z"),
      checkin: { verdict: "revoked", daysSince: 0, blocking: true },
    });
    expect(revoked.state).toBe("REVOKED");
    expect(revoked.reason).toBe("REVOKED");
    expect(revoked.canWrite).toBe(false);
    expect(revoked.usable).toBe(true);
  });

  /**
   * "Your check-in is overdue" is the wrong answer to "you never had a
   * licence": the shop needs to be told to install one, not to go online.
   */
  it("does not fold a check-in verdict into an install that has no licence", async () => {
    const base = await decideLicense(baseInput({ packaged: true, licenseRaw: null }));
    const state = reevaluateLicenseState(base, {
      now: Date.parse("2026-06-01T00:00:00.000Z"),
      checkin: { verdict: "blocked", daysSince: 99, blocking: true },
    });
    expect(state.state).toBe("UNLICENSED");
    expect(state.reason).toBe("NO_LICENSE");
  });
});
