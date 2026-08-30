import Database from "better-sqlite3";
import { copyFile, mkdir, open as fsOpen, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { SqliteDriver } from "@mezan/persistence";
import { extractArchive } from "./archive.js";
import { parseManifest, type BackupManifest } from "./manifest.js";
import { sha256File } from "./checksum.js";
import { BackupKeyMismatchError, ChecksumMismatchError, IntegrityCheckFailedError } from "./errors.js";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

/**
 * The driver + key this installation opens its own database with, needed to
 * integrity-check an ENCRYPTED archive before mounting it. Omitted for an
 * unencrypted install, and irrelevant for an archive that is already plaintext.
 */
export interface RestoreCipher {
  readonly driver: SqliteDriver;
  readonly key: string;
}

async function isPlaintextSqlite(filePath: string): Promise<boolean> {
  const handle = await fsOpen(filePath, "r");
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(buffer, 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && buffer.equals(SQLITE_HEADER);
  } finally {
    await handle.close();
  }
}

export interface RestoreResult {
  readonly manifest: BackupManifest;
  readonly dbPath: string;
}

/**
 * The guided, verified restore flow from docs/archive/plan.md §3.7:
 * extract → validate manifest → verify checksum → integrity-check → mount.
 *
 * "Mount" means atomically placing the restored database at `targetDbPath`:
 * write to a `.new` sibling first, then rename over the target, so a crash
 * mid-restore can never leave a half-written file where the live database
 * belongs. The caller is responsible for closing any existing connection to
 * `targetDbPath` before calling this, and (re)opening a fresh one after.
 */
export async function restoreBackup(params: {
  archivePath: string;
  targetDbPath: string;
  workDir: string;
  cipher?: RestoreCipher;
}): Promise<RestoreResult> {
  const { archivePath, targetDbPath, workDir, cipher } = params;

  const extractDir = path.join(workDir, `restore-${Date.now()}`);
  const { dbFilePath, manifestJson } = await extractArchive(archivePath, extractDir);

  try {
    // 1. Validate manifest shape (throws ManifestValidationError on failure).
    const manifest = parseManifest(manifestJson);

    // 2. Verify the extracted database matches the checksum the backup
    //    recorded at creation time — the archive may have been corrupted
    //    or tampered with in transit/at rest.
    const actualChecksum = await sha256File(dbFilePath);
    if (actualChecksum !== manifest.checksum) {
      throw new ChecksumMismatchError(manifest.checksum, actualChecksum);
    }

    // 3. Integrity-check the SQLite file itself before it's trusted to
    //    become the live database. Which driver that takes is read from the
    //    file, not assumed: archives written before encryption-at-rest shipped
    //    are plaintext and must keep restoring, and one of them landing on an
    //    encrypted install is fine — the next launch converts it.
    await assertIntegrityOk(dbFilePath, cipher);

    // 4. Mount: atomic rename into place.
    await mkdir(path.dirname(targetDbPath), { recursive: true });
    const stagedPath = `${targetDbPath}.new`;
    await copyFile(dbFilePath, stagedPath);
    await rename(stagedPath, targetDbPath);

    return { manifest, dbPath: targetDbPath };
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

async function assertIntegrityOk(dbFilePath: string, cipher?: RestoreCipher): Promise<void> {
  if (await isPlaintextSqlite(dbFilePath)) {
    runIntegrityCheck(new Database(dbFilePath, { readonly: true }));
    return;
  }

  if (!cipher) throw new BackupKeyMismatchError();
  if (!/^[0-9a-f]{64}$/.test(cipher.key)) {
    // The key is interpolated below because PRAGMA values cannot be bound.
    throw new Error("Restore key must be 32 bytes of lowercase hex.");
  }

  let db: Database.Database;
  try {
    db = new cipher.driver(dbFilePath, { readonly: true });
    db.pragma(`key = "x'${cipher.key}'"`);
  } catch (err) {
    throw new BackupKeyMismatchError(err);
  }
  try {
    runIntegrityCheck(db);
  } catch (err) {
    // A wrong key does not report corruption — SQLite never reaches a page it
    // can parse and answers "file is not a database" instead. Reporting that as
    // a corrupt archive is how an owner throws away a restorable backup that
    // only needed the key card from the machine that took it.
    if (err instanceof IntegrityCheckFailedError) throw err;
    throw new BackupKeyMismatchError(err);
  }
}

/** Closes `db` either way — it exists only to be asked this one question. */
function runIntegrityCheck(db: Database.Database): void {
  try {
    const result = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const report = result.map((r) => r.integrity_check).join("; ");
    if (report !== "ok") {
      throw new IntegrityCheckFailedError(report);
    }
  } finally {
    db.close();
  }
}
