import { describe, it, expect, beforeAll } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex, type Clock, type FingerprintSource, type LicensePayload, type MonotonicClockStore } from "@mezan/domain";
import { decideLicense, mapVerifyResult, type DecideLicenseInput } from "./license.js";

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
