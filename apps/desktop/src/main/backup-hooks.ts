import { app } from "electron";
import type Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION, readSchemaVersion } from "@mezan/persistence";
import {
  abortDrill,
  copyToSecondTarget,
  createBackup,
  hasArchive,
  isDrillDue,
  sweepBackupScratch,
  preUpdateLabel,
  runPreMigrationBackup,
  runRestoreDrill,
  withBackupLock,
} from "../backup/index.js";
import { DrillTrigger } from "../shared/ipc-contract.js";
import { defaultBackupsDir } from "./env.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LAUNCH_DRILL_DELAY_MS = 10 * 60 * 1000;

/**
 * How long the app waits for the on-close backup before quitting anyway.
 *
 * A bound rather than "however long it takes", because the alternative to a
 * timeout here is an app that will not close — and a shop that force-quits it
 * gets no backup AND a bad reputation. Whatever the copy was doing is logged,
 * so a machine that keeps hitting this is diagnosable rather than merely slow.
 */
const ON_CLOSE_BACKUP_TIMEOUT_MS = 120_000;

/**
 * Is there actually a schema change to protect against on this launch?
 *
 * `PRAGMA user_version` is stamped by @mezan/persistence on open, so the stored
 * value is what the LAST build wrote. Equal means this launch changes nothing
 * about the shape of the file, and a full copy of the database before it would
 * be a cold start of O(database size) — measured at ~1.1s per 88 MB, with no
 * window on screen — for no protection at all.
 */
export function isMigrationPending(
  sqlite: Database.Database,
  currentSchemaVersion: number = CURRENT_SCHEMA_VERSION,
): boolean {
  return readSchemaVersion(sqlite) < currentSchemaVersion;
}

/**
 * Runs the pre-migration backup, then the migration step, with a
 * rollback-to-backup path if the migration throws (docs/archive/plan.md §2.3).
 * Desktop has no migration runner yet (Phase 0 only creates tables
 * idempotently), so `migrate` defaults to a no-op — this is the seam a
 * later issue wires a real `drizzle-kit` migration runner into.
 *
 * IT DOES NOT RUN ON EVERY LAUNCH ANY MORE. It used to, unconditionally, before
 * the window existed: every cold start copied, hashed, tarred, extracted and
 * integrity-checked the whole database with nothing on screen, which at 2 GB is
 * a two-to-four minute dock icon and a force-quit. The backup is what protects
 * a schema change, so it runs when there IS one — and `skipped` says so rather
 * than pretending a backup was taken.
 */
export async function backupThenMigrate(params: {
  sqlite: Database.Database;
  backupsDir?: string;
  appVersion: string;
  /** True when `sqlite` is keyed — keeps the archive encrypted (backup-service.ts). */
  encrypted?: boolean;
  /**
   * Raw tenant key. Passing it lets the VACUUM INTO copy run in the backup
   * worker on its own connection instead of on this process's event loop —
   * see `createBackup`'s own `cipher` note. Omitted, the copy stays here.
   */
  cipher?: { readonly key: string };
  migrate?: () => Promise<void>;
  /**
   * Forces the decision. Omitted, it is read from the database's own stamp.
   * Passing `true` is how a caller that already knows (a restore, a conversion)
   * says so without a second read.
   */
  migrationPending?: boolean;
  /** Called once, before the copy starts, so the window can show progress. */
  onBackupStart?: () => void;
}): Promise<{ skipped: boolean; archivePath: string | null }> {
  const pending = params.migrationPending ?? isMigrationPending(params.sqlite);
  if (!pending) {
    await (params.migrate ?? (async () => {}))();
    return { skipped: true, archivePath: null };
  }

  const backupsDir = params.backupsDir ?? defaultBackupsDir();
  params.onBackupStart?.();
  const backup = await runPreMigrationBackup({
    sqlite: params.sqlite,
    backupsDir,
    appVersion: params.appVersion,
    encrypted: params.encrypted,
    cipher: params.cipher,
    // Named so «الرجوع إلى ما قبل التحديث» can find exactly this archive,
    // rather than an owner guessing which timestamp came before the version
    // that broke their books.
    label: preUpdateLabel(params.appVersion),
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

  return { skipped: false, archivePath: backup.archivePath };
}

/**
 * Schedules a daily backup (in addition to the pre-update hook) and one on app
 * close, per docs/archive/plan.md §3.7's "on every launch, before every
 * migration, and on a configurable schedule (default daily + on app close)".
 * Returns a disposer to clear the interval/listener.
 *
 * EVERY ARCHIVE IS ENCRYPTED. There is no `portable` option here any more: it
 * used to be passed unconditionally by the call site, which rekeyed each daily
 * archive to plaintext and left the shop's complete books readable by anyone
 * who picked up the USB stick. Portability is answered instead by an explicit
 * «تصدير نسخة قابلة للنقل» that asks for a passphrase and encrypts the archive
 * under it (backup/portable-export.ts).
 */
export function scheduleBackups(params: {
  sqlite: Database.Database;
  backupsDir?: string;
  appVersion: string;
  /** True when `sqlite` is keyed — keeps the archive encrypted (backup-service.ts). */
  encrypted?: boolean;
  /** Raw tenant key — moves the copy itself off this process. See `createBackup`. */
  cipher?: { readonly key: string };
  /** Bounded wait for the on-close copy. Injected by the test; never by production. */
  onCloseTimeoutMs?: number;
}): () => void {
  const backupsDir = params.backupsDir ?? defaultBackupsDir();
  const timeoutMs = params.onCloseTimeoutMs ?? ON_CLOSE_BACKUP_TIMEOUT_MS;
  let closing = false;
  const scratchSwept = sweepBackupScratch(backupsDir).catch((err: unknown) =>
    console.error("[backup] could not clear leftover drill/import scratch", err),
  );
  const drillIfDue = async (): Promise<void> => {
    await scratchSwept;
    if (!(await hasArchive(backupsDir)) || !(await isDrillDue(backupsDir))) return;
    await runRestoreDrill({
      backupsDir,
      cipherKey: params.cipher?.key ?? null,
      appSchemaVersion: CURRENT_SCHEMA_VERSION,
      trigger: DrillTrigger.Scheduled,
    });
  };
  const run = async (reason: "scheduled" | "on-close"): Promise<void> => {
    try {
      const result = await withBackupLock(() =>
        createBackup({
          sqlite: params.sqlite,
          backupsDir,
          appVersion: params.appVersion,
          reason,
          encrypted: params.encrypted,
          cipher: params.cipher,
        }),
      );
      await copyToSecondTarget(backupsDir, result.archivePath);
    } catch (err) {
      console.error(`[backup] ${reason} backup failed`, err);
      return;
    }
    if (reason === "scheduled" && !closing) {
      await drillIfDue().catch((err: unknown) => console.error("[backup] weekly restore drill failed to run", err));
    }
  };

  const interval = setInterval(() => void run("scheduled"), ONE_DAY_MS);
  // Verify-and-report only: a shop that closes every evening never reaches the
  // 24-hour tick, so the weekly drill would otherwise never run on it.
  const launchDrill = setTimeout(() => {
    if (closing) return;
    void drillIfDue().catch((err: unknown) => console.error("[backup] restore drill failed to run", err));
  }, LAUNCH_DRILL_DELAY_MS);
  launchDrill.unref();

  /**
   * THE ON-CLOSE BACKUP, AWAITED.
   *
   * It was `void run("on-close")` on `will-quit`: the process exited while the
   * copy was still being written, so the nightly close backup effectively never
   * completed. `before-quit` — not `will-quit` — because the teardown that
   * closes this very connection is registered on `will-quit` in main/index.ts,
   * and `preventDefault()` on `before-quit` stops the quit BEFORE that runs.
   * The second `app.quit()` below then goes all the way through.
   */
  const onBeforeQuit = (event: { preventDefault: () => void }): void => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    abortDrill();

    let timer: NodeJS.Timeout | undefined;
    const bounded = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.error(
          `[backup] the on-close backup did not finish within ${timeoutMs}ms — quitting anyway. ` +
            "The daily archive still stands; this machine's database is large enough that the " +
            "close backup should be reviewed.",
        );
        resolve();
      }, timeoutMs);
    });

    void Promise.race([run("on-close"), bounded]).finally(() => {
      if (timer) clearTimeout(timer);
      app.quit();
    });
  };
  app.on("before-quit", onBeforeQuit);

  return () => {
    clearInterval(interval);
    clearTimeout(launchDrill);
    abortDrill();
    app.removeListener("before-quit", onBeforeQuit);
  };
}
