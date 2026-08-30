import { describe, it, expect, beforeAll } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex } from "@mezan/domain";
import { primaryArtifactSha512, verifyUpdateSignature } from "./update-verify.js";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

let secretKey: Uint8Array;
let publicKeyHex: string;
const SHA = "a".repeat(88); // shape of a base64 sha512, content irrelevant to the signature

async function signSha(sha: string, key = secretKey): Promise<string> {
  return base64(await signAsync(new TextEncoder().encode(sha), key));
}

beforeAll(async () => {
  secretKey = new Uint8Array(32).fill(9);
  publicKeyHex = bytesToHex(await getPublicKeyAsync(secretKey));
});

describe("primaryArtifactSha512", () => {
  it("prefers the top-level sha512", () => {
    expect(primaryArtifactSha512({ sha512: "TOP", files: [{ sha512: "F" }] })).toBe("TOP");
  });
  it("falls back to the first file's sha512", () => {
    expect(primaryArtifactSha512({ files: [{ url: "x.exe" }, { sha512: "F2" }] })).toBe("F2");
  });
  it("returns null when there is no hash", () => {
    expect(primaryArtifactSha512({ files: [{ url: "x.exe" }] })).toBeNull();
  });
});

describe("verifyUpdateSignature", () => {
  it("accepts a signature made by the vendor key over the artifact hash", async () => {
    const sig = await signSha(SHA);
    expect(await verifyUpdateSignature({ publicKeyHex, sha512: SHA, signatureB64: sig })).toBe(true);
  });

  it("rejects a signature over a DIFFERENT hash (bytes swapped under a valid sig)", async () => {
    const sig = await signSha(SHA);
    expect(
      await verifyUpdateSignature({ publicKeyHex, sha512: "b".repeat(88), signatureB64: sig }),
    ).toBe(false);
  });

  it("rejects a signature from the wrong key", async () => {
    const otherKey = new Uint8Array(32).fill(3);
    const sig = await signSha(SHA, otherKey);
    expect(await verifyUpdateSignature({ publicKeyHex, sha512: SHA, signatureB64: sig })).toBe(false);
  });

  it("returns false (never throws) on malformed input", async () => {
    expect(await verifyUpdateSignature({ publicKeyHex, sha512: SHA, signatureB64: "" })).toBe(false);
    expect(await verifyUpdateSignature({ publicKeyHex: "", sha512: SHA, signatureB64: "x" })).toBe(false);
    expect(await verifyUpdateSignature({ publicKeyHex, sha512: SHA, signatureB64: "!!not b64!!" })).toBe(false);
  });
});
