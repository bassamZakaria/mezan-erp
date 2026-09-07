// Ed25519 over `node:crypto`, so the vendor tools need no dependency at all.
//
// The licence signer and the check-in service run on the vendor's machine and
// hold the one secret this whole scheme rests on. Giving that code a dependency
// tree is a liability out of all proportion to what it does: Node has had raw
// Ed25519 since 12, and the two DER prefixes below are the entire adapter
// between a 32-byte seed and a `KeyObject`.
//
// These bytes are signed over EXACTLY as `packages/domain/src/licensing` signs
// and verifies them — the ASCII of the base64url payload segment — and
// `licensing.test.ts` proves the two implementations agree by verifying this
// script's output with `verifyLicense`.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

/** PKCS#8 wrapper for a bare Ed25519 32-byte private seed. */
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
/** SPKI wrapper for a bare Ed25519 32-byte public key. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyHex: privateKey
      .export({ format: "der", type: "pkcs8" })
      .subarray(PKCS8_PREFIX.length)
      .toString("hex"),
    publicKeyHex: publicKey
      .export({ format: "der", type: "spki" })
      .subarray(SPKI_PREFIX.length)
      .toString("hex"),
  };
}

export function privateKeyFromHex(hex) {
  const seed = Buffer.from(hex.trim(), "hex");
  if (seed.length !== 32) throw new Error("an Ed25519 private key is 32 bytes (64 hex characters)");
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function publicKeyFromHex(hex) {
  const raw = Buffer.from(hex.trim(), "hex");
  if (raw.length !== 32) throw new Error("an Ed25519 public key is 32 bytes (64 hex characters)");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export function publicHexFor(privateKeyHex) {
  const pub = createPublicKey(privateKeyFromHex(privateKeyHex));
  return pub.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length).toString("hex");
}

export function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

/** `base64url(payloadJson).base64url(signature)` — the `license.mezan` format. */
export function signLicensePayload(payload, privateKeyHex) {
  const payloadB64 = base64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = sign(null, Buffer.from(payloadB64, "ascii"), privateKeyFromHex(privateKeyHex));
  return `${payloadB64}.${base64Url(signature)}`;
}

/** Must match `checkinSignedBytes` in packages/domain/src/licensing/checkin.ts. */
export function checkinSignedBytes(claim) {
  for (const field of [claim.licenseId, claim.fingerprint, claim.serverTime]) {
    if (String(field).includes("|")) throw new Error("check-in claim fields must not contain '|'");
  }
  return Buffer.from(
    ["mezan.checkin.v1", claim.licenseId, claim.fingerprint, claim.revoked ? "1" : "0", claim.serverTime].join("|"),
    "utf8",
  );
}

export function signCheckinClaim(claim, privateKeyHex) {
  return base64Url(sign(null, checkinSignedBytes(claim), privateKeyFromHex(privateKeyHex)));
}

export function verifyCheckinClaim(claim, signatureB64Url, publicKeyHex) {
  try {
    return verify(
      null,
      checkinSignedBytes(claim),
      publicKeyFromHex(publicKeyHex),
      Buffer.from(signatureB64Url, "base64url"),
    );
  } catch {
    return false;
  }
}
