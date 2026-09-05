import { app, BrowserWindow, safeStorage } from "electron";
import Database from "better-sqlite3";
import { createBackend, takeSeededAdminSecrets, type BackendHandle } from "@mezan/backend";
import { SeatSessionRegistry } from "@mezan/domain";
import { registerHonoOverIpc, registerHonoOverLanClient, registerPrintToPdfOverIpc } from "./ipc.js";
import { readClientConfig, readPairingRequest, writeClientConfig, type ClientConfig } from "./client-config.js";
import { createLanClient, withSeatClaim } from "./lan-client.js";
import { registerClientBackupRefusalsOverIpc, registerRestoreOverIpc } from "./restore-ipc.js";
import { createWindow, hardenWebContents } from "./window.js";
import { registerAutoUpdater } from "./updater.js";
import { backupThenMigrate, scheduleBackups } from "./backup-hooks.js";
import { defaultBackupsDir, defaultDbPath, isDev, rendererEntry, rendererRoot } from "./env.js";
import { registerRendererScheme, serveRenderer, shouldServeRenderer } from "./renderer-protocol.js";
import { diagnoseDesktopEntitlements } from "./entitlements.js";
import { registerClientLicenceStatusOverIpc, registerLicenceStatusOverIpc } from "./licence-ipc.js";
import { loadDesktopLicense } from "./license-runtime.js";
import { startLanHost, type LanHostHandle } from "./lan-host.js";
import { createLanClientAuthorizer } from "./lan-authorization.js";
import { loadOrCreateLanTlsIdentity } from "./lan-tls.js";
import {
  clearRecoveryPinIfClaimed,
  resetSeedAdminPin,
  wantsAdminReset,
  writeRecoveryPin,
} from "./recovery.js";
import {
  electronSafeStorageKeyStore,
  keyCardFilePath,
  openEncryptedTenantDatabase,
  openTenantConnection,
  readDatabaseFileState,
  wantsKeyExport,
  wantsUnencryptedDatabase,
  writeKeyCard,
  type TenantCipher,
} from "./encrypted-database.js";
import { runPreMigrationBackup } from "../backup/index.js";

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
let cipher: TenantCipher | undefined;
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

/**
 * The whole of the client-machine startup.
 *
 * Notice what is NOT here, and that each absence is the point: no database, no
 * encryption key, no seed, no backup schedule, no LAN socket, no licence
 * resolution. A client holds nothing to protect, backs up nothing, and is
 * entitled to nothing on its own — the host's licence is what governs, and the
 * host enforces it on every request (main/lan-authorization.ts). Duplicating
 * any of that here would be a second source of truth for a fact that has one.
 *
 * The updater is likewise not started: a client and its host must run the same
 * version, and a client that updated itself independently would be talking to a
 * host it no longer matches. Updating the host first is a deliberate,
 * consultant-driven step, not something two machines negotiate.
 */
async function startAsLanClient(config: ClientConfig): Promise<void> {
  console.log(
    `[client] this machine is a Mezan CLIENT of ${config.hostUrl} ` +
      `(device ${config.deviceLabel}, pinned sha256=${config.fingerprintSha256})`,
  );
  if (shouldServeRenderer()) serveRenderer(rendererRoot());
  // EVERY channel the preload bridge exposes gets an answer here, not just the
  // ones a client can satisfy. An unregistered `ipcMain.handle` rejects, and the
  // renderer prints the rejection — the first live client run showed
  // "Error invoking remote method 'mezan:licence:status': No handler registered"
  // in English above an Arabic shell. A refusal with a reason is a screen; a
  // missing handler is a bug report shown to the shop.
  registerHonoOverLanClient(withSeatClaim(createLanClient({ config }), config));
  registerPrintToPdfOverIpc();
  registerClientLicenceStatusOverIpc(config);
  registerClientBackupRefusalsOverIpc(config.hostUrl);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.whenReady().then(async () => {
  const dbPath = isDev() ? ":memory:" : defaultDbPath();
  // Tells the seed whether this is a real install: a packaged build must not
  // create its fallback admin with the published demo PIN (see seed.ts).
  process.env["MEZAN_PACKAGED"] = app.isPackaged ? "1" : "0";

  /**
   * HOST OR CLIENT, and it is decided before anything opens, creates or seeds a
   * database — because on a client, none of that must happen at all.
   *
   * A client that fell through to the host path would open its own empty
   * `mezan.db`, seed its own chart of accounts, and present a Mezan that looks
   * entirely normal and holds none of the shop's data. Somebody would then work
   * in it for a day. That is why an unreadable client config stops the app
   * instead of defaulting either way (client-config.ts).
   */
  if (!isDev()) {
    // Pairing runs BEFORE the role is read, and exits: it is a provisioning
    // command, not a mode. Running it against a machine that already holds
    // books would be a mistake worth noticing, so it says what it found rather
    // than quietly repointing a host at somebody else's data.
    let pairing: ReturnType<typeof readPairingRequest>;
    try {
      pairing = readPairingRequest();
    } catch (err) {
      console.error(`[pair] ${err instanceof Error ? err.message : String(err)}`);
      app.exit(1);
      return;
    }
    if (pairing) {
      if ((await readDatabaseFileState(dbPath)) !== "absent") {
        console.error(
          `[pair] ${dbPath} already exists. A client holds no books of its own, so pairing this machine ` +
            "would leave that database orphaned. Move or delete it first if this machine really is to become a client.",
        );
        app.exit(1);
        return;
      }
      const config = await writeClientConfig(dbPath, pairing).catch((err: unknown) => {
        console.error("[pair] could not write the pairing", err);
        return null;
      });
      if (!config) {
        app.exit(1);
        return;
      }
      console.log(
        `[pair] this machine is now a Mezan CLIENT of ${config.hostUrl}\n` +
          `       device: ${config.deviceLabel} (${config.deviceId})\n` +
          `       pinned certificate: ${config.fingerprintSha256}\n` +
          `       Compare that fingerprint against the host's screen before you use it.`,
      );
      app.exit(0);
      return;
    }

    const role = await readClientConfig(dbPath);
    if (role.role === "unusable") {
      console.error(`[client] ${role.reason}`);
      console.error(
        "[client] Mezan will not start. Fix or delete client.json — deleting it makes this machine a HOST " +
          "with its own separate books, which is almost certainly not what you want on a machine that was a client.",
      );
      app.exit(1);
      return;
    }
    if (role.role === "client") {
      await startAsLanClient(role.config);
      return;
    }
  }

  /**
   * Encryption at rest, resolved BEFORE anything opens the database — the
   * `--reset-admin` recovery flag included, because on an encrypted install
   * opening the file by path with the plain driver only produces "file is not a
   * database".
   *
   * On a machine whose OS has no keyring this throws rather than falling back
   * to a plaintext key file (see encrypted-database.ts). The app does not start,
   * and says why. `--allow-unencrypted-database` is the operator's explicit,
   * logged way to run anyway; nothing takes that decision on their behalf.
   */
  if (!isDev()) {
    if (wantsUnencryptedDatabase()) {
      // The flag exists for a machine with no keyring, i.e. one that has never
      // encrypted anything. It cannot decrypt a database that already is, and
      // letting it try would surface as "file is not a database" — a corruption
      // message for an intact file, which is how books get thrown away.
      if ((await readDatabaseFileState(dbPath)) === "encrypted") {
        console.error(
          "[crypto] --allow-unencrypted-database was passed, but this database is already " +
            "encrypted. It can only be opened with its key; remove the flag, or restore a backup " +
            "taken before encryption was enabled.",
        );
        app.exit(1);
        return;
      }
      console.warn(
        "[crypto] --allow-unencrypted-database: the tenant database and every backup archive " +
          "will be written in plaintext. Anyone who copies mezan.db or the backups folder reads " +
          "your entire books.",
      );
    } else {
      try {
        const opened = await openEncryptedTenantDatabase({
          dbPath,
          keyStore: electronSafeStorageKeyStore(safeStorage),
          // The one-time safety copy, taken from the plaintext database before
          // a byte of it is touched, through the verified backup path.
          backupFirst: async (sqlite) =>
            (
              await runPreMigrationBackup({
                sqlite,
                backupsDir: defaultBackupsDir(),
                appVersion: app.getVersion(),
              })
            ).archivePath,
          exportKeyCard: wantsKeyExport(),
        });
        cipher = opened.connection;
        if (opened.converted) {
          console.log(
            "[crypto] converted the existing plaintext database to encrypted storage. " +
              `Pre-conversion safety copy (UNENCRYPTED — delete it once you trust this build): ${opened.backupArchivePath}`,
          );
        }
        if (opened.keyCardPath) {
          console.log(`[crypto] database encryption key written to ${opened.keyCardPath}`);
        }
        if (opened.keyCardPresent) {
          console.warn(
            `[crypto] ${keyCardFilePath(dbPath)} still holds this database's key in plain text. ` +
              "Copy it somewhere safe off this machine and delete the file — it is the only way to " +
              "open a backup on replacement hardware, and the only plaintext copy of the key anywhere.",
          );
        }
        if (wantsKeyExport()) {
          app.exit(0);
          return;
        }
      } catch (err) {
        console.error(
          "[crypto] the tenant database cannot be opened securely, so Mezan will not start.",
          err,
        );
        app.exit(1);
        return;
      }
    }
  }

  /**
   * `--reset-admin`, and it runs before anything else opens the database.
   *
   * Authorised by filesystem access to the database directory PLUS this
   * machine's sealed key, since the file itself is now encrypted. What it buys
   * is the install that would otherwise be lost — a random packaged PIN nobody
   * wrote down, or a backup restored onto replacement hardware by somebody who
   * never knew the old one.
   */
  if (wantsAdminReset()) {
    if (isDev()) {
      console.error("[recovery] --reset-admin needs a packaged build with a database on disk.");
      app.exit(1);
      return;
    }
    // Through the keyed connection, not the path: `resetSeedAdminPin` would
    // otherwise open the encrypted file with the plain driver and report "no
    // seeded administrator account found" on an install that has one.
    const resetConn = cipher ? openTenantConnection(dbPath, cipher) : undefined;
    const reset = await resetSeedAdminPin(dbPath, resetConn ?? dbPath).catch((err: unknown) => {
      console.error("[recovery] --reset-admin failed", err);
      return null;
    });
    resetConn?.close();
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
    // A dedicated connection to the same on-disk file, used only for the
    // backup snapshot. Kept separate from the UnitOfWork's connection (WAL
    // mode supports concurrent readers + one writer just fine) rather than
    // reaching into persistence internals, so the backup module only ever
    // depends on a plain better-sqlite3 `Database`, never on
    // @mezan/persistence's repository abstraction.
    //
    // Keyed with the same driver and key `createBackend` gets below. A plain
    // `new Database(dbPath)` here throws "file is not a database" on an
    // encrypted install — and if it somehow did not, every archive it wrote
    // would be a decrypted copy of the books, in the folder people carry out of
    // the shop on a USB stick.
    backupConn = cipher ? openTenantConnection(dbPath, cipher) : new Database(dbPath);
    backupConn.pragma("busy_timeout = 5000");

    // Pre-migration auto-backup (docs/archive/plan.md §2.3/§3.7). No real migration
    // runner exists yet, so `migrate` is a no-op today — see backup-hooks.ts.
    const encrypted = cipher !== undefined;
    await backupThenMigrate({ sqlite: backupConn, appVersion: app.getVersion(), encrypted });
    disposeBackupSchedule = scheduleBackups({
      sqlite: backupConn,
      appVersion: app.getVersion(),
      encrypted,
      dbPath,
    });
  }

  // Same shared Hono app both mounts serve (docs/archive/plan.md §2.2): the IPC
  // bridge below (no port, host-local only) and, when the license carries
  // `lan.multi_till`, a LAN-visible socket for other tills/tablets in the
  // shop (§6.3.3). `/lan/sessions` seat enforcement lives on this one app
  // instance in both cases — see @mezan/api's lan/routes.ts.
  // The Ed25519 offline license is the ONE source of both entitlements and
  // write permission (docs/archive/plan.md §2.5). Past its grace window it
  // resolves to READ_ONLY: data stays viewable, new postings are refused by
  // the write-gate below — closes D115, where an unsigned env var decided this.
  const license = await loadDesktopLicense({
    userDataDir: app.getPath("userData"),
    packaged: app.isPackaged,
  });
  const entitlements = license.entitlements;

  // The support-code reading for `mezan:licence:status`, which also carries the
  // LAN address and certificate fingerprint. It reports on the DEV env seam
  // only and grants nothing — `license` above is what every gate is built from.
  // See the note on `diagnoseDesktopEntitlements`; the two collapse once that
  // channel reports the verified state directly.
  const licence = diagnoseDesktopEntitlements();
  if (licence.status !== "licensed") {
    console.warn(`[licence] ${licence.code} — ${licence.detailAr}`);
  }
  const seatRegistry = new SeatSessionRegistry(entitlements.seats);
  // `createBackend`, NOT `createApp`. This is the composition that carries the
  // session resolver, the seeded tenant and the real `/auth` routes; building
  // the app directly left every route resolving its caller from the
  // `x-permissions` header — on the one edition that binds a LAN socket, so
  // any device on the shop wifi could send `x-permissions: *`.
  backend = await createBackend({
    dbPath,
    connection: cipher,
    lan: { resolveEntitlements: () => entitlements, registry: seatRegistry },
    resolveLicenseState: () => license.state,
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
      await clearRecoveryPinIfClaimed(dbPath, backupConn ?? dbPath).catch((err: unknown) => {
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
    cipher,
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
  // Registered before the socket is opened, and reading `lanHost` through a
  // getter: the bind is asynchronous (lan-host.ts), so the address is null
  // until it completes and the screen must be told null rather than a guess.
  registerLicenceStatusOverIpc({
    diagnosis: () => licence,
    lanHost: () => lanHost,
    sessions: backend.sessions,
  });
  // The identity is a thunk, and it lives BESIDE the database rather than in
  // it: the socket must present the same certificate on every launch or no
  // till can pin it, and lan-host.ts must keep importing no `electron`.
  const sessions = backend.sessions;
  lanHost = startLanHost({
    app: backend.app,
    entitlements,
    tls: () => loadOrCreateLanTlsIdentity(defaultDbPath()),
    // What turns the LAN socket from a seat-protocol endpoint into something a
    // second machine can actually run the business on. Without it the socket
    // serves login and `/lan/*` and refuses everything else — see
    // lan-authorization.ts for the three things this has to establish before a
    // request reaches the app.
    authorizeClientRequest: createLanClientAuthorizer({
      resolveSessionUser: (token, origin) => sessions.find(token, origin)?.userId ?? null,
      registry: seatRegistry,
    }),
  });

  const mainWindow = createWindow();
  registerAutoUpdater(mainWindow);

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
