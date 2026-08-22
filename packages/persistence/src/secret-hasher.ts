import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { SecretHasher } from "@mezan/domain";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Node `scrypt`-backed `SecretHasher` — the adapter binding the domain's
 * `SecretHasher` port (used for both temporary passwords and PINs; see
 * `users/user.ts`). Deliberately kept out of `packages/domain` (layer
 * boundary, no `node:crypto` in the pure core — see `licensing/encoding.ts`).
 *
 * Format: `scrypt$<saltHex>$<hashHex>`, so the salt travels with the hash and
 * no separate column is needed.
 */
export function createScryptHasher(): SecretHasher {
  return {
    async hash(secret: string): Promise<string> {
      const salt = randomBytes(16);
      const derived = (await scryptAsync(secret, salt, KEY_LENGTH)) as Buffer;
      return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
    },

    async verify(secret: string, hash: string): Promise<boolean> {
      const parts = hash.split("$");
      if (parts.length !== 3 || parts[0] !== "scrypt") return false;
      const [, saltHex, hashHex] = parts;
      const salt = Buffer.from(saltHex as string, "hex");
      const expected = Buffer.from(hashHex as string, "hex");
      const derived = (await scryptAsync(secret, salt, expected.length)) as Buffer;
      if (derived.length !== expected.length) return false;
      return timingSafeEqual(derived, expected);
    },
  };
}
