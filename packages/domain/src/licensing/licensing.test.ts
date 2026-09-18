import { describe, it, expect, beforeAll } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import {
  checkinSignedBytes,
  signCheckinResponse,
  signLicense,
  verifyCheckinResponse,
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

/**
 * guards L-2: the vendor half did not exist. `@noble/ed25519` was imported for
 * `verifyAsync` alone, so nothing in the repository could mint a licence the
 * verifier would accept — there was no sales-to-activation path at all.
 */
describe("signLicense — the vendor half", () => {
  it("produces a licence its own verifier accepts", async () => {
    const payload: LicensePayload = {
      v: 1,
      licenseId: "lic-issued",
      licensee: "صيدلية الشفاء",
      edition: "desktop",
      plan: "CORE",
      activeModules: ["sales", "inventory"],
      features: {},
      seats: 2,
      issuedAt: "2026-01-01T00:00:00.000Z",
      notBefore: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      graceDays: 14,
      machineBinding: [boundHash],
    };
    const raw = await signLicense(payload, secretKey);
    const result = await verifyLicense(raw, { ...baseOpts(), clock: clockAt("2026-06-01T00:00:00.000Z") });

    expect(result.state).toBe("ACTIVE");
    expect(result.payload?.licenseId).toBe("lic-issued");
    expect(result.entitlements?.has("inventory")).toBe(true);
  });

  it("is rejected when signed with anyone else's key", async () => {
    const payload = parseLicense(await makeLicense()).payload;
    const raw = await signLicense(payload, new Uint8Array(32).fill(2));
    const result = await verifyLicense(raw, { ...baseOpts(), clock: clockAt("2026-06-01T00:00:00.000Z") });
    expect(result.state).toBe("INVALID");
    expect(result.reason).toBe("BAD_SIGNATURE");
  });

  /**
   * `scripts/licence-issue.mjs` signs with `node:crypto` so the vendor tools
   * need no dependency tree. That is only safe if the two implementations agree
   * on the canonical bytes byte for byte — which is what this proves, by
   * verifying the CLI's real output with the real verifier.
   */
  it("agrees byte for byte with the node:crypto CLI", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { execFileSync } = await import("node:child_process");
    const nodePath = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const dir = await mkdtemp(nodePath.join(tmpdir(), "mezan-issue-"));
    try {
      const out = nodePath.join(dir, "license.mezan");
      execFileSync(
        process.execPath,
        [
          nodePath.join(repoRoot, "scripts", "licence-issue.mjs"),
          "--licensee", "النور للتجارة",
          "--plan", "CORE",
          "--modules", "sales,inventory",
          "--seats", "2",
          "--expires", "2027-01-01",
          "--not-before", "2026-01-01",
          "--bind", boundHash,
          "--out", out,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, MEZAN_LICENSE_PRIVATE_KEY: bytesToHex(secretKey) },
        },
      );
      const raw = await readFile(out, "utf8");
      const result = await verifyLicense(raw, {
        ...baseOpts(),
        clock: clockAt("2026-06-01T00:00:00.000Z"),
      });
      expect(result.state).toBe("ACTIVE");
      expect(result.payload?.licensee).toBe("النور للتجارة");
      expect(result.payload?.machineBinding).toEqual([boundHash]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** guards L-4: the check-in reply used to be unsigned JSON over unpinned TLS. */
describe("the signed check-in answer", () => {
  const claim = {
    licenseId: "lic-1",
    fingerprint: "fp-1",
    revoked: false,
    serverTime: "2026-09-10T00:00:00.000Z",
  };

  it("verifies a genuine answer", async () => {
    const signature = await signCheckinResponse(claim, secretKey);
    expect(await verifyCheckinResponse(claim, signature, publicKeyHex)).toBe(true);
  });

  it("does not verify once any bound field changes", async () => {
    const signature = await signCheckinResponse(claim, secretKey);
    for (const tampered of [
      { ...claim, revoked: true },
      { ...claim, licenseId: "lic-2" },
      { ...claim, fingerprint: "fp-2" },
      { ...claim, serverTime: "2026-09-11T00:00:00.000Z" },
    ]) {
      expect(await verifyCheckinResponse(tampered, signature, publicKeyHex)).toBe(false);
    }
  });

  it("refuses a field carrying the separator, which could forge a second claim", () => {
    expect(() => checkinSignedBytes({ ...claim, licenseId: "a|b" })).toThrow();
  });
});

/** guards L-3, L-4: the salted fingerprint has to reach the caller. */
describe("the verify result carries this machine's fingerprint", () => {
  it("reports it even when the licence is not authentic", async () => {
    const result = await verifyLicense("not-a-licence", {
      ...baseOpts(),
      clock: clockAt("2026-06-01T00:00:00.000Z"),
    });
    expect(result.state).toBe("INVALID");
    expect(result.fingerprint).toBe(boundHash);
    // The raw machine identity never leaves the hashing function.
    expect(result.fingerprint).not.toContain(RAW_MACHINE);
  });
});
