/**
 * The signed answer the licensing service gives to a check-in.
 *
 * An unsigned `{"revoked":false}` over TLS proves nothing an attacker with a
 * hosts file cannot also produce, and an unsigned `{"revoked":true}` lets
 * anybody on the path switch a paying shop off. So the answer is signed with
 * the SAME vendor key the licence itself is signed with, and the install
 * verifies it before it is allowed to move any clock or close any gate.
 *
 * The signed bytes bind the answer to the licence AND the machine that asked:
 * without `licenseId` and `fingerprint` in the message, a valid "not revoked"
 * answer collected once could be replayed forever, on any machine.
 */

import { signAsync, verifyAsync } from "@noble/ed25519";
import { base64UrlToBytes, bytesToBase64Url, toBytes, utf8ToBytes } from "./encoding.js";

export interface CheckinClaim {
  readonly licenseId: string;
  /** The asking machine's SALTED fingerprint hash — never the raw identity. */
  readonly fingerprint: string;
  readonly revoked: boolean;
  /** The SERVICE's clock, ISO. The install's own clock is not trusted. */
  readonly serverTime: string;
}

const PREFIX = "mezan.checkin.v1";

/**
 * The exact bytes both sides sign and verify. `|` is the separator, so no field
 * may contain one — a licence id that did could be split to forge a different
 * claim from the same signature.
 */
export function checkinSignedBytes(claim: CheckinClaim): Uint8Array {
  for (const field of [claim.licenseId, claim.fingerprint, claim.serverTime]) {
    if (field.includes("|")) throw new Error("check-in claim fields must not contain '|'");
  }
  return utf8ToBytes(
    [PREFIX, claim.licenseId, claim.fingerprint, claim.revoked ? "1" : "0", claim.serverTime].join(
      "|",
    ),
  );
}

/** Vendor side: signs a claim with the 32-byte Ed25519 seed. Base64url. */
export async function signCheckinResponse(
  claim: CheckinClaim,
  privateKey: string | Uint8Array,
): Promise<string> {
  return bytesToBase64Url(await signAsync(checkinSignedBytes(claim), toBytes(privateKey)));
}

/** Install side: true only for an authentic answer to THIS licence on THIS machine. */
export async function verifyCheckinResponse(
  claim: CheckinClaim,
  signature: string,
  publicKey: string | Uint8Array,
): Promise<boolean> {
  try {
    return await verifyAsync(
      base64UrlToBytes(signature),
      checkinSignedBytes(claim),
      toBytes(publicKey),
    );
  } catch {
    return false;
  }
}
