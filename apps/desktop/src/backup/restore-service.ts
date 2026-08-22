import Database from "better-sqlite3";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { extractArchive } from "./archive.js";
import { parseManifest, type BackupManifest } from "./manifest.js";
import { sha256File } from "./checksum.js";
import { ChecksumMismatchError, IntegrityCheckFailedError } from "./errors.js";

export interface RestoreResult {
  readonly manifest: BackupManifest;
  readonly dbPath: string;
}

/**
 * The guided, verified restore flow from docs/plan.md §3.7:
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
}): Promise<RestoreResult> {
  const { archivePath, targetDbPath, workDir } = params;

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
    //    become the live database.
    assertIntegrityOk(dbFilePath);

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

function assertIntegrityOk(dbFilePath: string): void {
  const db = new Database(dbFilePath, { readonly: true });
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
