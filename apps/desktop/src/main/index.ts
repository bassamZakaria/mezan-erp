import { hostname } from "node:os";
import { app, BrowserWindow, dialog, safeStorage } from "electron";
import Database from "better-sqlite3";
import { startBackendProcess, type BackendProcessHandle } from "./backend-process.js";
import { registerHonoOverIpc, registerHonoOverLanClient, registerPrintToPdfOverIpc, registerSavePdfOverIpc } from "./ipc.js";
import { readClientConfig, readPairingRequest, writeClientConfig, type ClientConfig } from "./client-config.js";
import { createLanClient, withSeatClaim } from "./lan-client.js";
import { registerClientBackupRefusalsOverIpc, registerRestoreOverIpc } from "./restore-ipc.js";
import { createWindow, hardenWebContents } from "./window.js";
import { registerAutoUpdater } from "./updater.js";
import { backupThenMigrate, isMigrationPending, scheduleBackups } from "./backup-hooks.js";
import { registerStartupBusy, unregisterStartupBusy } from "./startup-busy.js";
import { CURRENT_SCHEMA_VERSION } from "@mezan/persistence";
import { MEZAN_UPDATE_EVENT_CHANNEL, type UpdateStatus } from "../shared/ipc-contract.js";
import { defaultBackupsDir, defaultDbPath, isDev, rendererEntry, rendererRoot } from "./env.js";
import { registerRendererScheme, serveRenderer, shouldServeRenderer } from "./renderer-protocol.js";
import {
  registerClientLicenceStatusOverIpc,
  registerLicenceCheckinOverIpc,
  registerLicenceStatusOverIpc,
} from "./licence-ipc.js";
import { loadDesktopLicense, printableMachineFingerprint } from "./license-runtime.js";
import {
  applyCheckinAttempt,
  attemptCheckin,
  checkinMessageAr,
  decideCheckin,
} from "./license-checkin.js";
import { reevaluateLicenseState } from "./license.js";
import { createFileLogger } from "./log.js";
import { startLanHost, type LanHostHandle } from "./lan-host.js";
import { advertiseLanHost } from "./lan-discovery.js";
import { registerPairingOverIpc } from "./pairing-ipc.js";
import { registerClientMaintenanceRefusalsOverIpc } from "./client-refusals.js";
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

let backend: BackendProcessHandle | undefined;
let backupConn: Database.Database | undefined;
let cipher: TenantCipher | undefined;
let disposeBackupSchedule: (() => void) | undefined;
let lanHost: LanHostHandle | undefined;
/**
 * Created BEFORE the pre-update backup when this launch brings a schema change,
 * so the machine shows an app rather than a dock icon for the minutes that copy
 * takes, and reused at the end instead of opening a second window.
 */
let mainWindow: BrowserWindow | undefined;
/** Stops the `_mezan._tcp` advertisement. Undefined until the socket has bound. */
let stopAdvertising: (() => Promise<void>) | undefined;
/**
 * The unencrypted copy of the whole database taken before this install was
 * converted to encrypted storage, while it is still on disk. It was reported
 * once, to a console, on the launch that made it — so the shop never learned
 * that the books were sitting in a folder in the clear. `mezan:licence:status`
 * carries it to a screen that can offer to delete it.
 */
let plaintextArchivePath: string | null = null;

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
  registerHonoOverLanClient(
    withSeatClaim(createLanClient({ config }), config),
    config.hostUrl,
    config.fingerprintSha256,
  );
  registerPrintToPdfOverIpc();
  registerSavePdfOverIpc();
  registerClientLicenceStatusOverIpc(config);
  registerClientBackupRefusalsOverIpc(config.hostUrl);
  // EVERY REMAINING BRIDGED CHANNEL, refused in Arabic rather than left
  // unregistered. `mezan:licence:checkin` and `mezan:update:invoke` had no
  // handler at all on a client, so two of the three maintenance buttons
  // rejected with "No handler registered" — which the panel's hooks did not
  // catch, so the operator's whole experience of pressing them was nothing
  // happening. A client genuinely cannot do either (the licence is the host's,
  // and a client that updated itself would be talking to a host it no longer
  // matches), and saying so is a screen.
  registerClientMaintenanceRefusalsOverIpc(config.hostUrl);
  // The recovery half of pairing: a paired till whose host moved can find it
  // again by its pinned certificate, with no session — which is the only
  // credential it could offer, and the host it would get one from is exactly
  // what it cannot reach.
  registerPairingOverIpc({
    dbPath: defaultDbPath(),
    tenantIsClaimed: async () => true,
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
    client: config,
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

/**
 * A rejected promise that reaches the process must not end it. The LAN host
 * serves every till in the shop out of THIS process, and a single refused
 * posting — a document approved into a closed fiscal period — was taking it
 * down for all of them. Logged, never fatal; `app.onError` in @mezan/api has
 * already answered the request.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[desktop] unhandled rejection (ignored, host stays up):", reason);
});

app.whenReady().then(async () => {
  const dbPath = isDev() ? ":memory:" : defaultDbPath();
  // Tells the seed whether this is a real install: a packaged build must not
  // create its fallback admin with the published demo PIN (see seed.ts).
  process.env["MEZAN_PACKAGED"] = app.isPackaged ? "1" : "0";
  // EXTERNAL CONTRACT, and it is read on BOTH sides of the LAN: `GET /health`
  // reports these two (packages/backend/src/create-backend.ts) and a client
  // compares them against its own before it renders a single screen
  // (main/lan-client.ts). Set before the host/client role is decided, because
  // the client path returns long before any of the host setup below.
  process.env["MEZAN_APP_VERSION"] = app.getVersion();
  process.env["MEZAN_SCHEMA_VERSION"] = String(CURRENT_SCHEMA_VERSION);

  /**
   * EVERY FAILURE FROM HERE ON IS WRITTEN DOWN AND SHOWN.
   *
   * `grep` for `dialog.`/`showErrorBox` across this app used to find nothing,
   * and there was no log file either: every startup failure — no OS keyring, a
   * damaged `client.json`, an unopenable database, a licence that would not
   * verify — was `console.error` followed by `app.exit(1)`, which from the Dock
   * or the Start menu is a program that does not open, silently. The correct
   * Arabic sentence existed in nearly every one of those branches and was
   * routed to nobody. `log` puts it in a file the shop can send; `fatal` also
   * puts it on the screen before the process ends.
   */
  const log = createFileLogger(app.getPath("logs"));
  const fatal = (messageAr: string, detail: string): void => {
    log(`FATAL ${detail}`);
    try {
      dialog.showErrorBox("ميزان", `${messageAr}\n\nسجل الأخطاء: ${log.filePath}`);
    } catch {
      // A headless or very early failure. The log file is still written.
    }
    app.exit(1);
  };

  /**
   * `--print-machine-fingerprint`, and it runs before anything opens a file.
   *
   * A shop whose PC died restores its backup onto new hardware, meets
   * `MACHINE_NOT_BOUND`, and neither the owner nor support could obtain the
   * string a replacement licence has to be bound to: there was no flag, no
   * panel and no log line carrying it. It is safe to print — a salted hash,
   * never the raw machine identity.
   */
  if (process.argv.includes("--print-machine-fingerprint")) {
    try {
      const fingerprint = await printableMachineFingerprint({
        userDataDir: app.getPath("userData"),
        packaged: app.isPackaged,
      });
      console.log(
        `\nبصمة هذا الجهاز / Machine fingerprint:\n${fingerprint}\n\n` +
          "أرسل هذا السطر إلى الدعم لإصدار ترخيص لهذا الجهاز. / " +
          "Send this line to support to have a licence issued for this machine.\n",
      );
      app.exit(0);
    } catch (err) {
      fatal(
        "تعذّرت قراءة بصمة هذا الجهاز.",
        `[fingerprint] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

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
      fatal(
        "بيانات الاقتران غير صالحة، ولم يتم ربط هذا الجهاز بأي جهاز رئيسي.",
        `[pair] ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (pairing) {
      if ((await readDatabaseFileState(dbPath)) !== "absent") {
        fatal(
          "يوجد على هذا الجهاز قاعدة بيانات خاصة به. المحطة المتصلة لا تحتفظ بدفاتر خاصة، " +
            "وربط هذا الجهاز سيترك تلك البيانات معزولة. انقل قاعدة البيانات أو احذفها أولاً " +
            "إذا كان هذا الجهاز سيصبح محطة متصلة بالفعل.",
          `[pair] ${dbPath} already exists; refusing to pair and orphan it.`,
        );
        return;
      }
      const config = await writeClientConfig(dbPath, pairing).catch((err: unknown) => {
        log(`[pair] could not write the pairing: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (!config) {
        fatal(
          "تعذّر حفظ بيانات الاقتران على هذا الجهاز. تأكد من صلاحيات الكتابة ثم أعد المحاولة.",
          "[pair] could not write client.json",
        );
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
      fatal(
        "ملف إعدادات المحطة المتصلة (client.json) تالف، ولا يمكن تشغيل ميزان بدونه. " +
          "تواصل مع الدعم: حذف الملف يحوّل هذا الجهاز إلى جهاز رئيسي بدفاتر منفصلة، " +
          "وهو غالباً ليس المطلوب على جهاز كان محطة متصلة.",
        `[client] ${role.reason}`,
      );
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
        fatal(
          "قاعدة البيانات على هذا الجهاز مُشفّرة بالفعل، ولا يمكن فتحها إلا بمفتاحها. " +
            "أزل الخيار ‎--allow-unencrypted-database، أو استعد نسخة احتياطية أُخذت قبل تفعيل التشفير.",
          "[crypto] --allow-unencrypted-database passed against an already-encrypted database",
        );
        return;
      }
      log(
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
          plaintextArchivePath = opened.backupArchivePath ?? null;
          log(
            "[crypto] converted the existing plaintext database to encrypted storage. " +
              `Pre-conversion safety copy (UNENCRYPTED — delete it once you trust this build): ${opened.backupArchivePath}`,
          );
        }
        if (opened.keyCardPath) {
          log(`[crypto] database encryption key written to ${opened.keyCardPath}`);
        }
        if (opened.keyCardPresent) {
          // The key card is a BEARER SECRET sitting beside the books, and this
          // warning used to go to a console nobody opens: the failure surfaces
          // years later as "the books are gone". It is shown, not just logged.
          const keyCard = keyCardFilePath(dbPath);
          log(
            `[crypto] ${keyCard} still holds this database's key in plain text. ` +
              "Copy it somewhere safe off this machine and delete the file — it is the only way to " +
              "open a backup on replacement hardware, and the only plaintext copy of the key anywhere.",
          );
          void dialog
            .showMessageBox({
              type: "warning",
              title: "ميزان — مفتاح قاعدة البيانات",
              message: "مفتاح تشفير قاعدة البيانات ما زال محفوظاً كنص عادي على هذا الجهاز.",
              detail:
                `الملف: ${keyCard}\n\n` +
                "انسخه إلى مكان آمن خارج هذا الجهاز ثم احذفه. هو الوسيلة الوحيدة لفتح نسخة احتياطية " +
                "على جهاز بديل، وهو أيضاً النسخة الوحيدة غير المشفّرة من المفتاح.",
              buttons: ["حسناً"],
            })
            .catch(() => undefined);
        }
        if (wantsKeyExport()) {
          app.exit(0);
          return;
        }
      } catch (err) {
        fatal(
          "تعذّر فتح قاعدة بيانات ميزان بشكل آمن على هذا الجهاز، ولن يبدأ البرنامج. " +
            "الغالب أن نظام التشغيل لا يوفّر خزنة مفاتيح (Keychain / DPAPI / libsecret). تواصل مع الدعم.",
          `[crypto] ${err instanceof Error ? err.message : String(err)}`,
        );
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
      fatal(
        "الخيار ‎--reset-admin يحتاج نسخة مثبّتة وقاعدة بيانات على القرص.",
        "[recovery] --reset-admin needs a packaged build with a database on disk.",
      );
      return;
    }
    // Through the keyed connection, not the path: `resetSeedAdminPin` would
    // otherwise open the encrypted file with the plain driver and report "no
    // seeded administrator account found" on an install that has one.
    const resetConn = cipher ? openTenantConnection(dbPath, cipher) : undefined;
    const reset = await resetSeedAdminPin(dbPath, resetConn ?? dbPath).catch((err: unknown) => {
      log(`[recovery] --reset-admin failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    resetConn?.close();
    if (!reset) {
      fatal(
        "لم يُعثر على حساب مدير مُهيّأ في قاعدة البيانات على هذا الجهاز، فلم يتغيّر أي رمز دخول.",
        `[recovery] no seeded administrator account found in ${dbPath}.`,
      );
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

    /**
     * THE PRE-UPDATE BACKUP, AND WHY IT NO LONGER RUNS ON EVERY LAUNCH.
     *
     * It was unconditional and it happened here, before a window existed: every
     * cold start copied, hashed, tarred, extracted and integrity-checked the
     * whole database against a dock icon that did nothing — measured at ~1.1s
     * per 88 MB, i.e. minutes at 2 GB, which is a force-quit and a support call.
     * The backup exists to protect a SCHEMA CHANGE, so it runs when the file's
     * stamp says this build brings one.
     *
     * The decision is taken HERE, before `createBackend` opens the database and
     * stamps it: after that, every launch looks like a matching schema.
     */
    const encrypted = cipher !== undefined;
    const migrationPending = isMigrationPending(backupConn);
    if (migrationPending) {
      // The window FIRST. Until the backend below is composed there is nothing
      // to answer a renderer request with, so `mezan:fetch` is answered by a
      // refusal that says what is happening — an unregistered channel would
      // reject with an English Electron internal instead.
      mainWindow = createWindow();
      registerStartupBusy();
      const notifyMigrating = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(MEZAN_UPDATE_EVENT_CHANNEL, {
          phase: "migrating",
          version: app.getVersion(),
        } satisfies UpdateStatus);
      };
      // Sent twice on purpose: the renderer is still loading, and a status
      // pushed before it subscribed reaches nobody.
      notifyMigrating();
      mainWindow.webContents.once("did-finish-load", notifyMigrating);

      try {
        await backupThenMigrate({
          sqlite: backupConn,
          appVersion: app.getVersion(),
          encrypted,
          cipher: cipher ? { key: cipher.key } : undefined,
          migrationPending: true,
        });
      } finally {
        // In `finally` because Electron throws on a second handler for one
        // channel: a failed backup that left this registered would turn into
        // "Attempted to register a second handler for 'mezan:fetch'" further
        // down, which says nothing about what actually went wrong.
        unregisterStartupBusy();
      }
    }

    disposeBackupSchedule = scheduleBackups({
      sqlite: backupConn,
      appVersion: app.getVersion(),
      encrypted,
      cipher: cipher ? { key: cipher.key } : undefined,
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
  const loaded = await loadDesktopLicense({
    userDataDir: app.getPath("userData"),
    packaged: app.isPackaged,
    // What the anti-rollback record is MAC'd with. A guard file the owner can
    // delete to reset the anti-piracy clock is not a guard; sealing it to the
    // database key means the one secret protecting the books also protects
    // this. `null` on an unencrypted/dev install, where no such secret exists.
    databaseKey: cipher?.key ?? null,
  });
  const license = loaded.license;
  const guard = loaded.guard;
  const entitlements = license.entitlements;
  // Replaced in place when an operator imports a licence file over IPC, so the
  // status channel reports what is on disk now rather than what was on disk at
  // launch. The write gate's own re-read is licence-ipc's `onLicenceReplaced`.
  let liveLicence = license;

  /**
   * THE ONLINE CHECK-IN, and the two thresholds it enforces.
   *
   * The signed licence proves authenticity, not currency: it cannot know it was
   * revoked yesterday, or copied to a second machine last week. So the install
   * confirms itself against the licensing service, and going too long without
   * doing so costs it something — see license-checkin.ts for why the cost is
   * staged rather than immediate.
   *
   * The attempt is fire-and-forget on purpose: a shop must not wait on a network
   * round trip to open its till, and a vendor outage must never delay a launch.
   * Only a SUCCESSFUL, SIGNED answer moves the clock; a failure leaves the day
   * counter to degrade gently on its own.
   *
   * NOTHING HERE EXITS. This block used to `app.exit(1)` past thirty days,
   * before a window existed: a shop one month past a router fault double-clicked
   * the icon and nothing happened — no dialog, no log, and their books inside a
   * file the app would not open. The window opens now, the state carries
   * `CHECKIN_OVERDUE` and a day count, and the shell renders the blocking notice
   * over an app whose data is still readable, printable and exportable.
   */
  const installStamp = () => {
    const read = guard.read();
    if (read.integrity === "ok" && read.record.installedAt !== null) return read.record.installedAt;
    // The licence's SIGNED start date, not "now": a stamp the machine writes for
    // itself is a stamp deleting the file resets, which is exactly the bypass.
    const stamp = license.identity.notBefore ?? new Date().toISOString();
    if (read.integrity !== "tampered") {
      try {
        guard.write({ ...read.record, installedAt: stamp });
      } catch (err) {
        log(`[licence] could not stamp the guard record: ${String(err)}`);
      }
    }
    return stamp;
  };
  const installedAt = installStamp();

  /** Re-read per request: a file read and arithmetic, no signature check. */
  const currentVerdict = () => {
    const read = guard.read();
    return decideCheckin({
      record: read.record,
      integrity: read.integrity,
      installedAtFallback: installedAt,
      now: new Date(),
    });
  };

  const startupVerdict = currentVerdict();
  if (startupVerdict.verdict !== "ok") {
    log(`[licence] ${checkinMessageAr(startupVerdict.verdict, startupVerdict.daysSince)}`);
  }

  void attemptCheckin({
    endpoint: loaded.config.checkinUrl,
    licenseId: license.identity.licenseId,
    fingerprint: license.identity.fingerprint,
    publicKey: loaded.config.publicKey,
    lastVerifiedAt: guard.read().record.lastVerifiedAt,
  }).then((attempt) => {
    if (attempt.reachedServer) {
      applyCheckinAttempt(guard, attempt, new Date());
      if (attempt.revoked) log("[licence] the licensing service reports this licence as REVOKED.");
    } else {
      log(`[licence] check-in did not reach the service: ${attempt.detail ?? "unknown"}`);
    }
  });

  /**
   * THE BACKEND NOW RUNS IN ITS OWN PROCESS (docs/artifacts/audit-2026-09-07.md
   * Q-1), and everything that touches SQLite goes with it: the Hono app, the
   * session registry, the seat registry, the entitlements and the event bus.
   *
   * It was composed HERE, and served from here over both mounts, so every
   * synchronous `better-sqlite3` call blocked the one loop that also draws the
   * window, answers the LAN socket and runs the backup schedule — a `VACUUM
   * INTO` on an 88 MB database measured 1,129 ms with ZERO event-loop ticks.
   * One slow report froze the host UI and every till at once, and a till's read
   * timeout turned a database problem into «لا يوجد رد من الجهاز الرئيسي».
   *
   * WHAT STAYS ON THIS SIDE, each for a reason it cannot leave: licence
   * verification and the online check-in (`safeStorage`, `app.getPath`, the
   * network), the database key's unsealing (`safeStorage` again), the backup
   * schedule's own connection, the LAN socket, the window and the updater. The
   * worker receives the UNSEALED key over the port and opens the encrypted
   * database itself; the key is never written to disk.
   */
  backend = startBackendProcess({
    dbPath,
    cipherKey: cipher?.key ?? null,
    /*
     * The VERIFIED licence's capability set, applied to the TOP-LEVEL app and
     * not only to `/lan/*` — the worker passes it to both (main/backend-worker.ts).
     * Handing it to `lan` alone left every non-LAN route, the machine's own
     * IPC-driven UI included, running on `createBackend`'s permissive
     * ENTERPRISE default; backend-entitlements.test.ts guards that.
     */
    entitlements,
    /*
     * MODULE gating, from the VERIFIED licence and only from it. Passed only
     * when a signed licence actually produced the capability set: an unpackaged
     * dev run and a packaged install awaiting activation both omit it, so the
     * API keeps its own all-modules default and an ABSENCE of a licence never
     * withholds a shop's own data — the write gate is what a lapse closes.
     */
    applyEntitlements: license.verified,
    licence: license,
    /*
     * The write gate's verdict is resolved PER REQUEST inside the worker — not
     * closed over at startup, and not round-tripped back to this process on
     * every call. The worker re-reads the SAME MAC'd guard record
     * `currentVerdict()` reads here, under the same key, and does the same
     * arithmetic. A startup constant made two things impossible: pressing
     * «تحقق الآن» could not lift read-only without a restart, and a licence
     * that expired during a long session was never noticed. Both survive.
     */
    userDataDir: app.getPath("userData"),
    installedAt,
    /*
     * EXTERNAL CONTRACT, and it must be re-stated here: a forked child does not
     * inherit assignments this process made after its own launch, and `GET
     * /health` — which a client compares against its own before it renders a
     * single screen — plus the seed's packaged check both read these off
     * `process.env`.
     */
    env: {
      MEZAN_PACKAGED: process.env["MEZAN_PACKAGED"] ?? "0",
      MEZAN_APP_VERSION: app.getVersion(),
      MEZAN_SCHEMA_VERSION: String(CURRENT_SCHEMA_VERSION),
    },
    log,
  });
  const backendProcess = backend;

  registerHonoOverIpc(backend.app);
  registerPrintToPdfOverIpc();
  registerSavePdfOverIpc();
  // The verified restore in backup/restore-service.ts had no caller at all —
  // no IPC, no menu, no screen — so the product shipped backups nobody could
  // put back. These three channels are what the settings screen drives.
  registerRestoreOverIpc({
    dbPath,
    backupsDir: defaultBackupsDir(),
    appVersion: app.getVersion(),
    sqlite: () => backupConn,
    cipher,
    // ONLY «تصدير نسخة قابلة للنقل» uses this, and the archive it produces is
    // re-encrypted under the operator's own passphrase before it is written.
    // It used to be handed to `scheduleBackups`, where every daily archive came
    // out in the clear.
    ...(cipher
      ? {
          portable: {
            key: cipher.key,
            open: (file: string, key: string) => openTenantConnection(file, { ...cipher!, key }),
          },
        }
      : {}),
    closeLiveConnections: async () => {
      disposeBackupSchedule?.();
      disposeBackupSchedule = undefined;
      // AWAITED, and this is the whole reason `closeLiveConnections` may now
      // return a promise: the database handle is in another process, and a
      // worker still holding it would go on writing into the inode the restore
      // has already unlinked — the restore appears to work and the next launch
      // shows the old data.
      await backend?.close();
      backend = undefined;
      backupConn?.close();
      backupConn = undefined;
    },
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
    sessions: { find: (token) => backendProcess.findSession(token) },
    tenantIsClaimed: async () => {
      const res = await backend!.app.fetch(new Request("http://mezan.local/bootstrap/status"));
      if (!res.ok) return true;
      const body = (await res.json()) as { claimed?: boolean };
      return body.claimed !== false;
    },
  });
  // Registered before the socket is opened, and reading `lanHost` through a
  // getter: the bind is asynchronous (lan-host.ts), so the address is null
  // until it completes and the screen must be told null rather than a guess.
  registerLicenceCheckinOverIpc({
    guard,
    installedAtFallback: installedAt,
    endpoint: loaded.config.checkinUrl,
    // `payload.licenseId` and the real salted fingerprint. It used to send the
    // state enum ("ACTIVE") and the userData PATH, so the one thing check-in
    // exists to catch — the same licence file running on a second machine —
    // was invisible to it, and revocation could never target one shop.
    licenseId: license.identity.licenseId,
    fingerprint: license.identity.fingerprint,
    publicKey: loaded.config.publicKey,
    sessions: { find: (token) => backendProcess.findSession(token) },
    log,
  });
  registerLicenceStatusOverIpc({
    // The VERIFIED licence, not `diagnoseDesktopEntitlements()`: that reads the
    // dev-only `MEZAN_ENTITLEMENTS_JSON` seam, so the panel and the write gate
    // used to answer two different verdicts on one install.
    licence: () => liveLicence,
    reloadLicence: async () => {
      const reloaded = await loadDesktopLicense({
        userDataDir: app.getPath("userData"),
        packaged: app.isPackaged,
        // The SAME key the startup load used, or the re-read would open the
        // guard record with no MAC to check and resolve its own history to
        // TAMPERED — an imported licence would land the install in read-only.
        databaseKey: cipher?.key ?? null,
        guardStore: guard,
      });
      liveLicence = reloaded.license;
      // The worker's per-request write gate resolves against ITS copy of the
      // licence, so an imported one that never reached it would leave the
      // install read-only until the next launch — the exact failure the
      // per-request verdict exists to prevent.
      backendProcess.replaceLicence(liveLicence);
      return liveLicence;
    },
    // The SALTED hash, under the salt this build was made with — the exact
    // string `machineBinding` is compared against, so a licence support issues
    // from it is right for the binary in front of the user.
    fingerprint: async () => {
      try {
        return await printableMachineFingerprint({
          userDataDir: app.getPath("userData"),
          packaged: app.isPackaged,
        });
      } catch {
        return null;
      }
    },
    daysSinceCheckin: () => currentVerdict().daysSince,
    dbPath,
    backupsDir: defaultBackupsDir(),
    plaintextArchivePath: () => plaintextArchivePath,
    seatsUsed: async () => (await backendProcess.connectedDevices()).length,
    lanHost: () => lanHost,
    sessions: { find: (token) => backendProcess.findSession(token) },
    // Only the IMPORT channel consults this, and only to let the first-run
    // wizard install a licence before any account exists to sign in with.
    tenantIsClaimed: async () => {
      const res = await backend!.app.fetch(new Request("http://mezan.local/bootstrap/status"));
      if (!res.ok) return true;
      const body = (await res.json()) as { claimed?: boolean };
      return body.claimed !== false;
    },
  });
  /**
   * The HOST side of in-app pairing. A machine that has just been installed and
   * not yet claimed can still choose to become a till instead, which is the
   * whole of «الاتصال بجهاز رئيسي» on the first-run screen. `tenantIsClaimed`
   * is asked of the running backend, not of the file system: by the time a
   * window exists this launch has already created and seeded an empty database.
   */
  registerPairingOverIpc({
    dbPath,
    tenantIsClaimed: async () => {
      const res = await backend!.app.fetch(new Request("http://mezan.local/bootstrap/status"));
      if (!res.ok) return true;
      const body = (await res.json()) as { claimed?: boolean };
      return body.claimed !== false;
    },
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
    lanHost: () => lanHost,
  });

  // Reused, not re-created: a schema-changing launch already opened one above
  // to show the pre-update backup's progress.
  mainWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  registerAutoUpdater(mainWindow, process.env, new Date(), undefined, {
    // Read at the moment the operator presses install, from the live registry —
    // the confirmation names the tills that are about to lose their host.
    connectedDevices: async () =>
      (await backendProcess.connectedDevices()).map((session) => session.deviceLabel),
  });

  /**
   * EVERYTHING ABOVE RAN WHILE THE DATABASE WAS STILL OPENING.
   *
   * `startBackendProcess` returns immediately, so the window, both mounts and
   * every IPC channel exist from the first moment — and `backend.app.fetch`
   * answers 503 with «جارٍ تشغيل قاعدة البيانات» until the worker says it is
   * ready, exactly the way main/startup-busy.ts answers during the pre-update
   * backup. A dock icon that does nothing, or an unregistered channel that
   * rejects with an English Electron internal, are the two failures this
   * ordering exists to avoid.
   *
   * Only what genuinely needs a live database waits below — the LAN socket
   * above all: a till that reached a host still opening its database would read
   * 503 from `GET /health`, which its own version check cannot tell from a host
   * running the wrong build. Nothing is published until there is something to
   * publish.
   */
  await backendProcess.ready;

  // The identity is a thunk, and it lives BESIDE the database rather than in
  // it: the socket must present the same certificate on every launch or no
  // till can pin it, and lan-host.ts must keep importing no `electron`.
  lanHost = startLanHost({
    app: backend.app,
    entitlements,
    tls: () => loadOrCreateLanTlsIdentity(defaultDbPath()),
    // What turns the LAN socket from a seat-protocol endpoint into something a
    // second machine can actually run the business on. Without it the socket
    // serves login and `/lan/*` and refuses everything else — see
    // lan-authorization.ts for the three things this has to establish before a
    // request reaches the app. Both registries it consults now live in the
    // backend process, so the decision is taken THERE — on every request,
    // against the live registries, never against a copy mirrored into this
    // process that would go on authorising a till whose seat had been reaped.
    authorizeClientRequest: (request, remote) => backendProcess.authorizeLanClient(request, remote),
  });

  /**
   * BEING FINDABLE, so adding a till is not a consultant reading an IP off a
   * router. The advertisement carries the certificate fingerprint, and it is a
   * CONVENIENCE ONLY: mDNS is unauthenticated, so the till still pins what the
   * handshake presented and a human still compares it once. Started after the
   * bind because there is nothing to advertise until there is a port.
   */
  void lanHost.ready.then((info) => {
    const fingerprint = lanHost?.fingerprint();
    if (!info || !fingerprint || lanHost?.closedReason() !== null) return;
    stopAdvertising = advertiseLanHost({
      port: info.port,
      fingerprintSha256: fingerprint,
      name: `Mezan — ${hostname()}`,
    });
  });

  if (!isDev()) {
    /**
     * The seeded admin's credentials, printed exactly once, where a human can
     * read them.
     *
     * A packaged build's seed PIN is random (seed.ts), and it used to go
     * nowhere: the owner met a login screen asking for a PIN that had never
     * been shown to anybody, on an install with no other account and no reset
     * route. `takeSeededAdminSecrets()` is a one-shot read INSIDE THE WORKER —
     * the seed runs there now — so the PIN travels on the `ready` message and
     * is read here once. Without that it would be read by nobody, and the owner
     * would meet a login screen asking for a code never shown to anybody.
     */
    const seeded = backendProcess.seededAdmin();
    if (seeded?.generated) {
      const target = await writeRecoveryPin(dbPath, seeded.pin, "first-run").catch(
        (err: unknown) => {
          log(
            `[recovery] could not write the recovery file: ${err instanceof Error ? err.message : String(err)}`,
          );
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  // Withdrawn before the socket closes, so a till browsing for hosts is not
  // offered an address that has already stopped answering.
  void stopAdvertising?.();
  void lanHost?.close();
  disposeBackupSchedule?.();
  backupConn?.close();
  void backend?.close();
});
