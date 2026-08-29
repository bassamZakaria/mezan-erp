import type Database from "better-sqlite3";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { buildManifest, countRows, serializeManifest, type BackupReason } from "./manifest.js";
import { sha256File } from "./checksum.js";
import { createArchive, type ArchiveExtraFile } from "./archive.js";
import { applyRetention, DEFAULT_RETENTION_POLICY, type RetentionPolicy } from "./retention.js";

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

/**
 * Creates one backup: SQLite's online backup API (`better-sqlite3`'s
 * `.backup()`, which wraps SQLite's Online Backup API) copies a
 * transactionally-consistent snapshot of the *live* database — safe to run
 * against a WAL database mid-write, unlike a raw file copy (docs/archive/plan.md
 * §3.7). That snapshot + a manifest (schema version, app version, row
 * counts, checksum) are packaged into one archive, then GFS retention prunes
 * `backupsDir` down to the configured policy.
 */
export async function createBackup(params: {
  sqlite: Database.Database;
  backupsDir: string;
  appVersion: string;
  reason: BackupReason;
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
    await sqlite.backup(tmpDbPath);

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
