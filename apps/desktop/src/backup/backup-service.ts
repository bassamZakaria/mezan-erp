import type Database from "better-sqlite3";
import { mkdir, open as fsOpen, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { buildManifest, countRows, serializeManifest, type BackupReason } from "./manifest.js";
import { sha256File } from "./checksum.js";
import { createArchive, type ArchiveExtraFile } from "./archive.js";
import { applyRetention, DEFAULT_RETENTION_POLICY, type RetentionPolicy } from "./retention.js";
import { verifyArchive } from "./restore-service.js";

export const BACKUP_FILE_EXTENSION = ".mezanbak";
const BACKUP_FILE_PREFIX = "mezan-backup-";

export interface BackupResult {
  readonly archivePath: string;
  readonly manifest: ReturnType<typeof buildManifest>;
  readonly removed: readonly string[];
}

function timestampForFilename(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

export function backupFileName(createdAt: Date): string {
  return `${BACKUP_FILE_PREFIX}${timestampForFilename(createdAt)}${BACKUP_FILE_EXTENSION}`;
}

const FILENAME_TIMESTAMP_RE =
  /^mezan-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.mezanbak$/;

/**
 * Recovers the creation timestamp encoded in a backup's filename. Preferred
 * over filesystem mtime for retention decisions: mtime can be perturbed by a
 * plain file copy (off-device export, USB restore) in a way the encoded
 * timestamp never is, and it makes retention deterministically testable.
 * Falls back to `null` for any file that doesn't match our own naming
 * scheme (defensive — e.g. a manually renamed file in the backups folder).
 */
export function parseCreatedAtFromFileName(fileName: string): Date | null {
  const m = FILENAME_TIMESTAMP_RE.exec(fileName);
  if (!m) return null;
  const [, date, hh, mm, ss, ms] = m;
  const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Doubles single quotes — SQLite has no parameter binding for a `VACUUM INTO` file name. */
function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

/**
 * Proves the snapshot is not a readable copy of the books before it is sealed
 * into an archive.
 *
 * The backups directory is exactly what gets copied to a USB stick and carried
 * out of the shop, so an archive holding a decrypted database would make the
 * encryption decorative — the file on disk would be unreadable and the copy
 * beside it would not be. This is checked at runtime, on every backup, rather
 * than trusted to hold because a flag was passed.
 */
async function assertSnapshotEncrypted(filePath: string): Promise<void> {
  const handle = await fsOpen(filePath, "r");
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(buffer, 0, SQLITE_HEADER.length, 0);
    if (bytesRead === SQLITE_HEADER.length && buffer.equals(SQLITE_HEADER)) {
      throw new Error(
        "Backup snapshot of an encrypted database came out readable — refusing to write a plaintext archive.",
      );
    }
  } finally {
    await handle.close();
  }
}

/**
 * The mirror of `assertSnapshotEncrypted`, for the portable path.
 *
 * `sqlcipher_export` failing quietly would leave a still-encrypted snapshot that
 * gets sealed into an archive labelled portable — and nobody would find out
 * until a shop tried to restore it on replacement hardware, which is the one
 * moment they cannot afford to. So the header is read back and the archive is
 * refused unless it really is a plain SQLite file.
 */
async function assertSnapshotReadable(filePath: string): Promise<void> {
  const handle = await fsOpen(filePath, "r");
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(buffer, 0, SQLITE_HEADER.length, 0);
    if (bytesRead !== SQLITE_HEADER.length || !buffer.equals(SQLITE_HEADER)) {
      throw new Error(
        "Portable backup was requested but the snapshot is still encrypted — refusing to write an archive " +
          "that claims to be restorable on another machine and is not.",
      );
    }
  } finally {
    await handle.close();
  }
}

/**
 * Creates one backup: SQLite's online backup API (`better-sqlite3`'s
 * `.backup()`, which wraps SQLite's Online Backup API) copies a
 * transactionally-consistent snapshot of the *live* database — safe to run
 * against a WAL database mid-write, unlike a raw file copy (docs/archive/plan.md
 * §3.7). That snapshot + a manifest (schema version, app version, row
 * counts, checksum) are packaged into one archive, then GFS retention prunes
 * `backupsDir` down to the configured policy.
 *
 * `encrypted` switches the snapshot to `VACUUM INTO`, which is the only route
 * that keeps an encrypted database encrypted on the way out: the Online Backup
 * API opens its target unkeyed, so SQLite3MultipleCiphers refuses the transfer
 * outright ("incompatible source and target databases") rather than writing a
 * plaintext copy. `VACUUM INTO` inherits the source connection's cipher and
 * key, and is just as transactionally consistent against a live WAL database.
 */
export async function createBackup(params: {
  sqlite: Database.Database;
  backupsDir: string;
  appVersion: string;
  reason: BackupReason;
  /** True when `sqlite` is a keyed connection — see the note above. */
  encrypted?: boolean;
  /**
   * Write the archive UNENCRYPTED so it can be restored on another machine.
   *
   * The trade is stated in full at the call site: a portable archive is the
   * shop's whole books in the clear. Off by default, and it must stay a thing
   * somebody chose rather than a default anybody inherits.
   *
   * Needs the key and a way to open a keyed connection, because decrypting is
   * done by rekeying a COPY — see the branch below. Passing the opener rather
   * than importing the driver keeps this module free of the cipher package,
   * which is a desktop-only dependency.
   */
  portable?: {
    readonly key: string;
    readonly open: (file: string, key: string) => Database.Database;
  };
  schemaVersion?: number;
  extraFiles?: readonly ArchiveExtraFile[];
  retentionPolicy?: RetentionPolicy;
  now?: Date;
}): Promise<BackupResult> {
  const {
    sqlite,
    backupsDir,
    appVersion,
    reason,
    encrypted = false,
    portable,
    schemaVersion,
    extraFiles,
    retentionPolicy = DEFAULT_RETENTION_POLICY,
    now = new Date(),
  } = params;

  await mkdir(backupsDir, { recursive: true });

  const tmpDir = path.join(backupsDir, ".tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmpDbPath = path.join(tmpDir, `snapshot-${now.getTime()}-${process.pid}.sqlite`);

  try {
    if (encrypted && portable) {
      /*
       * PLAINTEXT ON PURPOSE — the owner's decision, and it has a cost.
       *
       * `VACUUM INTO` inherits the source's key, which makes an archive that
       * only THIS machine can ever open: lose the PC and the backup is a file
       * nobody on earth can read, which is the disaster backups exist for.
       * Exporting unkeyed makes the archive restorable on replacement hardware
       * — and makes it the shop's complete books in the clear, in the backups
       * folder and in whatever bucket they are uploaded to. Anyone who opens
       * the file reads every customer, price, salary and balance.
       *
       * `ATTACH ... KEY ''` + `sqlcipher_export` is the documented route out of
       * SQLite3MultipleCiphers; `VACUUM INTO` cannot do it, because it has no
       * way to say "and drop the cipher".
       */
      if (!portable.key || !portable.open) {
        throw new Error("A portable backup of an encrypted database needs the key to decrypt the copy with.");
      }
      await rm(tmpDbPath, { force: true });
      // Copy first (still encrypted, still transactionally consistent against a
      // live WAL database), then decrypt the COPY. `sqlcipher_export` is not
      // exposed by this build of SQLite3MultipleCiphers, and rekeying the copy
      // never touches the live database — which matters, because a rekey that
      // went wrong on the original would be the shop's books.
      sqlite.exec(`VACUUM INTO ${sqlStringLiteral(tmpDbPath)}`);
      const copy = portable.open(tmpDbPath, portable.key);
      try {
        copy.pragma("rekey=''");
      } finally {
        copy.close();
      }
      await assertSnapshotReadable(tmpDbPath);
    } else if (encrypted) {
      // `VACUUM INTO` refuses an existing target; a crashed run can leave one.
      await rm(tmpDbPath, { force: true });
      sqlite.exec(`VACUUM INTO ${sqlStringLiteral(tmpDbPath)}`);
      await assertSnapshotEncrypted(tmpDbPath);
    } else {
      await sqlite.backup(tmpDbPath);
    }

    const checksum = await sha256File(tmpDbPath);
    const tables = countRows(sqlite);
    const manifest = buildManifest({ checksum, tables, appVersion, reason, schemaVersion, createdAt: now });

    const archivePath = path.join(backupsDir, backupFileName(now));
    await createArchive({
      dbFilePath: tmpDbPath,
      manifestJson: serializeManifest(manifest),
      outputPath: archivePath,
      extraFiles,
    });

    /*
     * VERIFY BEFORE RETENTION, and before reporting success.
     *
     * Order matters twice over. Retention deletes older archives to make room
     * for this one, so proving this one first is what stops a bad backup
     * evicting a good one — the way a shop ends up with nothing but corrupt
     * files. And an archive that cannot be opened must never be counted as a
     * backup: it is renamed out of the way so retention and the restore screen
     * cannot mistake it for one, and the failure is raised rather than logged
     * quietly.
     */
    /*
     * Only an archive this process can OPEN can be verified. A portable archive
     * is plaintext, and an install with no cipher was plaintext already; an
     * encrypted-and-not-portable archive would need the key handed in, and
     * pretending to verify one without it would be worse than not trying —
     * a green tick that checked nothing.
     */
    const verifiable = portable !== undefined || !encrypted;
    try {
      if (verifiable) await verifyArchive({ archivePath, workDir: tmpDir });
    } catch (err) {
      const quarantined = `${archivePath}.unverified`;
      await rename(archivePath, quarantined).catch(() => undefined);
      throw new Error(
        `Backup written but it does not verify, so it is not a backup. Moved to ${quarantined}. ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const removed = await pruneToRetention(backupsDir, retentionPolicy);

    return { archivePath, manifest, removed };
  } finally {
    await rm(tmpDbPath, { force: true });
  }
}

/** Lists existing `*.mezanbak` archives in `backupsDir` with their creation time. */
export async function listBackups(
  backupsDir: string,
): Promise<Array<{ path: string; createdAt: Date }>> {
  let entries: string[];
  try {
    entries = await readdir(backupsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const backups: Array<{ path: string; createdAt: Date }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(BACKUP_FILE_EXTENSION)) continue;
    const full = path.join(backupsDir, entry);
    const fromName = parseCreatedAtFromFileName(entry);
    const createdAt = fromName ?? (await stat(full)).mtime;
    backups.push({ path: full, createdAt });
  }
  return backups;
}

async function pruneToRetention(
  backupsDir: string,
  policy: RetentionPolicy,
): Promise<string[]> {
  const backups = await listBackups(backupsDir);
  const { remove } = applyRetention(
    backups.map((b) => ({ id: b.path, createdAt: b.createdAt })),
    policy,
  );

  for (const r of remove) {
    await rm(r.id, { force: true });
  }
  return remove.map((r) => r.id);
}
