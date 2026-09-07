/**
 * Offline license verification — Ed25519-signed `license.mezan` (docs/archive/plan.md
 * §2.5). Pure: crypto via `@noble/ed25519` (no native module), machine + clock
 * sources injected as ports. Verification is the ONLY place the app decides
 * whether writes are allowed; keeping it tiny and centralized is deliberate so
 * it can be hardened later.
 *
 * Ethic baked into the state machine: a licensing lapse NEVER withholds data.
 * Past `expiresAt` there is a `graceDays` window (still writable, escalating
 * banner); after grace the app is READ_ONLY — every record stays readable,
 * printable and exportable, only new postings are blocked.
 */

import { getPublicKeyAsync, signAsync, verifyAsync } from "@noble/ed25519";
import { createEntitlements, type EntitlementsView } from "../entitlements/entitlements.js";
import type { Clock, FingerprintSource, MonotonicClockStore } from "./ports.js";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToHex,
  bytesToUtf8,
  saltedFingerprintHash,
  toBytes,
  utf8ToBytes,
} from "./encoding.js";

/** License payload shape, mirroring the cloud tenant object (§2.5). */
export interface LicensePayload {
  readonly v: number;
  readonly licenseId: string;
  readonly licensee: string;
  readonly edition: string;
  readonly plan: string;
  readonly activeModules: readonly string[];
  readonly features: Readonly<Record<string, boolean>>;
  readonly seats: number;
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly graceDays: number;
  /** Salted fingerprint hashes this license is bound to (empty = unbound). */
  readonly machineBinding: readonly string[];
  readonly supportUntil?: string;
  readonly updateChannelUntil?: string;
}

export type LicenseState =
  /** Signature bad, or file malformed. Not authentic — no access. */
  | "INVALID"
  /** Authentic, but the system clock was rolled back. No access until resolved. */
  | "TAMPERED"
  /** Authentic, but `now < notBefore`. Not usable yet. */
  | "NOT_YET_VALID"
  /** Authentic, but bound to a different machine. Not usable here. */
  | "FINGERPRINT_MISMATCH"
  /** Authentic and current. Full read/write. */
  | "ACTIVE"
  /** Past expiry, within grace. Full read/write, escalating banner. */
  | "GRACE"
  /** Past grace. Read/print/export only; new postings blocked. */
  | "READ_ONLY";

export interface LicenseVerifyResult {
  readonly state: LicenseState;
  /** Authentic license the app may operate under (ACTIVE | GRACE | READ_ONLY). */
  readonly usable: boolean;
  /** Whether new postings/writes are permitted (false in READ_ONLY). */
  readonly canWrite: boolean;
  /** Entitlements, present whenever the license is authentic and time-usable. */
  readonly entitlements: EntitlementsView | null;
  readonly payload: LicensePayload | null;
  /** Machine-readable reason for a non-usable result. */
  readonly reason?: string;
  /**
   * This machine's SALTED fingerprint hash — the same value `machineBinding`
   * carries, so the check-in payload identifies the install and support can be
   * read the exact string to bind a replacement PC to. Null when the machine
   * identity could not be read. The raw identifier never appears here.
   */
  readonly fingerprint?: string | null;
}

export interface VerifyOptions {
  /** Signing public key: 32-byte Ed25519 key as hex string or raw bytes. */
  readonly publicKey: string | Uint8Array;
  readonly clock: Clock;
  readonly fingerprintSource: FingerprintSource;
  /** Salt mixed into the fingerprint hash before comparison. */
  readonly fingerprintSalt: string;
  /** Optional monotonic-clock guard store. Omit to skip the rollback check. */
  readonly monotonicStore?: MonotonicClockStore;
  /** Tolerance (ms) for benign clock jitter before flagging a rollback. */
  readonly clockRollbackToleranceMs?: number;
}

export class LicenseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseParseError";
  }
}

export interface ParsedLicense {
  readonly payload: LicensePayload;
  readonly signedBytes: Uint8Array;
  readonly signature: Uint8Array;
}

/**
 * Splits and decodes a `license.mezan` string of the form
 * `base64url(payloadJson).base64url(signature)`. The SIGNED bytes are the raw
 * payload base64url segment (as ASCII) — signing the encoded form avoids any
 * JSON re-serialization ambiguity between signer and verifier.
 */
export function parseLicense(raw: string): ParsedLicense {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    throw new LicenseParseError("Malformed license: expected '<payload>.<sig>'");
  }
  const payloadB64 = trimmed.slice(0, dot);
  const sigB64 = trimmed.slice(dot + 1);

  let payload: LicensePayload;
  try {
    payload = JSON.parse(bytesToUtf8(base64UrlToBytes(payloadB64)));
  } catch {
    throw new LicenseParseError("Malformed license: payload is not valid JSON");
  }

  let signature: Uint8Array;
  try {
    signature = base64UrlToBytes(sigB64);
  } catch {
    throw new LicenseParseError("Malformed license: signature is not base64url");
  }

  // Sign over the ASCII bytes of the encoded payload segment.
  const signedBytes = new TextEncoder().encode(payloadB64);
  return { payload, signedBytes, signature };
}

/**
 * The VENDOR half of the same format — the only thing that can mint a licence
 * `verifyLicense` will accept.
 *
 * It signs exactly the bytes the verifier checks: the ASCII of the base64url
 * payload segment. Signing the encoded form rather than the JSON is what keeps
 * signer and verifier from disagreeing over key order or whitespace, and it is
 * why this lives beside the verifier instead of in a script that would drift
 * from it.
 *
 * `privateKey` is the 32-byte Ed25519 seed (hex or raw). It belongs on the
 * vendor's machine and must never ship inside the app.
 */
export async function signLicense(
  payload: LicensePayload,
  privateKey: string | Uint8Array,
): Promise<string> {
  const payloadB64 = bytesToBase64Url(utf8ToBytes(JSON.stringify(payload)));
  const signature = await signAsync(utf8ToBytes(payloadB64), toBytes(privateKey));
  return `${payloadB64}.${bytesToBase64Url(signature)}`;
}

/**
 * The public key to bake into builds for a given signing seed — what the vendor
 * sets as `MEZAN_LICENSE_PUBLIC_KEY`. Hex, both ways in and out.
 */
export async function licensePublicKeyHex(privateKey: string | Uint8Array): Promise<string> {
  return bytesToHex(await getPublicKeyAsync(toBytes(privateKey)));
}

function fail(
  state: LicenseState,
  reason: string,
  fingerprint: string | null = null,
): LicenseVerifyResult {
  return {
    state,
    usable: false,
    canWrite: false,
    entitlements: null,
    payload: null,
    reason,
    fingerprint,
  };
}

/**
 * Verifies a license end to end: signature → monotonic-clock guard → notBefore
 * → machine fingerprint → expiry/grace. Returns the resolved `LicenseState` and
 * whether writes are permitted.
 */
export async function verifyLicense(
  raw: string,
  options: VerifyOptions,
): Promise<LicenseVerifyResult> {
  // Read once, up front, and carry it into every branch: the check-in payload
  // has to identify THIS machine even when the licence is invalid, and support
  // has to be able to read the string back for a replacement PC.
  let fingerprint: string | null;
  try {
    fingerprint = await saltedFingerprintHash(
      await options.fingerprintSource.read(),
      options.fingerprintSalt,
    );
  } catch {
    fingerprint = null;
  }

  let parsed: ParsedLicense;
  try {
    parsed = parseLicense(raw);
  } catch (err) {
    return fail("INVALID", err instanceof Error ? err.message : "parse error", fingerprint);
  }

  // 1. Signature authenticity.
  let signatureOk: boolean;
  try {
    signatureOk = await verifyAsync(
      parsed.signature,
      parsed.signedBytes,
      toBytes(options.publicKey),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return fail("INVALID", "BAD_SIGNATURE", fingerprint);

  const { payload } = parsed;
  const now = options.clock.now();

  // 2. Monotonic-clock guard (rollback detection).
  if (options.monotonicStore) {
    const highWater = await options.monotonicStore.getHighWaterMark();
    const tolerance = options.clockRollbackToleranceMs ?? 0;
    if (highWater !== null && now < highWater - tolerance) {
      return fail("TAMPERED", "CLOCK_ROLLBACK", fingerprint);
    }
    await options.monotonicStore.record(Math.max(now, highWater ?? now));
  }

  // 3. notBefore.
  const notBefore = Date.parse(payload.notBefore);
  if (!Number.isNaN(notBefore) && now < notBefore) {
    return fail("NOT_YET_VALID", "BEFORE_NOT_BEFORE", fingerprint);
  }

  // 4. Machine fingerprint (soft-bound: empty binding = unbound license).
  if (payload.machineBinding.length > 0) {
    if (fingerprint === null || !payload.machineBinding.includes(fingerprint)) {
      return fail("FINGERPRINT_MISMATCH", "MACHINE_NOT_BOUND", fingerprint);
    }
  }

  // 5. Expiry / grace / read-only.
  const entitlements = createEntitlements({
    plan: payload.plan,
    activeModules: payload.activeModules,
    features: payload.features,
    seats: payload.seats,
    expiresAt: payload.expiresAt,
  });
  const expiresAt = Date.parse(payload.expiresAt);
  const graceEnd = expiresAt + payload.graceDays * 86_400_000;

  if (Number.isNaN(expiresAt) || now <= expiresAt) {
    return {
      state: "ACTIVE",
      usable: true,
      canWrite: true,
      entitlements,
      payload,
      fingerprint,
    };
  }
  if (now <= graceEnd) {
    return {
      state: "GRACE",
      usable: true,
      canWrite: true,
      entitlements,
      payload,
      fingerprint,
    };
  }
  return {
    state: "READ_ONLY",
    usable: true,
    canWrite: false,
    entitlements,
    payload,
    reason: "EXPIRED_PAST_GRACE",
    fingerprint,
  };
}
