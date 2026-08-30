import { verifyAsync } from "@noble/ed25519";
import { base64UrlToBytes, hexToBytes } from "@mezan/domain";

/**
 * App-level Ed25519 verification of a downloaded update (docs/archive/plan.md
 * §2.3). This is DELIBERATELY separate from OS code-signing/notarization (the
 * vendor's Apple/Windows certs, supplied at release time): it is the same
 * offline-first trust anchor the license uses, so an update is only ever
 * applied if it was signed by the same key the vendor holds — even before the
 * OS-level signature is in place, and regardless of how the bytes were
 * fetched.
 *
 * The signature is over the release artifact's SHA-512 (the value
 * electron-updater publishes in `latest.yml` and re-checks against the bytes it
 * actually downloads). Binding our signature to that hash therefore binds it to
 * the exact installer bytes: electron-updater refuses any download whose SHA-512
 * does not match `info.sha512`, so a signature valid over `info.sha512` cannot
 * be replayed onto different bytes.
 */

export interface UpdateArtifactInfo {
  readonly sha512?: string;
  readonly files?: ReadonlyArray<{ readonly sha512?: string; readonly url?: string }>;
}

/**
 * The SHA-512 of the primary installer for this platform. electron-updater's
 * `UpdateInfo` carries the top-level `sha512` (single-file feeds) and/or a
 * `files[]` list; prefer the explicit top-level value, else the first file.
 */
export function primaryArtifactSha512(info: UpdateArtifactInfo): string | null {
  if (info.sha512) return info.sha512;
  const fromFiles = info.files?.find((f) => f.sha512)?.sha512;
  return fromFiles ?? null;
}

export interface VerifyUpdateInput {
  /** Vendor Ed25519 public key (hex). */
  readonly publicKeyHex: string;
  /** The release artifact's SHA-512, as published in the update feed. */
  readonly sha512: string;
  /** Detached Ed25519 signature over `sha512`, base64/base64url. */
  readonly signatureB64: string;
}

/**
 * Verifies the detached signature over the artifact hash. Returns false (never
 * throws) on any malformed input — an update that cannot be proven authentic is
 * simply not applied.
 */
export async function verifyUpdateSignature(input: VerifyUpdateInput): Promise<boolean> {
  if (!input.publicKeyHex || !input.sha512 || !input.signatureB64) return false;
  try {
    const message = new TextEncoder().encode(input.sha512);
    // Accept both base64 and base64url encodings of the signature.
    const normalized = input.signatureB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const signature = base64UrlToBytes(normalized);
    const publicKey = hexToBytes(input.publicKeyHex);
    return await verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}
