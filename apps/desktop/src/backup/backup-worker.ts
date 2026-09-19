import { mkdir, copyFile, open as fsOpen, rename, rm } from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./checksum.js";
import { createArchive, extractArchive, type ArchiveExtraFile } from "./archive.js";
import {
  countRows,
  buildManifest,
  parseManifest,
  serializeManifest,
  type BackupManifest,
  type BackupReason,
} from "./manifest.js";
import { verifyArchive } from "./restore-service.js";
import { ChecksumMismatchError, BackupKeyMismatchError } from "./errors.js";
import { cipherDriver } from "../main/encrypted-database.js";
import { assertSnapshotEncrypted, sqlStringLiteral } from "./backup-service.js";
import { BACKUP_WORKER_FLAG } from "./worker-flags.js";

/**
 * The out-of-process half of `createBackup()` (backup-service.ts) — everything
 * from "hash the snapshot" through "verify the archive", which is the O(db
 * size) work that used to run synchronously on the Electron main-process event
 * loop (docs/artifacts/audit-2026-09-07.md Q-2). Forked once per backup and
 * exits after reporting exactly one result; never imported by anything else.
 */

export interface BackupWorkerJob {
  readonly archivePath: string;
  /** Scratch directory verify's own throwaway extract lands in — backupsDir/.tmp. */
  readonly workDir: string;
  /** The snapshot file: already on disk when `snapshot` is null, otherwise this worker writes it. */
  readonly dbFilePath: string;
  /**
   * Present only when the caller supplied `createBackup`'s optional `cipher`
   * for an encrypted, non-portable backup — the one shape that lets this
   * worker open its OWN connection with the SAME driver and key the tenant
   * database itself is opened with (encrypted-database.ts's `cipherDriver` +
   * a raw 32-byte-hex key), so the VACUUM INTO copy runs here instead of on
   * the caller's process. Null for every other configuration: the parent has
   * already taken the snapshot itself (an already-open connection, or a
   * portable `open` callback, cannot cross a process boundary).
   */
  readonly snapshot: { readonly dbPath: string; readonly key: string } | null;
  readonly manifestInput: {
    readonly appVersion: string;
    readonly reason: BackupReason;
    readonly schemaVersion?: number;
    readonly createdAt: string;
    readonly tables: Record<string, number>;
    readonly lastIntegrityCheckAt: string | null;
  };
  /** Attachment members that still go through the gzip'd tar, unchanged. */
  readonly extraFiles: readonly ArchiveExtraFile[];
  /** Attachment members skipped from the tar because their type is already compressed. */
  readonly looseAttachments: readonly { readonly sourcePath: string; readonly archiveName: string }[];
  /** Where `looseAttachments` are copied, beside the archive. */
  readonly looseDir: string;
  /** Mirrors `createBackup`'s existing `verifiable` gate — unchanged by the cadence below. */
  readonly verifiable: boolean;
  /** True on the day the weekly full `PRAGMA integrity_check` is due (or has never run). */
  readonly runFullIntegrityCheck: boolean;
  /** Raw hex key to open the archive with when it is still encrypted; null when it is plaintext (unencrypted or portable) or when verification is skipped entirely. */
  readonly verifyCipherKey: string | null;
}

export type BackupWorkerResult =
  | { readonly ok: true; readonly manifest: BackupManifest; readonly ranFullIntegrityCheck: boolean }
  | { readonly ok: false; readonly error: string; readonly quarantinedPath?: string };

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

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

/**
 * The cheaper proof that stands in for `PRAGMA integrity_check` on a day the
 * weekly cadence says it is not due: the archive still gets extracted, its
 * checksum still gets recomputed and compared, and an encrypted snapshot
 * still gets opened with the key — everything EXCEPT the O(db size) page scan.
 * Retention only runs after this (or the full check) succeeds either way, so
 * a skipped full check never turns into an unproven archive evicting a good one.
 */
export async function lightVerify(params: {
  archivePath: string;
  workDir: string;
  cipherKey: string | null;
}): Promise<void> {
  const extractDir = path.join(params.workDir, `verify-light-${Date.now()}-${process.pid}`);
  const { dbFilePath, manifestJson } = await extractArchive(params.archivePath, extractDir);
  try {
    const manifest = parseManifest(manifestJson);
    const actualChecksum = await sha256File(dbFilePath);
    if (actualChecksum !== manifest.checksum) {
      throw new ChecksumMismatchError(manifest.checksum, actualChecksum);
    }
    if (await isPlaintextSqlite(dbFilePath)) return;
    if (!params.cipherKey) throw new BackupKeyMismatchError();
    const probe = new cipherDriver(dbFilePath, { readonly: true });
    try {
      probe.pragma(`key = "x'${params.cipherKey}'"`);
      probe.prepare("SELECT count(*) FROM sqlite_master").get();
    } catch (err) {
      throw new BackupKeyMismatchError(err);
    } finally {
      probe.close();
    }
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

/**
 * The manifest's row counts are read from the SNAPSHOT, not the live database:
 * the backend keeps writing through its own connection while the copy is taken,
 * so counts read from the live file can disagree with the archive they describe
 * and the restore drill would report a healthy archive as having lost rows.
 */
async function countSnapshotRows(dbFilePath: string, key: string | null): Promise<Record<string, number> | null> {
  let db: InstanceType<typeof cipherDriver> | undefined;
  try {
    db = new cipherDriver(dbFilePath, { readonly: true });
    if (!(await isPlaintextSqlite(dbFilePath))) {
      if (!key || !/^[0-9a-f]{64}$/.test(key)) return null;
      db.pragma(`key = "x'${key}'"`);
    }
    return countRows(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function takeEncryptedSnapshot(dbPath: string, key: string, tmpDbPath: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error("Backup worker cipher key must be 32 bytes of lowercase hex.");
  }
  const db = new cipherDriver(dbPath);
  try {
    db.pragma(`key = "x'${key}'"`);
    await rm(tmpDbPath, { force: true });
    db.exec(`VACUUM INTO ${sqlStringLiteral(tmpDbPath)}`);
  } finally {
    db.close();
  }
  await assertSnapshotEncrypted(tmpDbPath);
}

/** Exported so `backup-worker.test.ts` can exercise the job logic directly, without paying for a real process fork per case. */
export async function runBackupWorkerJob(job: BackupWorkerJob): Promise<BackupWorkerResult> {
  try {
    if (job.snapshot) {
      await takeEncryptedSnapshot(job.snapshot.dbPath, job.snapshot.key, job.dbFilePath);
    }

    if (job.looseAttachments.length > 0) {
      await mkdir(job.looseDir, { recursive: true, mode: 0o700 });
      for (const loose of job.looseAttachments) {
        await copyFile(loose.sourcePath, path.join(job.looseDir, loose.archiveName));
      }
    }

    const tables =
      (await countSnapshotRows(job.dbFilePath, job.snapshot?.key ?? job.verifyCipherKey)) ??
      job.manifestInput.tables;
    const checksum = await sha256File(job.dbFilePath);
    const manifest = buildManifest({
      checksum,
      tables,
      appVersion: job.manifestInput.appVersion,
      reason: job.manifestInput.reason,
      schemaVersion: job.manifestInput.schemaVersion,
      createdAt: new Date(job.manifestInput.createdAt),
      lastIntegrityCheckAt: job.runFullIntegrityCheck
        ? job.manifestInput.createdAt
        : job.manifestInput.lastIntegrityCheckAt,
      looseAttachments: job.looseAttachments.map((a) => a.archiveName),
    });

    await createArchive({
      dbFilePath: job.dbFilePath,
      manifestJson: serializeManifest(manifest),
      outputPath: job.archivePath,
      extraFiles: job.extraFiles,
    });

    if (job.verifiable) {
      try {
        if (job.runFullIntegrityCheck) {
          await verifyArchive({
            archivePath: job.archivePath,
            workDir: job.workDir,
            cipher: job.verifyCipherKey ? { driver: cipherDriver, key: job.verifyCipherKey } : undefined,
          });
        } else {
          await lightVerify({
            archivePath: job.archivePath,
            workDir: job.workDir,
            cipherKey: job.verifyCipherKey,
          });
        }
      } catch (err) {
        const quarantined = `${job.archivePath}.unverified`;
        await rename(job.archivePath, quarantined).catch(() => undefined);
        return {
          ok: false,
          error:
            `Backup written but it does not verify, so it is not a backup. Moved to ${quarantined}. ` +
            `Cause: ${err instanceof Error ? err.message : String(err)}`,
          quarantinedPath: quarantined,
        };
      }
    }

    return { ok: true, manifest, ranFullIntegrityCheck: job.verifiable && job.runFullIntegrityCheck };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/*
 * Only wired up when this file IS the forked process's entry script — never
 * when it's merely imported (vitest's own worker pool uses `process.on("message")`
 * for ITS IPC, and a second listener here would corrupt that channel). Keyed on
 * an argv flag the parent passes, NOT on `import.meta.url`: scripts/build.mjs
 * bundles this file as CommonJS, where esbuild empties `import.meta`, so the
 * packaged worker never listened, exited 0, and every backup failed.
 */
if (process.argv.includes(BACKUP_WORKER_FLAG)) {
  process.on("message", (job: BackupWorkerJob) => {
    runBackupWorkerJob(job)
      .catch(
        (err: unknown): BackupWorkerResult => ({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      .then((result) => {
        process.send?.(result, () => process.exit(0));
      });
  });
}
