import { app } from "electron";
import type Database from "better-sqlite3";
import { createBackup, runPreMigrationBackup } from "../backup/index.js";
import { readRemoteBackupConfig } from "../backup/remote-config.js";
import { syncBackupToRemote } from "../backup/remote-backup.js";
import { defaultBackupsDir } from "./env.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Runs the pre-migration backup, then the migration step, with a
 * rollback-to-backup path if the migration throws (docs/archive/plan.md §2.3).
 * Desktop has no migration runner yet (Phase 0 only creates tables
 * idempotently), so `migrate` defaults to a no-op — this is the seam a
 * later issue wires a real `drizzle-kit` migration runner into.
 */
export async function backupThenMigrate(params: {
  sqlite: Database.Database;
  backupsDir?: string;
  appVersion: string;
  /** True when `sqlite` is keyed — keeps the archive encrypted (backup-service.ts). */
  encrypted?: boolean;
  migrate?: () => Promise<void>;
}): Promise<void> {
  const backupsDir = params.backupsDir ?? defaultBackupsDir();
  const backup = await runPreMigrationBackup({
    sqlite: params.sqlite,
    backupsDir,
    appVersion: params.appVersion,
    encrypted: params.encrypted,
  });

  try {
    await (params.migrate ?? (async () => {}))();
  } catch (err) {
    console.error(
      `[backup] migration failed — pre-migration backup preserved at ${backup.archivePath}. ` +
        // This used to say "restore it via the backup module's restoreBackup()",
        // which is a function call, not a step a shop owner or their nephew can
        // perform — and at the time it was also the ONLY instruction the product
        // gave, because nothing called that function. There is a screen now.
        "Restore it from الإعدادات ← النسخ الاحتياطي والاستعادة before retrying.",
      err,
    );
    throw err;
  }
}

/**
 * Schedules a daily backup (in addition to the always-on pre-migration
 * hook) and one on app close, per docs/archive/plan.md §3.7's "on every launch,
 * before every migration, and on a configurable schedule (default daily +
 * on app close)". Returns a disposer to clear the interval/listener.
 */
/**
 * Sends a finished archive to the shop's bucket, when one is configured.
 *
 * Non-fatal in every direction: no destination configured is the normal case, a
 * misconfigured one is reported once, and a failed upload never touches the
 * local archive that has already been written. See backup/remote-config.ts for
 * what an online copy does and does not protect against.
 */
async function copyOffMachine(archivePath: string, dbPath: string): Promise<void> {
  const setup = await readRemoteBackupConfig(dbPath);
  if (!setup.configured) {
    if ("error" in setup && setup.error) console.warn(`[backup] online backup not used — ${setup.error}`);
    return;
  }
  const outcome = await syncBackupToRemote(setup.config, archivePath);
  if (outcome.uploaded.ok) {
    console.log(
      `[backup] uploaded ${outcome.uploaded.key}` +
        (outcome.pruned.length ? ` (pruned ${outcome.pruned.length} older remote copies)` : ""),
    );
    return;
  }
  console.error(
    `[backup] ONLINE COPY FAILED for ${outcome.uploaded.key}` +
      (outcome.uploaded.status ? ` (HTTP ${outcome.uploaded.status})` : "") +
      `: ${outcome.uploaded.error ?? "unknown"}. The local backup was still written.`,
  );
}

export function scheduleBackups(params: {
  sqlite: Database.Database;
  backupsDir?: string;
  appVersion: string;
  /** True when `sqlite` is keyed — keeps the archive encrypted (backup-service.ts). */
  encrypted?: boolean;
  /** Where the online-backup destination is read from (beside the database). */
  dbPath: string;
}): () => void {
  const backupsDir = params.backupsDir ?? defaultBackupsDir();
  const run = (reason: "scheduled" | "on-close") =>
    createBackup({
      sqlite: params.sqlite,
      backupsDir,
      appVersion: params.appVersion,
      reason,
      encrypted: params.encrypted,
    })
      .then((result) => copyOffMachine(result.archivePath, params.dbPath))
      .catch((err: unknown) => console.error(`[backup] ${reason} backup failed`, err));

  const interval = setInterval(() => void run("scheduled"), ONE_DAY_MS);
  const onWillQuit = () => void run("on-close");
  app.on("will-quit", onWillQuit);

  return () => {
    clearInterval(interval);
    app.removeListener("will-quit", onWillQuit);
  };
}
