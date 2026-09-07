import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex } from "@mezan/domain";
import {
  canonicalUpdateMessage,
  isNewerVersion,
  legacySignatureFileName,
  selectArtifactSha512,
  sha512OfFile,
  signatureFileName,
  verifyUpdateSignature,
} from "./update-verify.js";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

let secretKey: Uint8Array;
let publicKeyHex: string;
const SHA = "a".repeat(88); // shape of a base64 sha512, content irrelevant to the signature

async function sign(message: string, key = secretKey): Promise<string> {
  return base64(await signAsync(new TextEncoder().encode(message), key));
}

beforeAll(async () => {
  secretKey = new Uint8Array(32).fill(9);
  publicKeyHex = bytesToHex(await getPublicKeyAsync(secretKey));
});

/**
 * GUARDS U-7. `primaryArtifactSha512` returned `files[0]`, and the Mac build
 * ships an x64 and an arm64 artifact in one feed — so half the fleet verified a
 * signature over the other architecture's bytes, or was refused.
 */
describe("selectArtifactSha512", () => {
  const macFeed = {
    version: "1.4.0",
    files: [
      { url: "Mezan-1.4.0-mac.zip", sha512: "X64ZIP" },
      { url: "Mezan-1.4.0.dmg", sha512: "X64DMG" },
      { url: "Mezan-1.4.0-arm64-mac.zip", sha512: "ARM64ZIP" },
      { url: "Mezan-1.4.0-arm64.dmg", sha512: "ARM64DMG" },
    ],
  };

  it("picks the x64 zip on an Intel Mac", () => {
    expect(selectArtifactSha512(macFeed, { arch: "x64", platform: "darwin" })).toBe("X64ZIP");
  });

  it("picks the arm64 zip on an Apple Silicon Mac", () => {
    expect(selectArtifactSha512(macFeed, { arch: "arm64", platform: "darwin" })).toBe("ARM64ZIP");
  });

  it("picks the installer electron-updater actually downloads, not the DMG beside it", () => {
    // The DMG is a download page's file; the updater uses the ZIP. Signing the
    // DMG's hash would verify bytes nobody installs.
    expect(selectArtifactSha512(macFeed, { arch: "x64", platform: "darwin" })).not.toBe("X64DMG");
  });

  it("picks the .exe on Windows", () => {
    const feed = { files: [{ url: "Mezan-Setup-1.4.0.exe", sha512: "WINEXE" }] };
    expect(selectArtifactSha512(feed, { arch: "x64", platform: "win32" })).toBe("WINEXE");
  });

  it("refuses rather than guessing when this architecture is not in the feed", () => {
    const feed = { files: [{ url: "Mezan-1.4.0-arm64-mac.zip", sha512: "ARM64ZIP" }] };
    expect(selectArtifactSha512(feed, { arch: "x64", platform: "darwin" })).toBeNull();
  });

  it("refuses when the candidates disagree — an ambiguous hash is not a hash", () => {
    const feed = {
      files: [
        { url: "Mezan-1.4.0-mac.zip", sha512: "A" },
        { url: "Mezan-1.4.0-mac-2.zip", sha512: "B" },
      ],
    };
    expect(selectArtifactSha512(feed, { arch: "x64", platform: "darwin" })).toBeNull();
  });

  it("falls back to the top-level sha512 on a single-artifact feed", () => {
    expect(selectArtifactSha512({ sha512: "TOP" }, { arch: "x64", platform: "win32" })).toBe("TOP");
  });
});

/**
 * GUARDS U-6. Only the SHA-512 used to be signed, so a genuinely signed OLD
 * installer republished under a higher version passed both electron-updater's
 * semver check and ours: a downgrade from a compromised feed.
 */
describe("canonicalUpdateMessage", () => {
  it("binds version, channel and arch to the hash", () => {
    expect(
      canonicalUpdateMessage({ version: "1.4.0", channel: "latest", arch: "arm64", sha512: SHA }),
    ).toBe(`1.4.0||latest||arm64||${SHA}`);
  });

  it("does not verify when the version is swapped under a valid signature", async () => {
    const signed = canonicalUpdateMessage({
      version: "1.2.0",
      channel: "latest",
      arch: "x64",
      sha512: SHA,
    });
    const signature = await sign(signed);
    const replayed = canonicalUpdateMessage({
      version: "9.9.9",
      channel: "latest",
      arch: "x64",
      sha512: SHA,
    });
    expect(
      await verifyUpdateSignature({ publicKeyHex, message: replayed, signatureB64: signature }),
    ).toBe(false);
  });

  it("does not verify when the arch is swapped under a valid signature", async () => {
    const signature = await sign(
      canonicalUpdateMessage({ version: "1.4.0", channel: "latest", arch: "x64", sha512: SHA }),
    );
    expect(
      await verifyUpdateSignature({
        publicKeyHex,
        message: canonicalUpdateMessage({
          version: "1.4.0",
          channel: "latest",
          arch: "arm64",
          sha512: SHA,
        }),
        signatureB64: signature,
      }),
    ).toBe(false);
  });
});

describe("verifyUpdateSignature", () => {
  const message = canonicalUpdateMessage({
    version: "1.4.0",
    channel: "latest",
    arch: "x64",
    sha512: SHA,
  });

  it("accepts a signature made by the vendor key over the canonical tuple", async () => {
    expect(
      await verifyUpdateSignature({ publicKeyHex, message, signatureB64: await sign(message) }),
    ).toBe(true);
  });

  it("rejects a signature over a DIFFERENT hash (bytes swapped under a valid sig)", async () => {
    const other = canonicalUpdateMessage({
      version: "1.4.0",
      channel: "latest",
      arch: "x64",
      sha512: "b".repeat(88),
    });
    expect(
      await verifyUpdateSignature({ publicKeyHex, message: other, signatureB64: await sign(message) }),
    ).toBe(false);
  });

  it("rejects a signature from the wrong key", async () => {
    const otherKey = new Uint8Array(32).fill(3);
    expect(
      await verifyUpdateSignature({
        publicKeyHex,
        message,
        signatureB64: await sign(message, otherKey),
      }),
    ).toBe(false);
  });

  it("returns false (never throws) on malformed input", async () => {
    expect(await verifyUpdateSignature({ publicKeyHex, message, signatureB64: "" })).toBe(false);
    expect(await verifyUpdateSignature({ publicKeyHex: "", message, signatureB64: "x" })).toBe(false);
    expect(
      await verifyUpdateSignature({ publicKeyHex, message, signatureB64: "!!not b64!!" }),
    ).toBe(false);
  });
});

describe("isNewerVersion", () => {
  it("accepts a higher release", () => {
    expect(isNewerVersion("1.4.0", "1.3.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
  });

  it("refuses the same or an older release — the downgrade U-6 describes", () => {
    expect(isNewerVersion("1.4.0", "1.4.0")).toBe(false);
    expect(isNewerVersion("1.3.0", "1.4.0")).toBe(false);
  });

  it("refuses anything it cannot read, rather than assuming", () => {
    expect(isNewerVersion("", "1.4.0")).toBe(false);
    expect(isNewerVersion("latest", "1.4.0")).toBe(false);
  });
});

describe("signature file names", () => {
  it("carries the platform as well as the arch — one feed holds both latest.yml files", () => {
    expect(signatureFileName("1.4.0", "darwin", "x64")).toBe("1.4.0-darwin-x64.sig");
    expect(signatureFileName("1.4.0", "win32", "x64")).toBe("1.4.0-win32-x64.sig");
    expect(legacySignatureFileName("1.4.0", "x64")).toBe("1.4.0-x64.sig");
  });
});

describe("sha512OfFile", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mezan-update-hash-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("hashes the downloaded bytes in the encoding the feed publishes", async () => {
    const file = path.join(dir, "installer.bin");
    await writeFile(file, "mezan");
    const { createHash } = await import("node:crypto");
    expect(await sha512OfFile(file)).toBe(createHash("sha512").update("mezan").digest("base64"));
  });
});
