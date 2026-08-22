import { app, BrowserWindow } from "electron";
import Database from "better-sqlite3";
import { createApp } from "@mezan/api";
import { SeatSessionRegistry } from "@mezan/domain";
import { createSqliteUnitOfWork, type SqliteUnitOfWorkHandle } from "@mezan/persistence";
import { registerHonoOverIpc, registerPrintToPdfOverIpc } from "./ipc.js";
import { createWindow } from "./window.js";
import { initAutoUpdater } from "./updater.js";
import { backupThenMigrate, scheduleBackups } from "./backup-hooks.js";
import { defaultDbPath, isDev } from "./env.js";
import { resolveDesktopEntitlements } from "./entitlements.js";
import { startLanHost, type LanHostHandle } from "./lan-host.js";

/**
 * Electron main process entry point.
 *
 * The architectural point this proves — and that the rest of Phase 0 builds
 * on — is that there is NO HTTP server and NO port on desktop. The renderer
 * marshals a request over IPC (preload/index.ts + main/ipc.ts); the main
 * process calls the SAME Hono app via `app.fetch()` in-process and returns
 * the response. See docs/plan.md §2.2.
 *
 * This module has real side effects on import (`app.whenReady()`, window
 * creation) and is only ever loaded by the actual Electron binary — never
 * by vitest or `tsc --noEmit`. It exists to be typechecked, not executed,
 * outside of a real Electron runtime; runtime-only behaviour (backups,
 * updater, window loading) is delegated to modules that are themselves
 * simple enough to eyeball, with their pure logic (backup/**) unit-tested
 * headlessly instead.
 */

let uow: SqliteUnitOfWorkHandle | undefined;
let backupConn: Database.Database | undefined;
let disposeBackupSchedule: (() => void) | undefined;
let lanHost: LanHostHandle | undefined;

app.whenReady().then(async () => {
  const dbPath = isDev() ? ":memory:" : defaultDbPath();
  uow = createSqliteUnitOfWork(dbPath);

  if (!isDev()) {
    // A dedicated connection to the same on-disk file, used only for
    // SQLite's online backup API. Kept separate from the UnitOfWork's
    // connection (WAL mode supports concurrent readers + one writer just
    // fine) rather than reaching into persistence internals, so the backup
    // module only ever depends on a plain better-sqlite3 `Database`, never
    // on @mezan/persistence's repository abstraction.
    backupConn = new Database(dbPath);

    // Pre-migration auto-backup (docs/plan.md §2.3/§3.7). No real migration
    // runner exists yet, so `migrate` is a no-op today — see backup-hooks.ts.
    await backupThenMigrate({ sqlite: backupConn, appVersion: app.getVersion() });
    disposeBackupSchedule = scheduleBackups({ sqlite: backupConn, appVersion: app.getVersion() });
  }

  // Same shared Hono app both mounts serve (docs/plan.md §2.2): the IPC
  // bridge below (no port, host-local only) and, when the license carries
  // `lan.multi_till`, a LAN-visible socket for other tills/tablets in the
  // shop (§6.3.3). `/lan/sessions` seat enforcement lives on this one app
  // instance in both cases — see @mezan/api's lan/routes.ts.
  const entitlements = resolveDesktopEntitlements();
  const seatRegistry = new SeatSessionRegistry(entitlements.seats);
  const honoApp = createApp(uow, {
    lan: { resolveEntitlements: () => entitlements, registry: seatRegistry },
  });
  registerHonoOverIpc(honoApp);
  registerPrintToPdfOverIpc();
  lanHost = startLanHost({ app: honoApp, entitlements });

  createWindow();
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  void lanHost?.close();
  disposeBackupSchedule?.();
  backupConn?.close();
  uow?.close();
});
