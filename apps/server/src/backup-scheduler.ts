import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PlatformHandle } from "@mezan/backend";
import { openSqliteConnection } from "@mezan/persistence";
import type { TenantRouter } from "./tenant-router.js";

export const VERIFY_LOG_FILE_NAME = "verify.jsonl";

export enum BackupVerifyOutcome {
  Ok = "ok",
  Failed = "failed",
}

export interface BackupVerifyRecord {
  readonly at: string;
  readonly file: string;
  readonly outcome: BackupVerifyOutcome;
  readonly ms: number;
  readonly report: string;
}

const DEFAULT_KEEP = 12;

export interface RunBackupsOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  /** The platform data directory — backups land under `<dir>/backups/…`. */
  readonly dir: string;
  readonly now?: () => Date;
  /** How many backups to keep per folder, newest first. Defaults to 12. */
  readonly keep?: number;
}

function isoSafeTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-");
}

/**
 * Writes one backup into `folder` at `<stamp>.sqlite`, via a `.tmp` sibling
 * renamed into place on success — a crash mid-copy leaves only a stray `.tmp`
 * file behind, never a truncated file at the name a restore would pick up.
 */
async function writeOneBackup(
  backupTo: (destination: string) => Promise<void>,
  folder: string,
  stamp: string,
): Promise<string> {
  mkdirSync(folder, { recursive: true });
  const finalPath = path.join(folder, `${stamp}.sqlite`);
  const tmpPath = `${finalPath}.tmp`;
  await backupTo(tmpPath);
  renameSync(tmpPath, finalPath);
  return finalPath;
}

// The COPY is opened, never the backup itself: opening a SQLite file can write to it.
export async function verifyBackupFile(backupPath: string, now: Date = new Date()): Promise<BackupVerifyRecord> {
  const started = Date.now();
  const sandbox = await mkdtemp(path.join(tmpdir(), "mezan-backup-verify-"));
  let outcome = BackupVerifyOutcome.Failed;
  let report: string;
  try {
    const copy = path.join(sandbox, "restore.sqlite");
    await copyFile(backupPath, copy);
    const { sqlite } = openSqliteConnection(copy);
    try {
      const rows = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
      report = rows.map((r) => r.integrity_check).join("; ");
      if (report === "ok") outcome = BackupVerifyOutcome.Ok;
    } finally {
      sqlite.close();
    }
  } catch (err) {
    report = err instanceof Error ? err.message : String(err);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  const record: BackupVerifyRecord = {
    at: now.toISOString(),
    file: path.basename(backupPath),
    outcome,
    ms: Date.now() - started,
    report,
  };
  appendFileSync(path.join(path.dirname(backupPath), VERIFY_LOG_FILE_NAME), `${JSON.stringify(record)}\n`);
  return record;
}

/** Deletes every backup in `folder` older than the newest `keep` (by filename, which sorts with the timestamp). */
function pruneOldBackups(folder: string, keep: number): void {
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".sqlite"))
    .sort();
  const excess = files.length - keep;
  for (let i = 0; i < excess; i += 1) {
    rmSync(path.join(folder, files[i]!));
  }
}

/**
 * Snapshots the platform database and every currently OPEN tenant backend
 * (task C2 — docs/superpowers/plans/2026-09-14-saas-slice-c-deploy.md). A
 * tenant whose backend is idle-evicted or never opened is deliberately
 * skipped: its file is at rest on disk, not being written to, so a filesystem-
 * level backup covers it — running the in-app backup would only cost an
 * `open` this sweep has no other reason to make.
 */
export async function runBackups(options: RunBackupsOptions): Promise<void> {
  const now = options.now ?? (() => new Date());
  const keep = options.keep ?? DEFAULT_KEEP;
  const stamp = isoSafeTimestamp(now());

  const failures: string[] = [];
  const verify = async (file: string): Promise<void> => {
    const record = await verifyBackupFile(file, now());
    if (record.outcome !== BackupVerifyOutcome.Ok) failures.push(`${file}: ${record.report}`);
  };

  const platformFolder = path.join(options.dir, "backups", "platform");
  await verify(await writeOneBackup((destination) => options.platform.backupTo(destination), platformFolder, stamp));
  pruneOldBackups(platformFolder, keep);

  for (const code of options.router.openTenants()) {
    const backend = await options.router.backendFor(code);
    const folder = path.join(options.dir, "backups", code);
    await verify(await writeOneBackup((destination) => backend.backupTo(destination), folder, stamp));
    pruneOldBackups(folder, keep);
  }

  if (failures.length > 0) {
    throw new Error(`backup verification failed: ${failures.join(" | ")}`);
  }
}

export interface StartBackupTimerOptions extends RunBackupsOptions {
  readonly intervalMs: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Runs `runBackups` immediately, then again on every `intervalMs` tick,
 * `unref`d so an idle process can still exit. Matches the shape
 * `apps/server/src/cloud-app.ts`'s `options.backups.start()` seam expects.
 * The returned `stop` resolves once any in-flight run has settled, so
 * callers (and tests) can know no further writes are coming.
 */
export function startBackupTimer(options: StartBackupTimerOptions): () => Promise<void> {
  let current: Promise<void> = Promise.resolve();
  const run = () => {
    current = runBackups(options).catch((error: unknown) => options.onError?.(error));
  };
  run();

  const timer = setInterval(run, options.intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    return current;
  };
}

export interface BackupScheduler {
  start(): () => Promise<void>;
}

/** Wraps `startBackupTimer` in the `{ start(): () => void }` shape `createCloudApp`'s `options.backups` seam is typed as. */
export function createBackupScheduler(options: StartBackupTimerOptions): BackupScheduler {
  return {
    start: () => startBackupTimer(options),
  };
}
