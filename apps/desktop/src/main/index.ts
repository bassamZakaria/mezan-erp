import { app, BrowserWindow } from "electron";
import Database from "better-sqlite3";
import { createBackend, takeSeededAdminSecrets, type BackendHandle } from "@mezan/backend";
import { SeatSessionRegistry } from "@mezan/domain";
import { registerHonoOverIpc, registerPrintToPdfOverIpc } from "./ipc.js";
import { registerRestoreOverIpc } from "./restore-ipc.js";
import { createWindow, hardenWebContents } from "./window.js";
import { initAutoUpdater } from "./updater.js";
import { backupThenMigrate, scheduleBackups } from "./backup-hooks.js";
import { defaultBackupsDir, defaultDbPath, isDev, rendererEntry, rendererRoot } from "./env.js";
import { registerRendererScheme, serveRenderer, shouldServeRenderer } from "./renderer-protocol.js";
import { resolveDesktopEntitlements } from "./entitlements.js";
import { startLanHost, type LanHostHandle } from "./lan-host.js";
import {
  clearRecoveryPinIfClaimed,
  resetSeedAdminPin,
  wantsAdminReset,
  writeRecoveryPin,
} from "./recovery.js";

/**
 * Electron main process entry point.
 *
 * The architectural point this proves — and that the rest of Phase 0 builds
 * on — is that there is NO HTTP server and NO port on desktop. The renderer
 * marshals a request over IPC (preload/index.ts + main/ipc.ts); the main
 * process calls the SAME Hono app via `app.fetch()` in-process and returns
 * the response. See docs/archive/plan.md §2.2.
 *
 * This module has real side effects on import (`app.whenReady()`, window
 * creation) and is only ever loaded by the actual Electron binary — never
 * by vitest or `tsc --noEmit`. It exists to be typechecked, not executed,
 * outside of a real Electron runtime; runtime-only behaviour (backups,
 * updater, window loading) is delegated to modules that are themselves
 * simple enough to eyeball, with their pure logic (backup/**) unit-tested
 * headlessly instead.
 */

let backend: BackendHandle | undefined;
let backupConn: Database.Database | undefined;
let disposeBackupSchedule: (() => void) | undefined;
let lanHost: LanHostHandle | undefined;

// Before whenReady, not inside it: Chromium reads the scheme registry once
// during startup, and `app://` registered later would have no origin — the
// exact failure this scheme exists to avoid.
registerRendererScheme();

/**
 * The navigation posture, for EVERY frame — not just the main window.
 *
 * `createWindow` bound `will-navigate` and `setWindowOpenHandler` to the one
 * `webContents` it had just created, so any other frame the app ever produces
 * started on Electron's defaults. Registered before `whenReady` because a
 * `web-contents-created` listener added after a frame exists never sees it.
 */
app.on("web-contents-created", (_event, contents) => {
  hardenWebContents(contents, rendererEntry().url);
});

app.whenReady().then(async () => {
  const dbPath = isDev() ? ":memory:" : defaultDbPath();
  // Tells the seed whether this is a real install: a packaged build must not
  // create its fallback admin with the published demo PIN (see seed.ts).
  process.env["MEZAN_PACKAGED"] = app.isPackaged ? "1" : "0";

  /**
   * `--reset-admin`, and it runs before anything else opens the database.
   *
   * Authorised by filesystem access to the database directory, which is the
   * honest bar: that directory holds an unencrypted SQLite file with every
   * customer, price and salary in it, so somebody who can run this flag could
   * already read everything it protects. What it buys is the install that would
   * otherwise be lost — a random packaged PIN nobody wrote down, or a backup
   * restored onto replacement hardware by somebody who never knew the old one.
   */
  if (wantsAdminReset()) {
    if (isDev()) {
      console.error("[recovery] --reset-admin needs a packaged build with a database on disk.");
      app.exit(1);
      return;
    }
    const reset = await resetSeedAdminPin(dbPath).catch((err: unknown) => {
      console.error("[recovery] --reset-admin failed", err);
      return null;
    });
    if (!reset) {
      console.error(`[recovery] no seeded administrator account found in ${dbPath}.`);
      app.exit(1);
      return;
    }
    console.log(
      `\nرمز الدخول الجديد لحساب المدير / New administrator PIN: ${reset.pin}\n` +
        `${reset.reactivated ? "أُعيد تفعيل الحساب. / The account was reactivated.\n" : ""}` +
        `كُتب أيضاً في / Also written to: ${reset.recoveryFile}\n`,
    );
    app.exit(0);
    return;
  }

  if (shouldServeRenderer()) serveRenderer(rendererRoot());

  if (!isDev()) {
    // A dedicated connection to the same on-disk file, used only for
    // SQLite's online backup API. Kept separate from the UnitOfWork's
    // connection (WAL mode supports concurrent readers + one writer just
    // fine) rather than reaching into persistence internals, so the backup
    // module only ever depends on a plain better-sqlite3 `Database`, never
    // on @mezan/persistence's repository abstraction.
    backupConn = new Database(dbPath);
    backupConn.pragma("busy_timeout = 5000");

    // Pre-migration auto-backup (docs/archive/plan.md §2.3/§3.7). No real migration
    // runner exists yet, so `migrate` is a no-op today — see backup-hooks.ts.
    await backupThenMigrate({ sqlite: backupConn, appVersion: app.getVersion() });
    disposeBackupSchedule = scheduleBackups({ sqlite: backupConn, appVersion: app.getVersion() });
  }

  // Same shared Hono app both mounts serve (docs/archive/plan.md §2.2): the IPC
  // bridge below (no port, host-local only) and, when the license carries
  // `lan.multi_till`, a LAN-visible socket for other tills/tablets in the
  // shop (§6.3.3). `/lan/sessions` seat enforcement lives on this one app
  // instance in both cases — see @mezan/api's lan/routes.ts.
  const entitlements = resolveDesktopEntitlements();
  const seatRegistry = new SeatSessionRegistry(entitlements.seats);
  // `createBackend`, NOT `createApp`. This is the composition that carries the
  // session resolver, the seeded tenant and the real `/auth` routes; building
  // the app directly left every route resolving its caller from the
  // `x-permissions` header — on the one edition that binds a LAN socket, so
  // any device on the shop wifi could send `x-permissions: *`.
  backend = await createBackend({
    dbPath,
    lan: { resolveEntitlements: () => entitlements, registry: seatRegistry },
  });

  if (!isDev()) {
    /**
     * The seeded admin's credentials, printed exactly once, where a human can
     * read them.
     *
     * A packaged build's seed PIN is random (seed.ts), and it used to go
     * nowhere: the owner met a login screen asking for a PIN that had never
     * been shown to anybody, on an install with no other account and no reset
     * route. `takeSeededAdminSecrets()` is a one-shot read, so this writes the
     * file only on the launch that actually seeded the tenant — never on the
     * ones after it, and never over a PIN the owner has since changed.
     */
    const seeded = takeSeededAdminSecrets();
    if (seeded?.generated) {
      const target = await writeRecoveryPin(dbPath, seeded.pin, "first-run").catch(
        (err: unknown) => {
          console.error("[recovery] could not write the recovery file", err);
          return null;
        },
      );
      // The PIN also goes to stdout, because the recovery file is unreachable
      // on the failure that matters most — a first launch that cannot write to
      // its own data directory.
      console.log(
        `[recovery] first-run administrator PIN: ${seeded.pin}` +
          (target ? ` (also written to ${target})` : " (recovery file NOT written)"),
      );
    } else {
      // Cheap, and it runs on every launch: the file is a live credential and
      // stops being needed the moment the owner has an account of their own.
      await clearRecoveryPinIfClaimed(dbPath).catch((err: unknown) => {
        console.warn("[recovery] could not clear the recovery file", err);
        return false;
      });
    }
  }

  registerHonoOverIpc(backend.app);
  registerPrintToPdfOverIpc();
  // The verified restore in backup/restore-service.ts had no caller at all —
  // no IPC, no menu, no screen — so the product shipped backups nobody could
  // put back. These three channels are what the settings screen drives.
  registerRestoreOverIpc({
    dbPath,
    backupsDir: defaultBackupsDir(),
    appVersion: app.getVersion(),
    sqlite: () => backupConn,
    closeLiveConnections: () => {
      disposeBackupSchedule?.();
      disposeBackupSchedule = undefined;
      backend?.close();
      backend = undefined;
      backupConn?.close();
      backupConn = undefined;
    },
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
    sessions: backend.sessions,
  });
  lanHost = startLanHost({ app: backend.app, entitlements });

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
  backend?.close();
});
