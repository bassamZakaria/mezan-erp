import type Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { createBackup } from "./backup-service.js";

/**
 * «تصدير نسخة قابلة للنقل» — the ONE way a restore-on-other-hardware archive is
 * produced, and it is never a default.
 *
 * WHAT THIS REPLACES. Every scheduled backup used to be written with
 * `portable`, which rekeys the snapshot to plaintext: `~/Mezan Backups` held
 * the shop's complete books — customers, prices, salaries, balances — in the
 * clear, on a shared shop PC, and on whatever USB stick they were copied to.
 * Nobody chose that; it was inherited from the call site.
 *
 * The trade it was solving is real: an archive keyed to this machine's keychain
 * dies with the machine. So the export stays — as an act the owner performs,
 * with a passphrase they pick and can carry in their head to the replacement
 * machine, and the archive is encrypted under THAT rather than under nothing.
 *
 * scrypt (N=2^15) + AES-256-GCM. The salt and IV travel in the header, the
 * GCM tag is the last 16 bytes, and a wrong passphrase fails the tag check —
 * i.e. it is refused, never silently half-decrypted.
 */

export const PORTABLE_FILE_EXTENSION = ".mezanbak.enc";
/** Identifies the container and its version. Read before anything is decrypted. */
const MAGIC = Buffer.from("MEZANPBK1");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_COST = 2 ** 15;
const SCRYPT_BLOCK_SIZE = 8;
/** scrypt at N=2^15 needs ~32 MB; Node's default 32 MB limit rejects it by one page. */
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

/**
 * The floor under a passphrase that is the ONLY thing between an off-machine
 * archive and the shop's books. Short enough that a shop owner will use one,
 * long enough that the scrypt cost above means something.
 */
export const MIN_PASSPHRASE_LENGTH = 10;

export class WeakPassphraseError extends Error {
  constructor() {
    super(`A portable archive's passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    this.name = "WeakPassphraseError";
  }
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      passphrase.normalize("NFKC"),
      salt,
      KEY_BYTES,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: 1, maxmem: SCRYPT_MAX_MEMORY },
      (err, key) => (err ? reject(err) : resolve(key as Buffer)),
    );
  });
}

/** Encrypts `sourcePath` to `targetPath` under `passphrase`. */
export async function encryptFile(
  sourcePath: string,
  targetPath: string,
  passphrase: string,
): Promise<void> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new WeakPassphraseError();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const out = createWriteStream(targetPath, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(sourcePath), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => {
    out.end(cipher.getAuthTag(), () => resolve());
    out.on("error", reject);
  });
}

/**
 * Decrypts an archive written by `encryptFile`. Throws on a wrong passphrase or
 * a truncated file — GCM's tag check is what makes "wrong key" and "corrupt
 * file" both refusals rather than garbage handed to the restore path.
 */
export async function decryptFile(
  sourcePath: string,
  targetPath: string,
  passphrase: string,
): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const blob = await readFile(sourcePath);
  const headerLength = MAGIC.length + SALT_BYTES + IV_BYTES;
  if (blob.length < headerLength + TAG_BYTES || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not a Mezan portable archive.");
  }
  const salt = blob.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = blob.subarray(MAGIC.length + SALT_BYTES, headerLength);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const body = blob.subarray(headerLength, blob.length - TAG_BYTES);

  const key = await deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  await writeFile(targetPath, plain, { mode: 0o600 });
}

export function portableFileName(createdAt: Date): string {
  return `mezan-portable-${createdAt.toISOString().replace(/[:.]/g, "-")}${PORTABLE_FILE_EXTENSION}`;
}

/**
 * Takes one archive that restores on other hardware and encrypts it under the
 * operator's passphrase.
 *
 * The intermediate plaintext archive is written into a private staging
 * directory inside the backups folder and removed in `finally`, so the readable
 * copy exists for the seconds it takes to encrypt it and never lands in the
 * folder people copy to a USB stick.
 */
export async function exportPortableBackup(params: {
  sqlite: Database.Database;
  backupsDir: string;
  appVersion: string;
  passphrase: string;
  encrypted?: boolean;
  /** Needed only when the live database is encrypted — see `createBackup`. */
  portable?: { readonly key: string; readonly open: (file: string, key: string) => Database.Database };
  now?: Date;
}): Promise<{ filePath: string }> {
  if (params.passphrase.length < MIN_PASSPHRASE_LENGTH) throw new WeakPassphraseError();
  const now = params.now ?? new Date();
  const staging = path.join(params.backupsDir, ".portable");
  await mkdir(staging, { recursive: true, mode: 0o700 });

  try {
    const plain = await createBackup({
      sqlite: params.sqlite,
      backupsDir: staging,
      appVersion: params.appVersion,
      reason: "manual",
      encrypted: params.encrypted,
      ...(params.portable ? { portable: params.portable } : {}),
      // Everything in the staging directory is deleted below; retention must
      // not decide which of them survives.
      retentionPolicy: { daily: 365, weekly: 0, monthly: 0 },
      now,
    });

    const filePath = path.join(params.backupsDir, portableFileName(now));
    await encryptFile(plain.archivePath, filePath, params.passphrase);
    return { filePath };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
