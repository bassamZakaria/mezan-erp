import type Database from "better-sqlite3";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open as fsOpen, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countRows, type BackupManifest, type BackupReason } from "./manifest.js";
import type { ArchiveExtraFile } from "./archive.js";
import { applyRetention, DEFAULT_RETENTION_POLICY, type RetentionPolicy } from "./retention.js";
import type { BackupWorkerJob, BackupWorkerResult } from "./backup-worker.js";

export const BACKUP_FILE_EXTENSION = ".mezanbak";
const BACKUP_FILE_PREFIX = "mezan-backup-";

/**
 * The label the launch-time, schema-moving backup carries.
 *
 * It exists so "put it back the way it was before the update" can be a button
 * rather than an owner guessing which timestamp in the list was taken before
 * the version that broke their books.
 */
export const PRE_UPDATE_LABEL_PREFIX = "pre-update";

/** Labels travel in a file name, so they may hold nothing that is not one. */
function sanitizeLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export function preUpdateLabel(appVersion: string): string {
  return `${PRE_UPDATE_LABEL_PREFIX}-${sanitizeLabel(appVersion)}`;
}

export function isPreUpdateArchive(fileName: string): boolean {
  return fileName.startsWith(`${BACKUP_FILE_PREFIX}${PRE_UPDATE_LABEL_PREFIX}-`);
}

export interface BackupResult {
  readonly archivePath: string;
  readonly manifest: BackupManifest;
  readonly removed: readonly string[];
}

function timestampForFilename(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

export function backupFileName(createdAt: Date, label?: string): string {
  const tag = label ? `${sanitizeLabel(label)}-` : "";
  return `${BACKUP_FILE_PREFIX}${tag}${timestampForFilename(createdAt)}${BACKUP_FILE_EXTENSION}`;
}

const FILENAME_TIMESTAMP_RE =
  /^mezan-backup-(?:.+?-)?(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.mezanbak$/;

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
  if (!date) return null;
  const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Doubles single quotes — SQLite has no parameter binding for a `VACUUM INTO`
 * file name. Exported: backup-worker.ts needs the exact same escaping when it
 * runs `VACUUM INTO` itself, on its own connection, for the opt-in `cipher`
 * off-thread path below.
 */
export function sqlStringLiteral(value: string): string {
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
export async function assertSnapshotEncrypted(filePath: string): Promise<void> {
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
 * Attachment file types already in a compressed container — gzipping them a
 * second time inside the backup archive burns CPU for no size benefit
 * (docs/artifacts/audit-2026-09-07.md Q-2, "tar+gzip of already-compressed
 * attachments"). The database snapshot itself is NOT in this set: it is
 * genuinely compressible and stays inside the gzip'd tar.
 */
const PRECOMPRESSED_ATTACHMENT_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "heic",
  "mp4",
  "mov",
  "webm",
  "mp3",
  "m4a",
  "ogg",
  "zip",
  "gz",
  "7z",
  "rar",
  "xz",
  "bz2",
]);

export function isPrecompressedAttachment(archiveName: string): boolean {
  const ext = archiveName.split(".").pop()?.toLowerCase();
  return ext !== undefined && PRECOMPRESSED_ATTACHMENT_EXTENSIONS.has(ext);
}

/** Splits `extraFiles` into the ones that still go through the gzip'd tar and the ones that don't. */
function partitionExtraFiles(files: readonly ArchiveExtraFile[] | undefined): {
  compressible: ArchiveExtraFile[];
  precompressed: ArchiveExtraFile[];
} {
  const compressible: ArchiveExtraFile[] = [];
  const precompressed: ArchiveExtraFile[] = [];
  for (const file of files ?? []) {
    (isPrecompressedAttachment(file.archiveName) ? precompressed : compressible).push(file);
  }
  return { compressible, precompressed };
}

const INTEGRITY_STATE_FILE_NAME = ".integrity-check-state.json";

/** How long a full `PRAGMA integrity_check` stays trusted before the next backup re-runs it. */
export const INTEGRITY_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IntegrityCheckState {
  readonly lastIntegrityCheckAt: string | null;
}

/**
 * Where the weekly integrity-check cadence lives between runs. A sidecar next
 * to the archives themselves, not a field read out of the last archive's
 * manifest — reading that back would mean extracting a multi-gigabyte archive
 * just to learn a timestamp, which is exactly the cost this feature exists to
 * avoid. Missing or unreadable reads as "never run", which is always due.
 */
export async function readIntegrityState(backupsDir: string): Promise<IntegrityCheckState> {
  try {
    const raw = await readFile(path.join(backupsDir, INTEGRITY_STATE_FILE_NAME), "utf8");
    const parsed = JSON.parse(raw) as { lastIntegrityCheckAt?: unknown };
    return {
      lastIntegrityCheckAt: typeof parsed.lastIntegrityCheckAt === "string" ? parsed.lastIntegrityCheckAt : null,
    };
  } catch {
    return { lastIntegrityCheckAt: null };
  }
}

export async function writeIntegrityState(backupsDir: string, lastIntegrityCheckAt: string): Promise<void> {
  await writeFile(path.join(backupsDir, INTEGRITY_STATE_FILE_NAME), JSON.stringify({ lastIntegrityCheckAt }), {
    mode: 0o600,
  });
}

export function isFullIntegrityCheckDue(lastIntegrityCheckAt: string | null, now: Date): boolean {
  if (!lastIntegrityCheckAt) return true;
  const last = new Date(lastIntegrityCheckAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= INTEGRITY_CHECK_INTERVAL_MS;
}

/**
 * Resolves the backup worker's entry point. A packaged/dev-built install has
 * `backup-worker.cjs` bundled beside this module's own compiled output
 * (apps/desktop/scripts/build.mjs) — forked directly, no loader needed. Under
 * vitest/tsx, only the `.ts` source exists at that path, so it is forked
 * through tsx's ESM loader instead. Either way this stays a real, working
 * off-thread path rather than one only exercised in production.
 */
function resolveWorkerEntry(): { modulePath: string; execArgv: string[] } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const built of ["backup-worker.cjs", "backup-worker.js"]) {
    const candidate = path.join(here, built);
    if (existsSync(candidate)) return { modulePath: candidate, execArgv: [] };
  }
  return { modulePath: path.join(here, "backup-worker.ts"), execArgv: ["--import", "tsx"] };
}

/**
 * Runs one backup job in a forked child process and awaits its structured
 * result — the parent never swallows a worker failure, and never treats a
 * worker that exits without answering as success.
 */
export function spawnBackupWorker(job: BackupWorkerJob): Promise<BackupWorkerResult> {
  const { modulePath, execArgv } = resolveWorkerEntry();
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(modulePath, [], { execArgv });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let settled = false;
    const finish = (outcome: BackupWorkerResult | Error): void => {
      if (settled) return;
      settled = true;
      child.removeAllListeners();
      child.kill();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };

    child.once("message", (message: BackupWorkerResult) => finish(message));
    child.once("error", (err) => finish(err));
    child.once("exit", (code) => {
      finish(new Error(`Backup worker exited unexpectedly (code ${code}) before reporting a result.`));
    });

    child.send(job);
  });
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
   * ONE CALLER, and it must stay that way: `portable-export.ts`, which writes
   * into a private staging directory, encrypts the result under the operator's
   * passphrase and deletes the readable copy. It used to be passed on every
   * scheduled backup, which left the shop's whole books in the clear in the
   * folder people carry out on a USB stick.
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
  /**
   * Lets the VACUUM INTO copy itself run off this process too, not just the
   * hashing/archiving/verification after it: the backup worker opens its OWN
   * connection to `sqlite`'s file with this same key, through the SAME
   * `better-sqlite3-multiple-ciphers` driver every other connection in this
   * install uses (encrypted-database.ts's `cipherDriver`) — never a driver
   * chosen by the caller, since a driver reference cannot cross a process
   * boundary. Raw 32-byte lowercase-hex key, the tenant's actual key, never a
   * passphrase. Omitted, the copy still runs in THIS process against the
   * already-open `sqlite` connection, exactly as before — the only shape that
   * works when `sqlite` is the sole place holding an already-keyed connection.
   */
  cipher?: { readonly key: string };
  schemaVersion?: number;
  /** Goes into the file name, before the timestamp — see `preUpdateLabel`. */
  label?: string;
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
    cipher,
    schemaVersion,
    label,
    extraFiles,
    retentionPolicy = DEFAULT_RETENTION_POLICY,
    now = new Date(),
  } = params;

  // 0700, because this directory is the whole of the shop's books and it lives
  // outside userData so an uninstall cannot take it. On a shared shop PC the
  // default umask leaves it world-readable, which makes every other protection
  // in this module decorative.
  await mkdir(backupsDir, { recursive: true, mode: 0o700 });

  const tmpDir = path.join(backupsDir, ".tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmpDbPath = path.join(tmpDir, `snapshot-${now.getTime()}-${process.pid}.sqlite`);

  let snapshotJob: { dbPath: string; key: string } | null = null;

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
    } else if (encrypted && cipher) {
      // The copy itself moves off this process: the worker opens its own
      // connection to `sqlite.name` with this key and runs VACUUM INTO there
      // (docs/artifacts/audit-2026-09-07.md Q-2 — this is the O(db size) step
      // that used to be the majority of the freeze). `sqlite`'s own connection
      // is not touched here at all.
      snapshotJob = { dbPath: sqlite.name, key: cipher.key };
    } else if (encrypted) {
      // No independent key to open a second connection with, so this process
      // still has to be the one holding the pen: `sqlite` is already keyed and
      // that key cannot be read back out of it. `cipher` above is the escape
      // hatch once a caller can supply the key directly.
      await rm(tmpDbPath, { force: true });
      sqlite.exec(`VACUUM INTO ${sqlStringLiteral(tmpDbPath)}`);
      await assertSnapshotEncrypted(tmpDbPath);
    } else {
      await sqlite.backup(tmpDbPath);
    }

    const tables = countRows(sqlite);
    const archivePath = path.join(backupsDir, backupFileName(now, label));
    const { compressible, precompressed } = partitionExtraFiles(extraFiles);

    const integrityState = await readIntegrityState(backupsDir);
    const runFullIntegrityCheck = isFullIntegrityCheckDue(integrityState.lastIntegrityCheckAt, now);
    /*
     * Only an archive this process (or the worker, on its behalf) can OPEN can
     * be verified. A portable archive is plaintext, and an install with no
     * cipher was plaintext already; an encrypted-and-not-portable archive
     * needs a key, and pretending to verify one without it would be worse than
     * not trying — a green tick that checked nothing. `cipher` makes that key
     * available, so it joins the same condition `portable` already satisfies.
     */
    const verifiable = portable !== undefined || !encrypted || cipher !== undefined;
    const verifyCipherKey = portable ? null : (cipher?.key ?? null);

    const job: BackupWorkerJob = {
      archivePath,
      workDir: tmpDir,
      dbFilePath: tmpDbPath,
      snapshot: snapshotJob,
      manifestInput: {
        appVersion,
        reason,
        schemaVersion,
        createdAt: now.toISOString(),
        tables,
        lastIntegrityCheckAt: integrityState.lastIntegrityCheckAt,
      },
      extraFiles: compressible,
      looseAttachments: precompressed.map((f) => ({ sourcePath: f.sourcePath, archiveName: f.archiveName })),
      looseDir: `${archivePath}.attachments`,
      verifiable,
      runFullIntegrityCheck,
      verifyCipherKey,
    };

    /*
     * VERIFY BEFORE RETENTION, and before reporting success — done inside the
     * worker, but the ordering promise to the caller is unchanged: retention
     * only runs below, after the worker's result is in hand and only on
     * success. A worker failure is surfaced as a thrown error, never swallowed.
     */
    const result = await spawnBackupWorker(job);
    if (!result.ok) {
      throw new Error(result.error);
    }
    if (result.ranFullIntegrityCheck) {
      await writeIntegrityState(backupsDir, now.toISOString());
    }

    const removed = await pruneToRetention(backupsDir, retentionPolicy);

    return { archivePath, manifest: result.manifest, removed };
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
