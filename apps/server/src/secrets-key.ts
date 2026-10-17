import { randomBytes } from "node:crypto";
import { chmodSync, linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAesGcmSecretBox, type SecretBox } from "@mezan/persistence";
import { LogEvent, createLogger } from "@mezan/api";

const log = createLogger("secrets");

export const SECRETS_KEY_FILE = "secrets.key";
const KEY_HEX = /^[0-9a-f]{64}$/;

function parseKey(text: string, source: string): Buffer {
  const hex = text.trim().toLowerCase();
  if (!KEY_HEX.test(hex)) throw new Error(`${source} must be 64 hex characters (a 32-byte key)`);
  return Buffer.from(hex, "hex");
}

// SECURITY: the key lives at the platform-dir root, never under a tenant's directory, so no tenant
// export, backup or books file carries it. Published with link(), which fails if the file exists:
// two processes starting on one platform dir read one key instead of each minting their own, and
// neither can read a half-written file.
function keyFromFile(platformDir: string): Buffer {
  const file = path.join(platformDir, SECRETS_KEY_FILE);
  const draft = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  writeFileSync(draft, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(draft, 0o600);
  try {
    linkSync(draft, file);
    log.warn({ event: LogEvent.ConfigurationWarning, file }, "MEZAN_SECRETS_KEY is not set: generated a platform secrets key in this file; back it up, or stored webhook and SMTP secrets cannot be read");
  } catch (err) {
    if (!(err instanceof Error && (err as NodeJS.ErrnoException).code === "EEXIST")) throw err;
  } finally {
    unlinkSync(draft);
  }
  return parseKey(readFileSync(file, "utf8"), file);
}

export function loadSecretBox(envKey: string | undefined, platformDir: string): SecretBox {
  return createAesGcmSecretBox(envKey ? parseKey(envKey, "MEZAN_SECRETS_KEY") : keyFromFile(platformDir));
}
