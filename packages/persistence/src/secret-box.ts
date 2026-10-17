import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretBox {
  seal(plain: string, context: string): string;
  open(sealed: string, context: string): string;
}

// CONTRACT: the prefix is how a stored value is told apart from a plaintext row written before
// sealing existed; changing it orphans every sealed value already on disk.
const SEALED_PREFIX = "mzs1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export function isSealedSecret(value: string): boolean {
  return value.startsWith(SEALED_PREFIX);
}

export class SecretUnsealError extends Error {
  constructor() {
    super("a stored secret could not be unsealed with the platform key");
    this.name = "SecretUnsealError";
  }
}

// SECURITY: AES-256-GCM with the row's context as associated data, so a sealed value copied onto
// another row or field does not open there.
export function createAesGcmSecretBox(key: Buffer): SecretBox {
  if (key.length !== KEY_BYTES) throw new Error(`the secrets key must be ${KEY_BYTES} bytes`);
  return {
    seal(plain, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${SEALED_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
    },
    open(sealed, context) {
      const [iv, tag, body] = sealed.slice(SEALED_PREFIX.length).split(".");
      if (!isSealedSecret(sealed) || iv === undefined || tag === undefined || body === undefined) throw new SecretUnsealError();
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretUnsealError();
      }
    },
  };
}
