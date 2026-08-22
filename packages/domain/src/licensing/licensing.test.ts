import { describe, it, expect, beforeAll } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import {
  verifyLicense,
  parseLicense,
  LicenseParseError,
  saltedFingerprintHash,
  bytesToHex,
  type LicensePayload,
  type Clock,
  type FingerprintSource,
  type MonotonicClockStore,
} from "./index.js";

const DAY = 86_400_000;
const SALT = "mezan-fp-salt-v1";
const RAW_MACHINE = "IOPlatformUUID-ABC-123";

let secretKey: Uint8Array;
let publicKeyHex: string;
let boundHash: string;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

async function makeLicense(
  overrides: Partial<LicensePayload> = {},
  key: Uint8Array = secretKey,
): Promise<string> {
  const payload: LicensePayload = {
    v: 1,
    licenseId: "lic-1",
    licensee: "النور للتجارة والتوزيع",
    edition: "desktop",
    plan: "ENTERPRISE",
    activeModules: ["sales", "purchases", "inventory", "accounting", "pos"],
    features: { "pos.restaurant_mode": true },
    seats: 5,
    issuedAt: "2026-01-01T00:00:00.000Z",
    notBefore: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    graceDays: 14,
    machineBinding: [boundHash],
    ...overrides,
  };
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const sig = await signAsync(new TextEncoder().encode(payloadB64), key);
  return `${payloadB64}.${bytesToBase64Url(sig)}`;
}

const clockAt = (iso: string): Clock => ({ now: () => Date.parse(iso) });
const fingerprint: FingerprintSource = { read: async () => RAW_MACHINE };

beforeAll(async () => {
  secretKey = new Uint8Array(32).fill(7);
  const pub = await getPublicKeyAsync(secretKey);
  publicKeyHex = bytesToHex(pub);
  boundHash = await saltedFingerprintHash(RAW_MACHINE, SALT);
});

const baseOpts = () => ({
  publicKey: publicKeyHex,
  fingerprintSource: fingerprint,
  fingerprintSalt: SALT,
});

describe("license parsing", () => {
  it("rejects malformed input", () => {
    expect(() => parseLicense("no-dot-here")).toThrow(LicenseParseError);
    expect(() => parseLicense("")).toThrow(LicenseParseError);
  });
});

describe("signature verification", () => {
  it("accepts a valid signature (ACTIVE)", async () => {
    const lic = await makeLicense();
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
    });
    expect(res.state).toBe("ACTIVE");
    expect(res.usable).toBe(true);
    expect(res.canWrite).toBe(true);
    expect(res.entitlements?.has("pos")).toBe(true);
    expect(res.entitlements?.hasFeature("pos.restaurant_mode")).toBe(true);
  });

  it("rejects a signature made with a different key (INVALID)", async () => {
    const otherKey = new Uint8Array(32).fill(9);
    const lic = await makeLicense({}, otherKey);
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
    });
    expect(res.state).toBe("INVALID");
    expect(res.reason).toBe("BAD_SIGNATURE");
    expect(res.entitlements).toBeNull();
  });

  it("rejects a tampered payload (INVALID)", async () => {
    const lic = await makeLicense();
    const [payloadB64, sig] = lic.split(".");
    // Re-encode a payload with escalated seats but keep the original signature.
    const forged = stringToBase64Url(
      JSON.stringify({ ...JSON.parse(atob(payloadB64!.replace(/-/g, "+").replace(/_/g, "/"))), seats: 999 }),
    );
    const res = await verifyLicense(`${forged}.${sig}`, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
    });
    expect(res.state).toBe("INVALID");
  });
});

describe("expiry -> grace -> read-only", () => {
  it("is ACTIVE before expiry", async () => {
    const lic = await makeLicense();
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-12-31T00:00:00.000Z"),
    });
    expect(res.state).toBe("ACTIVE");
    expect(res.canWrite).toBe(true);
  });

  it("is GRACE just after expiry, still writable", async () => {
    const lic = await makeLicense();
    const withinGrace = new Date(Date.parse("2027-01-01T00:00:00.000Z") + 5 * DAY).toISOString();
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: { now: () => Date.parse(withinGrace) },
    });
    expect(res.state).toBe("GRACE");
    expect(res.usable).toBe(true);
    expect(res.canWrite).toBe(true);
  });

  it("is READ_ONLY past grace — data still readable, writes blocked", async () => {
    const lic = await makeLicense();
    const pastGrace = new Date(Date.parse("2027-01-01T00:00:00.000Z") + 20 * DAY).toISOString();
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: { now: () => Date.parse(pastGrace) },
    });
    expect(res.state).toBe("READ_ONLY");
    expect(res.usable).toBe(true);
    expect(res.canWrite).toBe(false);
    // Entitlements remain available so records stay readable/exportable.
    expect(res.entitlements?.has("sales")).toBe(true);
  });
});

describe("notBefore", () => {
  it("is NOT_YET_VALID before notBefore", async () => {
    const lic = await makeLicense({ notBefore: "2026-06-01T00:00:00.000Z" });
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-03-01T00:00:00.000Z"),
    });
    expect(res.state).toBe("NOT_YET_VALID");
    expect(res.usable).toBe(false);
  });
});

describe("machine fingerprint", () => {
  it("passes when the fingerprint matches the binding", async () => {
    const lic = await makeLicense();
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
    });
    expect(res.state).toBe("ACTIVE");
  });

  it("fails when bound to a different machine", async () => {
    const lic = await makeLicense({ machineBinding: ["some-other-hash"] });
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
    });
    expect(res.state).toBe("FINGERPRINT_MISMATCH");
    expect(res.usable).toBe(false);
  });

  it("treats an empty binding as unbound (any machine)", async () => {
    const lic = await makeLicense({ machineBinding: [] });
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
    });
    expect(res.state).toBe("ACTIVE");
  });
});

describe("monotonic-clock guard", () => {
  function memStore(initial: number | null): MonotonicClockStore {
    let hw = initial;
    return {
      getHighWaterMark: async () => hw,
      record: async (ms) => {
        hw = ms;
      },
    };
  }

  it("flags TAMPERED when the clock rolls back below the high-water mark", async () => {
    const lic = await makeLicense();
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
      monotonicStore: memStore(Date.parse("2026-09-01T00:00:00.000Z")),
    });
    expect(res.state).toBe("TAMPERED");
    expect(res.reason).toBe("CLOCK_ROLLBACK");
  });

  it("allows forward time and advances the high-water mark", async () => {
    const lic = await makeLicense();
    const store = memStore(Date.parse("2026-05-01T00:00:00.000Z"));
    const res = await verifyLicense(lic, {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
      monotonicStore: store,
    });
    expect(res.state).toBe("ACTIVE");
    expect(await store.getHighWaterMark()).toBe(
      Date.parse("2026-06-01T00:00:00.000Z"),
    );
  });
});
