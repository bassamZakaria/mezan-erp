import { app, BrowserWindow } from "electron";
import Database from "better-sqlite3";
import { createBackend, type BackendHandle } from "@mezan/backend";
import { SeatSessionRegistry } from "@mezan/domain";
import { registerHonoOverIpc, registerPrintToPdfOverIpc } from "./ipc.js";
import { createWindow } from "./window.js";
import { initAutoUpdater } from "./updater.js";
import { backupThenMigrate, scheduleBackups } from "./backup-hooks.js";
import { defaultDbPath, isDev, rendererRoot } from "./env.js";
import { registerRendererScheme, serveRenderer, shouldServeRenderer } from "./renderer-protocol.js";
import { resolveDesktopEntitlements } from "./entitlements.js";
import { startLanHost, type LanHostHandle } from "./lan-host.js";

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

app.whenReady().then(async () => {
  if (shouldServeRenderer()) serveRenderer(rendererRoot());

  const dbPath = isDev() ? ":memory:" : defaultDbPath();
  // Tells the seed whether this is a real install: a packaged build must not
  // create its fallback admin with the published demo PIN (see seed.ts).
  process.env["MEZAN_PACKAGED"] = app.isPackaged ? "1" : "0";

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
  registerHonoOverIpc(backend.app);
  registerPrintToPdfOverIpc();
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
