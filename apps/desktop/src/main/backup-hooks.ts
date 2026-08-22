import { app } from "electron";
import type Database from "better-sqlite3";
import { createBackup, runPreMigrationBackup } from "../backup/index.js";
import { defaultBackupsDir } from "./env.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Runs the pre-migration backup, then the migration step, with a
 * rollback-to-backup path if the migration throws (docs/plan.md §2.3).
 * Desktop has no migration runner yet (Phase 0 only creates tables
 * idempotently), so `migrate` defaults to a no-op — this is the seam a
 * later issue wires a real `drizzle-kit` migration runner into.
 */
export async function backupThenMigrate(params: {
  sqlite: Database.Database;
  backupsDir?: string;
  appVersion: string;
  migrate?: () => Promise<void>;
}): Promise<void> {
  const backupsDir = params.backupsDir ?? defaultBackupsDir();
  const backup = await runPreMigrationBackup({
    sqlite: params.sqlite,
    backupsDir,
    appVersion: params.appVersion,
  });

  try {
    await (params.migrate ?? (async () => {}))();
  } catch (err) {
    console.error(
      `[backup] migration failed — pre-migration backup preserved at ${backup.archivePath}. ` +
        "Restore it via the backup module's restoreBackup() before retrying.",
      err,
    );
    throw err;
  }
}

/**
 * Schedules a daily backup (in addition to the always-on pre-migration
 * hook) and one on app close, per docs/plan.md §3.7's "on every launch,
 * before every migration, and on a configurable schedule (default daily +
 * on app close)". Returns a disposer to clear the interval/listener.
 */
export function scheduleBackups(params: {
  sqlite: Database.Database;
  backupsDir?: string;
  appVersion: string;
}): () => void {
  const backupsDir = params.backupsDir ?? defaultBackupsDir();
  const run = (reason: "scheduled" | "on-close") =>
    createBackup({ sqlite: params.sqlite, backupsDir, appVersion: params.appVersion, reason }).catch(
      (err: unknown) => console.error(`[backup] ${reason} backup failed`, err),
    );

  const interval = setInterval(() => void run("scheduled"), ONE_DAY_MS);
  const onWillQuit = () => void run("on-close");
  app.on("will-quit", onWillQuit);

  return () => {
    clearInterval(interval);
    app.removeListener("will-quit", onWillQuit);
  };
}
