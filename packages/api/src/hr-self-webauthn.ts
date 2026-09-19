import { createHash, createPublicKey, randomBytes, verify as verifySignature, type KeyObject } from "node:crypto";

/**
 * The server half of WebAuthn for the web clock (D289). Registration takes the
 * SubjectPublicKeyInfo the browser exposes through
 * `AuthenticatorAttestationResponse.getPublicKey()` (attestation "none"), so no
 * CBOR/COSE parsing is needed; an assertion is checked against it with
 * node:crypto. Only ES256 (-7) and RS256 (-257) are accepted.
 */

export const WEBAUTHN_ALGORITHMS: readonly number[] = [-7, -257];
export const CHALLENGE_TTL_MS = 120_000;

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/=+$/, ""), "base64url");
}

export function newChallenge(): string {
  return toBase64Url(randomBytes(32));
}

export interface ClientDataCheck {
  readonly type: "webauthn.create" | "webauthn.get";
  readonly challenge: string;
  readonly origin: string;
}

export interface AuthenticatorDataReading {
  readonly rpIdHash: Buffer;
  readonly flags: number;
  readonly signCount: number;
}

export function readAuthenticatorData(authenticatorData: Buffer): AuthenticatorDataReading | null {
  if (authenticatorData.length < 37) return null;
  return {
    rpIdHash: authenticatorData.subarray(0, 32),
    flags: authenticatorData[32] ?? 0,
    signCount: authenticatorData.readUInt32BE(33),
  };
}

function sha256(data: Uint8Array | string): Buffer {
  return createHash("sha256").update(data).digest();
}

/** True when the client data names this ceremony, this challenge and this origin. */
export function clientDataMatches(clientDataJSON: Buffer, expected: ClientDataCheck): boolean {
  let parsed: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    parsed = JSON.parse(clientDataJSON.toString("utf8")) as typeof parsed;
  } catch {
    return false;
  }
  if (parsed.type !== expected.type) return false;
  if (typeof parsed.challenge !== "string" || parsed.challenge.replace(/=+$/, "") !== expected.challenge) return false;
  return parsed.origin === expected.origin;
}

/** The authenticator must be bound to this relying party and must have verified the user (fingerprint, face or device PIN). */
export function authenticatorDataAcceptable(reading: AuthenticatorDataReading, rpId: string): boolean {
  if (!reading.rpIdHash.equals(sha256(rpId))) return false;
  return (reading.flags & FLAG_USER_PRESENT) !== 0 && (reading.flags & FLAG_USER_VERIFIED) !== 0;
}

export function importPublicKey(spkiBase64Url: string): KeyObject | null {
  try {
    return createPublicKey({ key: fromBase64Url(spkiBase64Url), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

export function assertionSignatureValid(
  publicKey: KeyObject,
  algorithm: number,
  authenticatorData: Buffer,
  clientDataJSON: Buffer,
  signature: Buffer,
): boolean {
  if (!WEBAUTHN_ALGORITHMS.includes(algorithm)) return false;
  const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  try {
    return verifySignature("sha256", signed, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * The relying party is the host the page was served from. The Origin header is
 * what the browser itself stamps; the client data carries the same origin
 * inside the signed payload, so a mismatch between the two is refused.
 */
export function relyingPartyOf(originHeader: string | undefined): { origin: string; rpId: string } | null {
  if (!originHeader) return null;
  try {
    const url = new URL(originHeader);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return { origin: url.origin, rpId: url.hostname };
  } catch {
    return null;
  }
}

interface PendingChallenge {
  readonly challenge: string;
  readonly purpose: string;
  readonly rpId: string;
  readonly expiresAt: number;
}

/** Single-use, short-lived, per user. Held in process memory: a restart only voids challenges in flight. */
export class ChallengeStore {
  private readonly pending = new Map<string, PendingChallenge>();

  issue(userId: string, purpose: string, rpId: string, now = Date.now()): string {
    for (const [key, value] of this.pending) if (value.expiresAt <= now) this.pending.delete(key);
    const challenge = newChallenge();
    this.pending.set(userId, { challenge, purpose, rpId, expiresAt: now + CHALLENGE_TTL_MS });
    return challenge;
  }

  consume(userId: string, purpose: string, now = Date.now()): PendingChallenge | null {
    const found = this.pending.get(userId);
    this.pending.delete(userId);
    if (!found || found.purpose !== purpose || found.expiresAt <= now) return null;
    return found;
  }
}
