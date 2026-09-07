import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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
 * WHAT IS SIGNED, and why it is not just the hash.
 *
 * Signing the SHA-512 alone binds the signature to bytes and to nothing else.
 * An old installer that we genuinely signed, republished under a higher version
 * number on a feed an attacker controls, passes electron-updater's semver check
 * AND the Ed25519 check — a downgrade to a build whose bugs are public. So the
 * signed message is the whole tuple that identifies the release:
 *
 *     version || channel || arch || sha512
 *
 * All four are re-derived on the client from the feed metadata and the running
 * app, never read out of the signature, so a mismatch in any of them is a
 * refusal rather than a value the attacker gets to choose.
 *
 * SIGNING SOURCE OF TRUTH: apps/desktop/scripts/sign-release.mjs builds the
 * same string with the same separator. Change one and the other stops
 * verifying — this is a release-pipeline contract, not an implementation
 * detail.
 */

/** Separator for the signed tuple. No field may contain it. */
const FIELD_SEPARATOR = "||";

export interface UpdateArtifactFile {
  readonly sha512?: string;
  readonly url?: string;
}

export interface UpdateArtifactInfo {
  readonly version?: string;
  readonly sha512?: string;
  readonly files?: ReadonlyArray<UpdateArtifactFile>;
}

export interface CanonicalUpdateMessageInput {
  readonly version: string;
  readonly channel: string;
  readonly arch: string;
  /** Base64 SHA-512, exactly as published in the feed. */
  readonly sha512: string;
}

export function canonicalUpdateMessage(input: CanonicalUpdateMessageInput): string {
  return [input.version, input.channel, input.arch, input.sha512].join(FIELD_SEPARATOR);
}

/**
 * The architecture an artifact URL belongs to.
 *
 * electron-builder names the x64 artifacts with no arch token at all
 * (`Mezan-1.4.0-mac.zip`) and every other arch with one (`-arm64-`, `-ia32-`),
 * so x64 is the residue rather than a token to look for.
 */
const ARCH_TOKENS: ReadonlyArray<readonly [string, RegExp]> = [
  ["arm64", /(arm64|aarch64)/i],
  ["armv7l", /armv7l/i],
  ["ia32", /(ia32|x86(?!_64))/i],
];

function archOfUrl(url: string): string {
  for (const [arch, pattern] of ARCH_TOKENS) {
    if (pattern.test(url)) return arch;
  }
  return "x64";
}

/** The artifact electron-updater actually downloads on each platform. */
const UPDATE_ARTIFACT_EXTENSION: Partial<Record<NodeJS.Platform, RegExp>> = {
  // The DMG is a download page's file. electron-updater updates a Mac from the
  // ZIP, so signing/verifying the DMG's hash would verify bytes nobody installs.
  darwin: /\.zip$/i,
  win32: /\.exe$/i,
  linux: /\.(AppImage|deb)$/i,
};

export interface ArtifactSelector {
  readonly arch: string;
  readonly platform: NodeJS.Platform;
}

/**
 * The SHA-512 of the artifact THIS machine will actually download, or null.
 *
 * `files[0]` was wrong the moment the Mac build started shipping x64 and arm64
 * DMGs in one feed: half the fleet either verified a signature over the other
 * architecture's bytes or was refused outright. Ambiguity is answered with null
 * — refusing an update is recoverable, verifying the wrong bytes is not.
 */
export function selectArtifactSha512(
  info: UpdateArtifactInfo,
  selector: ArtifactSelector,
): string | null {
  const files = (info.files ?? []).filter(
    (file): file is { sha512: string; url: string } =>
      typeof file.sha512 === "string" && file.sha512 !== "" && typeof file.url === "string" && file.url !== "",
  );
  if (files.length === 0) return info.sha512 ?? null;

  const forArch = files.filter((file) => archOfUrl(file.url) === selector.arch);
  if (forArch.length === 0) return null;

  const extension = UPDATE_ARTIFACT_EXTENSION[selector.platform];
  const installable = extension ? forArch.filter((file) => extension.test(file.url)) : forArch;
  const candidates = installable.length > 0 ? installable : forArch;

  const hashes = new Set(candidates.map((file) => file.sha512));
  if (hashes.size !== 1) return null;
  return candidates[0]?.sha512 ?? null;
}

/**
 * The name the release pipeline gives a detached signature.
 *
 * Platform AND arch, because one feed directory carries both `latest.yml` and
 * `latest-mac.yml`: a Windows x64 installer and a Mac x64 zip would otherwise
 * both want `<version>-x64.sig`.
 */
export function signatureFileName(version: string, platform: string, arch: string): string {
  return `${version}-${platform}-${arch}.sig`;
}

/** The pre-platform name, still accepted so a single-platform feed can use it. */
export function legacySignatureFileName(version: string, arch: string): string {
  return `${version}-${arch}.sig`;
}

export interface VerifyUpdateInput {
  /** Vendor Ed25519 public key (hex). */
  readonly publicKeyHex: string;
  /** The exact string that was signed — see `canonicalUpdateMessage`. */
  readonly message: string;
  /** Detached Ed25519 signature over `message`, base64/base64url. */
  readonly signatureB64: string;
}

/**
 * Verifies the detached signature over the canonical release tuple. Returns
 * false (never throws) on any malformed input — an update that cannot be proven
 * authentic is simply not applied.
 */
export async function verifyUpdateSignature(input: VerifyUpdateInput): Promise<boolean> {
  if (!input.publicKeyHex || !input.message || !input.signatureB64) return false;
  try {
    const message = new TextEncoder().encode(input.message);
    // Accept both base64 and base64url encodings of the signature.
    const normalized = input.signatureB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const signature = base64UrlToBytes(normalized);
    const publicKey = hexToBytes(input.publicKeyHex);
    return await verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Strictly-greater comparison on the numeric release triple.
 *
 * Fail-closed by construction: anything unparseable, equal, or lower answers
 * false, so "I could not read these versions" refuses the update rather than
 * waving it through. A pre-release suffix is ignored — this product does not
 * ship one, and treating `1.4.0-beta` as newer than `1.4.0` would be a way in.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string): number[] | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/**
 * Base64 SHA-512 of a file on disk, in the same encoding electron-updater
 * publishes in `latest.yml`. Used to re-prove the DOWNLOADED bytes against the
 * signature before the installer is handed to the OS.
 */
export function sha512OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}
