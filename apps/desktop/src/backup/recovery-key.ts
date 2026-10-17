import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RecoveryMode } from "../shared/ipc-contract.js";
import { derivePortableKey, newPortableSalt } from "./portable-export.js";

export { RecoveryMode };

const RECOVERY_FILE_NAME = ".recovery-key.json";
const RECORD_VERSION = 1;

export interface RecoveryKeyStore {
  isAvailable(): boolean;
  seal(plain: string): Buffer;
  unseal(sealed: Buffer): string;
}

export interface RecoveryStatus {
  readonly mode: RecoveryMode | null;
  readonly setAt: string | null;
}

export interface RecoveryKey {
  readonly key: Buffer;
  readonly salt: Buffer;
}

interface RecoveryRecord {
  readonly version: number;
  readonly mode: RecoveryMode;
  readonly salt: string;
  readonly sealedKey: string;
  readonly setAt: string;
}

export class RecoveryKeyStoreUnavailableError extends Error {
  constructor() {
    super("The operating system has no keyring to seal the recovery key with.");
    this.name = "RecoveryKeyStoreUnavailableError";
  }
}

function recordPath(backupsDir: string): string {
  return path.join(backupsDir, RECOVERY_FILE_NAME);
}

function isMode(value: unknown): value is RecoveryMode {
  return Object.values(RecoveryMode).includes(value as RecoveryMode);
}

async function readRecord(backupsDir: string): Promise<RecoveryRecord | null> {
  try {
    const raw = JSON.parse(await readFile(recordPath(backupsDir), "utf8")) as Record<string, unknown>;
    const { mode, salt, sealedKey, setAt } = raw;
    if (!isMode(mode) || typeof salt !== "string" || typeof sealedKey !== "string" || typeof setAt !== "string") {
      return null;
    }
    return { version: RECORD_VERSION, mode, salt, sealedKey, setAt };
  } catch {
    return null;
  }
}

export async function readRecoveryStatus(backupsDir: string): Promise<RecoveryStatus> {
  const record = await readRecord(backupsDir);
  return { mode: record?.mode ?? null, setAt: record?.setAt ?? null };
}

/**
 * SECURITY: the secret itself is never stored. What is kept is the scrypt key
 * derived from it (the same KDF and parameters as MEZANPBK1) sealed by the OS
 * keychain, plus the salt. The scheduled copies need a key with nobody at the
 * keyboard; a copy written under it opens with `decryptFile(secret)` anywhere,
 * because the salt travels in every file's header.
 */
export async function setRecoverySecret(params: {
  readonly backupsDir: string;
  readonly secret: string;
  readonly mode: RecoveryMode;
  readonly keyStore: RecoveryKeyStore;
  readonly now?: Date;
}): Promise<RecoveryStatus> {
  if (!params.keyStore.isAvailable()) throw new RecoveryKeyStoreUnavailableError();
  const salt = newPortableSalt();
  const key = await derivePortableKey(params.secret, salt);
  const record: RecoveryRecord = {
    version: RECORD_VERSION,
    mode: params.mode,
    salt: salt.toString("hex"),
    sealedKey: params.keyStore.seal(key.toString("hex")).toString("base64"),
    setAt: (params.now ?? new Date()).toISOString(),
  };
  await mkdir(params.backupsDir, { recursive: true, mode: 0o700 });
  const target = recordPath(params.backupsDir);
  const partial = `${target}.partial`;
  try {
    await writeFile(partial, JSON.stringify(record, null, 2), { mode: 0o600 });
    await rename(partial, target);
  } catch (err) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw err;
  }
  return { mode: record.mode, setAt: record.setAt };
}

export async function loadRecoveryKey(backupsDir: string, keyStore: RecoveryKeyStore): Promise<RecoveryKey | null> {
  const record = await readRecord(backupsDir);
  if (!record || !keyStore.isAvailable()) return null;
  const key = Buffer.from(keyStore.unseal(Buffer.from(record.sealedKey, "base64")), "hex");
  const salt = Buffer.from(record.salt, "hex");
  return { key, salt };
}
