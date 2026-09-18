/**
 * Pure, dependency-free encoding helpers for the license format.
 *
 * Uses only cross-platform primitives (`atob`, `globalThis.crypto.subtle`) — no
 * Node `Buffer`, no `node:crypto` import — so the same code runs in Electron's
 * renderer, a Node adapter, and a browser.
 */

/** Decode a base64url string to bytes. */
export function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode bytes as an unpadded base64url string. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8 decode a byte array to a string. */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** UTF-8 encode a string to bytes. */
export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Parse a hex string (optionally `0x`-prefixed) into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex string: odd length");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("Invalid hex string: non-hex characters");
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Lowercase hex encode a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/** Normalize a public key given as hex string or raw bytes into bytes. */
export function toBytes(key: string | Uint8Array): Uint8Array {
  return typeof key === "string" ? hexToBytes(key) : key;
}

/**
 * Salted SHA-256 of a raw machine identifier, hex-encoded. Only the hash is
 * ever compared or stored — the raw identifier never leaves this function
 * (privacy; and it survives a support screenshot — §2.5).
 */
export async function saltedFingerprintHash(
  rawIdentity: string,
  salt: string,
): Promise<string> {
  const data = utf8ToBytes(`${salt}:${rawIdentity}`);
  // `data` is always ArrayBuffer-backed (TextEncoder never yields a
  // SharedArrayBuffer view); the `unknown` round-trip only satisfies TS's
  // stricter typed-array generic under lib.dom (present when this file is
  // type-checked from a DOM-lib consumer, e.g. apps/web) without naming a
  // DOM-only type, which would fail to resolve for non-DOM consumers.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data as unknown as Uint8Array<ArrayBuffer>);
  return bytesToHex(new Uint8Array(digest));
}
