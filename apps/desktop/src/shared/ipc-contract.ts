/**
 * The wire shape carried over the `mezan:fetch` IPC channel, shared between
 * the preload bridge and the main-process handler. Both sides marshal a
 * `Request`/`Response` pair through structured-clone-safe plain objects,
 * mirroring the same Hono `app.fetch()` contract the HTTP mount uses
 * (docs/archive/plan.md §2.2) so the renderer's data layer sees byte-identical
 * semantics regardless of which `fetch` implementation it is handed.
 */

export const MEZAN_FETCH_CHANNEL = "mezan:fetch";

export interface IpcFetchRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface IpcFetchResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * A backend response too large for the 8 MiB IPC ceiling, written straight to
 * a file the operator picks. The worker streams the body to disk, so the bytes
 * never cross into this process or the renderer. Only the paths in
 * `FETCH_TO_FILE_PATHS` (main/ipc.ts) are accepted.
 */
export const MEZAN_FETCH_TO_FILE_CHANNEL = "mezan:fetch:to-file";

export interface IpcFetchToFileRequest extends IpcFetchRequest {
  readonly defaultFileName: string;
}

export interface IpcFetchToFileResponse extends IpcFetchResponse {
  readonly savedPath: string | null;
  readonly cancelled: boolean;
}

export const FETCH_TO_FILE_UNSUPPORTED_STATUS = 501;

export const MEZAN_PRINT_TO_PDF_CHANNEL = "mezan:printToPdf";

export interface PrintToPdfOptions {
  readonly pageSize?: "A4" | "A5";
  readonly landscape?: boolean;
}

/**
 * Print-to-PDF that SAVES (P-6). `mezan:printToPdf` hands the bytes back to
 * the renderer, which cannot write them anywhere: the viewer's sandbox makes
 * an `<a download>` inert, so a report's «PDF» button had nowhere to put its
 * output. This channel renders the same DOM, asks the OS where to put it, and
 * writes the file from the main process.
 */
export const MEZAN_SAVE_PDF_CHANNEL = "mezan:print:pdf";

export interface SavePdfOptions extends PrintToPdfOptions {
  /** Suggested file name (without a path). The dialog appends `.pdf`. */
  readonly defaultFileName?: string;
}

export type SavePdfResult =
  | { readonly ok: true; readonly path: string }
  /** The operator dismissed the save dialog — not an error, and not a toast. */
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled: false; readonly message: string };

/**
 * BACKUP AND RESTORE, over IPC rather than HTTP.
 *
 * These three do not go through `mezan:fetch` because they are not the Hono
 * app's work: taking a snapshot needs the dedicated better-sqlite3 connection
 * main/index.ts holds, and restoring needs to CLOSE that connection, replace
 * the file under it and relaunch the process. None of that is expressible as a
 * request the backend answers while it is running.
 *
 * WHY THEY EXIST AT ALL. `backup/restore-service.ts` implemented the whole
 * verified restore — checksum, integrity_check, staged write, atomic rename —
 * and was called from nothing: no IPC, no menu, no screen. The only instruction
 * a user could find was a `console.error` telling them to "restore it via the
 * backup module's restoreBackup()", which is a function call, not a step a shop
 * owner standing over a dead machine can perform. A backup nobody can restore
 * is not a backup.
 */
export const MEZAN_BACKUP_LIST_CHANNEL = "mezan:backup:list";
export const MEZAN_BACKUP_CREATE_CHANNEL = "mezan:backup:create";
export const MEZAN_BACKUP_RESTORE_CHANNEL = "mezan:backup:restore";
/**
 * "Put it back the way it was before the update."
 *
 * The pre-update archive was already being taken and had no route back: the
 * only way to use it was to find `mezan-backup-pre-update-…` in a list of
 * timestamps and know what it meant. This channel picks the newest one itself
 * and runs the SAME verified restore, so the answer to "the new version broke
 * my books" is one button rather than a phone call.
 */
export const MEZAN_BACKUP_REVERT_CHANNEL = "mezan:backup:revertToPreUpdate";
/**
 * «تصدير نسخة قابلة للنقل» — the ONLY way a decrypted-then-re-encrypted,
 * restore-on-other-hardware archive is ever produced.
 *
 * Every scheduled archive is encrypted with this machine's key. That is right
 * and it has one cost: lose the machine, lose the key, lose the backups. The
 * portable export answers that — but it is an act the owner performs, with a
 * passphrase they choose, and the archive is encrypted under that passphrase
 * rather than written in the clear.
 */
export const MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL = "mezan:backup:exportPortable";

/** Mirrors `backup/manifest.ts`'s `BackupReason`, inlined so this file imports nothing. */
export type BackupReasonDTO =
  | "manual"
  | "scheduled"
  | "pre-migration"
  | "on-close"
  | "pre-update"
  | "pre-restore";

export interface BackupEntryDTO {
  /**
   * The FILE NAME, never a path — and it is also what `backup:restore` takes
   * back. The renderer must not be able to name an arbitrary file on disk for
   * the main process to read, and the main process must not have to trust that
   * it did not: the handler re-derives the absolute path inside the backups
   * directory itself and refuses anything that is not one of its own names.
   */
  readonly fileName: string;
  /** ISO. From the manifest when it is readable, else the timestamp in the file name. */
  readonly createdAt: string;
  /** Null when the manifest could not be read — the archive is still listed, marked unreadable. */
  readonly appVersion: string | null;
  readonly reason: BackupReasonDTO | null;
  readonly sizeBytes: number;
  /** Row counts per table from the manifest, for the "what is in this file" line. */
  readonly tables: Record<string, number> | null;
  /**
   * False when the manifest is missing or malformed. Listed anyway, because a
   * damaged archive the user can SEE and be warned about is better than one
   * that silently vanishes from the list they are counting on.
   */
  readonly readable: boolean;
}

export interface BackupListResult {
  /** Absolute path, so the screen can tell the owner where to copy the files from. */
  readonly backupsDir: string;
  /** Newest first. */
  readonly entries: readonly BackupEntryDTO[];
  /** False on an install running with no database key: its archives are plaintext, and the screen must say so. */
  readonly archivesEncrypted: boolean;
}

export type BackupFailureCode =
  | "UNAUTHORIZED"
  | "UNAVAILABLE"
  | "NOT_FOUND"
  | "INVALID_NAME"
  | "VERIFICATION_FAILED"
  | "WRONG_PASSPHRASE"
  | "CANCELLED"
  | "BUSY"
  | "WEAK_PASSPHRASE"
  | "WRONG_PIN"
  | "PIN_REQUIRED"
  | "KEY_CARD_NOT_SAVED"
  | "FAILED";

export interface BackupFailure {
  readonly ok: false;
  readonly code: BackupFailureCode;
  /** Arabic, ready to render. Never show `code` to a user. */
  readonly message: string;
}

export type BackupCreateResult = { readonly ok: true; readonly entry: BackupEntryDTO } | BackupFailure;

export type BackupRestoreResult =
  | {
      readonly ok: true;
      readonly restoredFrom: BackupEntryDTO;
      /** The safety copy taken of the CURRENT database before it was replaced. */
      readonly safetyBackupFileName: string | null;
      /** Always true on success: the process is about to relaunch itself. */
      readonly relaunching: boolean;
    }
  | BackupFailure;

export type BackupExportResult =
  | {
      readonly ok: true;
      /** Absolute path of the encrypted portable archive, so the screen can name it. */
      readonly filePath: string;
    }
  | BackupFailure;

export const MEZAN_BACKUP_DRILL_CHANNEL = "mezan:backup:drill";
export const MEZAN_BACKUP_STATUS_CHANNEL = "mezan:backup:status";
export const MEZAN_BACKUP_PICK_PORTABLE_CHANNEL = "mezan:backup:pickPortable";
/**
 * The path of the portable archive never crosses the bridge: `pickPortable`
 * opens the OS picker in the main process and hands back an opaque id, and
 * `importPortable` takes that id. A renderer that could name a path could have
 * any file on the machine decrypted and mounted as the company's books.
 */
export const MEZAN_BACKUP_IMPORT_PORTABLE_CHANNEL = "mezan:backup:importPortable";
export const MEZAN_BACKUP_SECOND_TARGET_CHOOSE_CHANNEL = "mezan:backup:secondTarget:choose";
export const MEZAN_BACKUP_SECOND_TARGET_CLEAR_CHANNEL = "mezan:backup:secondTarget:clear";

export enum DrillOutcome {
  Pass = "pass",
  Warn = "warn",
  Fail = "fail",
}

export enum DrillCheck {
  NoArchive = "no_archive",
  Archive = "archive",
  Manifest = "manifest",
  Checksum = "checksum",
  Key = "key",
  Integrity = "integrity",
  Open = "open",
  Schema = "schema",
  RowCounts = "row_counts",
  Invariants = "invariants",
  Crashed = "crashed",
}

export enum DrillTrigger {
  Manual = "manual",
  Scheduled = "scheduled",
}

export interface DrillStepDTO {
  readonly check: DrillCheck;
  readonly ok: boolean;
  readonly ms: number;
}

export interface DrillInvariantsDTO {
  readonly trialBalance: string;
  readonly inventory: string;
  readonly payables: string;
  readonly receivables: string;
}

export interface DrillRowMismatchDTO {
  readonly table: string;
  readonly manifest: number | null;
  readonly restored: number | null;
}

export interface DrillRecordDTO {
  readonly id: string;
  readonly trigger: DrillTrigger;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly outcome: DrillOutcome;
  /** Null on a pass. On a warn it is always `invariants`: the archive restores, the books in it do not tie. */
  readonly failedCheck: DrillCheck | null;
  /** English machine detail for the log and support; the screen maps `failedCheck` to Arabic. */
  readonly detail: string | null;
  readonly archive: string | null;
  readonly archiveCreatedAt: string | null;
  readonly archiveBytes: number | null;
  readonly schemaVersion: { readonly file: number; readonly manifest: number; readonly app: number } | null;
  readonly tables: number | null;
  readonly rows: number | null;
  readonly rowMismatches: readonly DrillRowMismatchDTO[];
  readonly invariants: DrillInvariantsDTO | null;
  readonly steps: readonly DrillStepDTO[];
}

export interface SecondTargetStatusDTO {
  readonly dir: string | null;
  readonly lastCopyAt: string | null;
  readonly lastCopyOk: boolean | null;
  readonly lastCopyFile: string | null;
  readonly lastCopyError: string | null;
  /** True when the last copy was sealed under the recovery secret and opens on any machine. */
  readonly lastCopyPortable: boolean | null;
}

export enum RecoveryMode {
  Passphrase = "passphrase",
  KeyCard = "key-card",
}

/**
 * «حماية النسخ الاحتياطية»: the secret the owner will type on replacement
 * hardware. Null `mode` means none was ever set, and every copy in the second
 * folder is still keyed to this machine alone.
 */
export interface RecoveryStatusDTO {
  readonly mode: RecoveryMode | null;
  readonly setAt: string | null;
  /** The key-card route exists only on an encrypted install: the card holds the database key. */
  readonly keyCardAvailable: boolean;
  /** False when the OS has no keyring to seal the recovery key with; nothing can be set then. */
  readonly keyStoreAvailable: boolean;
}

export interface BackupRecoverySetRequest {
  readonly mode: RecoveryMode;
  /** Required for `RecoveryMode.Passphrase`; the key card's secret is supplied by the main process. */
  readonly passphrase?: string;
  /** The signed-in user's current PIN. Required once a recovery secret exists. */
  readonly pin?: string;
}

export type BackupRecoveryResult = { readonly ok: true; readonly recovery: RecoveryStatusDTO } | BackupFailure;

export type BackupKeyCardSaveResult = { readonly ok: true; readonly filePath: string } | BackupFailure;

export const MEZAN_BACKUP_RECOVERY_SET_CHANNEL = "mezan:backup:recovery:set";
export const MEZAN_BACKUP_RECOVERY_SAVE_KEY_CARD_CHANNEL = "mezan:backup:recovery:saveKeyCard";

export interface BackupStatusResult {
  readonly ok: true;
  /** Newest first. */
  readonly drills: readonly DrillRecordDTO[];
  /** The newest drill whose archive restored (pass or warn). */
  readonly lastGoodDrillAt: string | null;
  readonly staleAfterDays: number;
  readonly drillRunning: boolean;
  readonly secondTarget: SecondTargetStatusDTO;
  readonly lastBackupAt: string | null;
  readonly diskFreeBytes: number | null;
  readonly recovery: RecoveryStatusDTO;
}

export type BackupDrillResult = { readonly ok: true; readonly drill: DrillRecordDTO } | BackupFailure;

export type BackupPickPortableResult =
  | { readonly ok: true; readonly pickId: string; readonly fileName: string; readonly sizeBytes: number }
  | BackupFailure;

export type BackupSecondTargetResult = { readonly ok: true; readonly secondTarget: SecondTargetStatusDTO } | BackupFailure;

/**
 * LICENCE HEALTH AND THE LAN ADDRESS, over IPC.
 *
 * Neither fact is the Hono app's to give. The licence diagnosis is produced by
 * main/entitlements.ts before the backend is even composed, and `GET
 * /entitlements` reports the API's own default capability set rather than the
 * desktop licence at all; the LAN bind address exists only on the
 * `LanHostHandle` main/index.ts holds. So the renderer had no way to reach
 * either, and shipped without them: an unlicensed or expired install said
 * nothing and merely lacked features, and the address a till must be pointed at
 * went to a console in a shop that never opens one — main/lan-host.ts still
 * called the screen that would show it "a future 'show me the LAN address' UI".
 *
 * The call takes the caller's SESSION TOKEN for the same reason `GET
 * /lan/status` requires a session: seat counts and the host's address are facts
 * about the shop, not public ones, and an IPC channel carries no headers.
 */
export const MEZAN_LICENCE_STATUS_CHANNEL = "mezan:licence:status";

/**
 * A licence check-in the OPERATOR asked for, rather than the fire-and-forget one
 * at startup.
 *
 * It exists because the automatic check is deliberately silent and asynchronous:
 * a till must not wait on a network round trip to open. That is right for a
 * launch and useless for the person on the phone to support, who needs to
 * connect the machine, press a button, and be told what happened. Without this,
 * the only way to clear an overdue check-in is to restart the app and hope.
 */
export const MEZAN_LICENCE_CHECKIN_CHANNEL = "mezan:licence:checkin";

/**
 * WHAT `GET /license/state` NOW CARRIES, beyond `state`/`canWrite`/`usable`.
 * (Owned by the licence main-process work; the shell renders it.)
 *
 * The shape is `LicenseStateView` in packages/api/src/license-gate.ts. Four
 * fields were added, and each exists because branching on `state` alone told a
 * shop something untrue:
 *
 *   `reason`      already existed, and is now the field to branch on rather
 *                 than `state`. `READ_ONLY` covers three different situations
 *                 with three different instructions:
 *                   EXPIRED_PAST_GRACE — the licence really did lapse; renew.
 *                   CHECKIN_OVERDUE    — the licence is VALID and merely has
 *                                        not been online. «جدّد الترخيص» here
 *                                        sends the owner to buy what they own;
 *                                        the instruction is "connect to the
 *                                        internet, then press «تحقق الآن»".
 *                   GUARD_TAMPERED     — the anti-rollback record does not
 *                                        verify. Support, not renewal.
 *                 Plus `NO_LICENSE`, `NO_PUBLIC_KEY`, `MACHINE_NOT_BOUND`,
 *                 `CLOCK_ROLLBACK`, `REVOKED`.
 *
 *   `messageAr`   present ONLY when the banner's own copy for `state` would be
 *                 wrong — a build with no vendor key, an overdue check-in, a
 *                 revoked or tampered install. Render it verbatim when it is
 *                 there; fall back to the banner's own copy when it is not.
 *
 *   `daysSince`   days since the last successful check-in, with
 *                 `reason: "CHECKIN_OVERDUE"`. The notice counts days.
 *
 *   `blocking`    true when the notice must cover the window rather than sit
 *                 beside it (past 30 days, revoked, tampered). The threshold is
 *                 the main process's to decide, not the renderer's.
 *
 *   `fingerprint` this machine's salted fingerprint hash, or null. The value a
 *                 replacement PC needs on the phone to support; also printed by
 *                 `Mezan --print-machine-fingerprint`.
 *
 * `state` gained `"REVOKED"`. It is READ_ONLY in every practical sense — data
 * stays readable, printable and exportable — and the app NEVER refuses to
 * start on any licence verdict.
 */

export interface LicenceCheckinResult {
  /** True only when the licensing service actually answered. */
  readonly reachedServer: boolean;
  readonly revoked: boolean;
  /** Days since the last SUCCESSFUL check-in, after this attempt. */
  readonly daysSince: number;
  /** Arabic, ready to render. */
  readonly messageAr: string;
}

/**
 * The code an owner reads down the phone to support. Stable, short, and always
 * rendered ALONGSIDE Arabic prose — never on its own in front of a user.
 *
 * Every code maps from the VERIFIED licence state (main/license.ts), never from
 * `MEZAN_ENTITLEMENTS_JSON` — that dev-only env seam used to drive this channel
 * while the write gate ran off the signed file, so one install answered
 * `LIC-MISSING` on the status panel and ACTIVE at every save.
 */
export type LicenceCode =
  | "LIC-OK"
  | "LIC-GRACE"
  | "LIC-MISSING"
  | "LIC-MALFORMED"
  | "LIC-INVALID"
  | "LIC-EXPIRED"
  | "LIC-CHECKIN"
  | "LIC-REVOKED"
  | "LIC-NOKEY"
  | "LIC-MACHINE"
  | "LIC-CLOCK"
  | "LIC-NOTYET";

export interface LanAddressDTO {
  /** True only when the LAN socket is actually bound and listening. */
  readonly listening: boolean;
  /**
   * `https://192.168.1.7:4173` — the address a till is pointed at — or null
   * when there is none to give (not listening yet, or the host had no
   * non-internal IPv4 interface and fell back to `0.0.0.0`, which no till can
   * dial). NEVER a plausible-looking guess: the screen says the address is
   * unknown instead.
   *
   * `https`, not `http`: the socket serves TLS only (main/lan-tls.ts), because
   * plain HTTP put every till's PIN and its 12-hour bearer token on the shop
   * wifi in clear text.
   */
  readonly url: string | null;
  /**
   * `AB:CD:…` — the SHA-256 fingerprint of the certificate the LAN socket
   * presents, which is what a till PINS. It is self-signed and validated
   * against no chain, so this string is the only thing that distinguishes the
   * real host from a laptop answering on the same address; a consultant reads
   * it off the host's screen once, while standing in the shop.
   *
   * Null when it is not known (LAN off, or the identity could not be read).
   * Never a placeholder — a fingerprint that matches nothing on the wire would
   * teach the shop to click past the one warning that protects it.
   */
  readonly fingerprintSha256: string | null;
  // lan-ux: WHY it is not listening, when it is not.
  /**
   * `NOT_LICENSED` | `PORT_IN_USE` | `TLS_UNAVAILABLE` | `NO_INTERFACE`, or
   * null when the socket is serving.
   *
   * «الشبكة المحلية غير مشغّلة» covered all four, each with a different fix,
   * and the distinguishing reason went to a console. Typed as a plain union
   * here rather than imported from main/lan-host.ts so this file keeps
   * importing nothing.
   */
  readonly closedReason?: "NOT_LICENSED" | "PORT_IN_USE" | "TLS_UNAVAILABLE" | "NO_INTERFACE" | null;
}

/** Mirrors @mezan/api's `LicenseStateName`, inlined so this file imports nothing. */
export type LicenceStateDTO =
  | "ACTIVE"
  | "GRACE"
  | "READ_ONLY"
  | "INVALID"
  | "TAMPERED"
  | "NOT_YET_VALID"
  | "FINGERPRINT_MISMATCH"
  | "REVOKED"
  | "UNLICENSED";

export interface LicenceStatusDTO {
  readonly ok: true;
  readonly code: LicenceCode;
  /** Arabic, ready to render as-is. */
  readonly messageAr: string;
  /** The VERIFIED state the write gate is running under — never a second reading. */
  readonly state: LicenceStateDTO;
  /** Machine reason behind `state` (`CHECKIN_OVERDUE`, `MACHINE_NOT_BOUND`, …), or null. */
  readonly reason: string | null;
  readonly canWrite: boolean;
  readonly plan: string;
  readonly seats: number;
  /** Seats currently held by a signed-in device, from the live seat registry. */
  readonly seatsUsed: number;
  /** The modules the verified licence actually grants. */
  readonly modules: readonly string[];
  /** ISO, or null for a perpetual grant. */
  readonly expiresAt: string | null;
  /**
   * The raw machine fingerprint this install reports, LTR and copyable.
   *
   * It is the one value neither the owner nor support could obtain anywhere in
   * the product, which left `FINGERPRINT_MISMATCH` — the state a replacement PC
   * restoring its backup lands in — with no recovery path at all. Null only
   * when the per-OS read failed.
   */
  readonly fingerprint: string | null;
  /** Days since the last SUCCESSFUL online check-in, or null when unknown. */
  readonly daysSinceCheckin: number | null;
  /** Absolute path of `license.mezan`, so support can say where to put the file. */
  readonly licenceFilePath: string;
  readonly appVersion: string;
  /** "host" on the machine holding the books, "client" on a paired till. */
  readonly role: "host" | "client";
  readonly databasePath: string | null;
  readonly backupsDir: string | null;
  /**
   * PLAINTEXT COPIES OF THE KEYS TO THE BOOKS, still on this disk.
   *
   * `database-key.txt` is the only plaintext copy of the database key anywhere,
   * and the pre-conversion archive is the whole unencrypted database. Both were
   * warned about on every launch — to a console a shop never opens — so the
   * failure surfaced years later as "the books are gone". Null when absent.
   */
  readonly keyCardPath: string | null;
  readonly plaintextArchivePath: string | null;
  readonly lan: LanAddressDTO;
}

export interface LicenceStatusFailure {
  readonly ok: false;
  readonly code: "UNAUTHORIZED" | "UNAVAILABLE";
  /** Arabic, ready to render. Never show `code` to a user on its own. */
  readonly message: string;
}

export type LicenceStatusResult = LicenceStatusDTO | LicenceStatusFailure;

/**
 * ACTIVATION, which is a FILE, not a key.
 *
 * The first-run wizard asked for `XXXX-XXXX-XXXX-XXXX`, called nothing, and
 * showed a green «مُفعّل» pill — so a new owner was told the licence took and
 * then met a 403 on every save. The product has never used activation keys: a
 * licence is a signed `license.mezan` a consultant drops beside the database.
 * This channel is that drop, performed by the app: an OS file picker, a copy
 * into `userData/license.mezan`, and a full re-verification whose REAL verdict
 * is what comes back. There is no success answer that is not a verified one.
 */
export const MEZAN_LICENCE_IMPORT_CHANNEL = "mezan:licence:import";

export type LicenceImportResult =
  | {
      readonly ok: true;
      /** The verdict AFTER the file was installed and verified. */
      readonly status: LicenceStatusDTO;
      /** True when the imported licence is authentic and permits writing. */
      readonly accepted: boolean;
    }
  | {
      readonly ok: false;
      readonly code: "UNAUTHORIZED" | "CANCELLED" | "UNREADABLE" | "FAILED";
      /** Arabic, ready to render. */
      readonly message: string;
    };

/**
 * The build's own version, unauthenticated on purpose.
 *
 * «ما هي نسختك؟» is the third-most-common support question and no user could
 * answer it: the login screen carried a hardcoded literal, System Status read
 * the web package, and the backup table read the manifest — three sources, all
 * disagreeing. This is the one source, and the login screen has to be able to
 * ask it BEFORE anybody signs in, which is why it takes no session token. An
 * app's own version is on the About box of every program ever shipped.
 */
export const MEZAN_APP_VERSION_CHANNEL = "mezan:app:version";

/**
 * SUPPORT ACTIONS: write the diagnostic file, show a risky plaintext file in
 * the OS file manager, and delete it once the owner says they have copied it.
 *
 * `target` is a DISCRIMINATOR, never a path. The renderer must not be able to
 * name a file on disk for the main process to reveal or unlink, and the main
 * process must not have to trust that it did not — it re-derives both paths
 * itself, exactly as the backup handlers re-derive an archive path from a name.
 */
export const MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL = "mezan:support:diagnostic";
export const MEZAN_SUPPORT_REVEAL_CHANNEL = "mezan:support:reveal";
export const MEZAN_SUPPORT_DELETE_CHANNEL = "mezan:support:delete";

export const MEZAN_SUPPORT_SAVE_LOGS_CHANNEL = "mezan:support:save-logs";

export type PlaintextRiskTarget = "key-card" | "plaintext-archive";

/** `log` may be shown in the file manager but never deleted from the renderer. */
export type SupportRevealTarget = PlaintextRiskTarget | "log";

export const SUPPORT_LOG_TAIL_LINES = 500;

/**
 * Renderer errors reach the main-process log file over this one fire-and-forget
 * style channel. The payload carries no form data: a message, a trimmed stack
 * and the route only, and main redacts and rate-limits it again.
 */
export const MEZAN_LOG_RENDERER_ERROR_CHANNEL = "mezan:log:renderer-error";

export enum RendererErrorSource {
  Error = "window.error",
  UnhandledRejection = "window.unhandledrejection",
  RouteBoundary = "route-boundary",
}

export interface RendererErrorReport {
  readonly source: RendererErrorSource;
  readonly message: string;
  readonly stack?: string | undefined;
  readonly route?: string | undefined;
}

export type SupportActionResult =
  | { readonly ok: true; readonly path: string | null }
  | {
      readonly ok: false;
      readonly code: "UNAUTHORIZED" | "CANCELLED" | "NOT_FOUND" | "FAILED";
      /** Arabic, ready to render. */
      readonly message: string;
    };

/**
 * The shape exposed on `window.mezan` by the preload bridge. Kept minimal —
 * one `fetch`-shaped call, print-to-PDF, and the backup trio — so the
 * renderer's HTTP client abstraction only has to swap the `fetch`
 * implementation between editions (real `fetch` online, `window.mezan.fetch` on
 * desktop), never branch on platform. `printToPDF` backs the desktop path of
 * @mezan/ui's `useElectronPrintToPdf` (docs/archive/plan.md §2.4) — it renders
 * the SAME print DOM the browser edition prints via `window.print()`, just via
 * `webContents.printToPDF` on the main-process side (main/ipc.ts) instead.
 *
 * Every `backup` call takes the caller's SESSION TOKEN — the one
 * `POST /auth/login` minted, the same value the `authorization` header carries.
 * An IPC channel has no headers and no session of its own, so without it these
 * handlers would be the one unauthenticated write surface in the product:
 * anything running in the renderer could replace the company's books with a
 * file of its choosing. The main process verifies the token against the live
 * session registry and requires `admin.tenant.settings.edit`; it never reads a
 * permission the caller states about itself.
 */
/**
 * Auto-update channel (docs/archive/plan.md §2.3). Two directions:
 *   - renderer → main INVOKE (`mezan:update:invoke`): user-driven actions —
 *     `check` for updates, `download` (only after the user consents), `install`
 *     (quit-and-install the already-verified download).
 *   - main → renderer EVENT (`mezan:update:event`): unsolicited progress —
 *     available, download percent, signature verification, ready, error. The
 *     download is NEVER silent and an update is applied only after its Ed25519
 *     signature verifies against the vendor key (main/update-verify.ts).
 */
// lan-ux: pairing a till, and recovering one whose host moved.
/**
 * ONE CHANNEL, FIVE ACTIONS, NO SESSION TOKEN — and the absence of a token is
 * the part to read before extending this. See main/pairing-ipc.ts: the two
 * moments these exist for are a machine that has never been set up and a till
 * that cannot reach the host it would sign in to, so no session can exist in
 * either. What replaces a credential is that neither destructive action is
 * blind: `confirm` refuses on any machine whose tenant has been claimed, and
 * `relocate` moves the ADDRESS while the pinned certificate stays exactly as it
 * was, so it can never walk a till onto a different machine.
 */
export const MEZAN_PAIRING_CHANNEL = "mezan:pairing:invoke";

export type PairingRequestMessage =
  | { readonly kind: "state" }
  | { readonly kind: "discover" }
  | { readonly kind: "probe"; readonly hostUrl: string }
  | {
      readonly kind: "confirm";
      readonly hostUrl: string;
      /** The value the operator just compared on screen. Re-read before it is written. */
      readonly fingerprintSha256: string;
      readonly deviceLabel?: string;
    }
  /** `accept` null = search; `accept` set = write that address and relaunch. */
  | { readonly kind: "relocate"; readonly accept?: string | null }
  /**
   * «اختبر الوصول» — can this HOST reach its own advertised LAN address?
   *
   * Read-only, and it discloses nothing the connected-devices screen does not
   * already show, which is why it shares this channel's no-token rule. What it
   * buys is the one fault nothing in the product could distinguish: a host that
   * cannot connect to its own socket has a local firewall rule in the way,
   * which `INSTALL.md §7A.3` names as the likeliest LAN failure there is.
   */
  | { readonly kind: "selftest" };

export interface DiscoveredHostDTO {
  readonly name: string;
  readonly hostUrl: string;
  /**
   * What the ADVERTISEMENT claimed, which is not evidence of anything: mDNS is
   * unauthenticated. Shown beside the fingerprint the handshake presented so a
   * disagreement is visible; only the handshake's value is ever pinned.
   */
  readonly advertisedFingerprint: string | null;
}

export interface PairingStateResult {
  readonly kind: "state";
  readonly role: "host" | "client";
  readonly hostUrl: string | null;
  readonly pinnedFingerprint: string | null;
  readonly deviceLabel: string;
  /** False on a machine that already holds books — pairing it would orphan them. */
  readonly mayPair: boolean;
}

export interface PairingDiscoverResult {
  readonly kind: "discover";
  readonly hosts: readonly DiscoveredHostDTO[];
  /** False when nothing answered — which is NOT the same as "there is no host". */
  readonly discoveryAvailable: boolean;
}

export type PairingProbeResult =
  | {
      readonly kind: "probe";
      readonly ok: true;
      readonly hostUrl: string;
      /** Read from the handshake. This is the value a human compares. */
      readonly presentedFingerprint: string;
      readonly subject: string | null;
    }
  | {
      readonly kind: "probe";
      readonly ok: false;
      readonly hostUrl: string;
      /** REFUSED (nothing listening) and TIMEOUT (firewall/asleep) are different fixes. */
      readonly code: "REFUSED" | "TIMEOUT" | "UNREACHABLE";
      /** Arabic, ready to render. */
      readonly message: string;
    };

export type PairingConfirmResult =
  | {
      readonly kind: "confirm";
      readonly ok: true;
      readonly hostUrl: string;
      readonly fingerprintSha256: string;
      readonly deviceLabel: string;
    }
  | { readonly kind: "confirm"; readonly ok: false; readonly message: string };

export type PairingRelocateResult =
  | {
      readonly kind: "relocate";
      readonly ok: true;
      /** Where the pinned certificate is answering now. */
      readonly found: string;
      /** True once it has been written and the app is about to relaunch. */
      readonly applied: boolean;
    }
  | { readonly kind: "relocate"; readonly ok: false; readonly message: string };

export interface PairingSelfTestResult {
  readonly kind: "selftest";
  readonly reachable: boolean;
  /** `192.168.1.7:4173`, or null when this machine has no address to test. */
  readonly address: string | null;
  /** `TIMEOUT`, `ECONNREFUSED`, `NO_INTERFACE`… — a machine reason, mapped to Arabic by the screen. */
  readonly detail: string | null;
}

export type PairingResponse =
  | PairingStateResult
  | PairingSelfTestResult
  | PairingDiscoverResult
  | PairingProbeResult
  | PairingConfirmResult
  | PairingRelocateResult;

export const MEZAN_UPDATE_INVOKE_CHANNEL = "mezan:update:invoke";
export const MEZAN_UPDATE_EVENT_CHANNEL = "mezan:update:event";

export type UpdateAction = "check" | "download" | "install";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "verifying"
  | "ready"
  | "error"
  | "rejected"
  /**
   * No vendor key or no feed is baked into this build. NOT an error: the
   * install is updated by running a new installer, and the banner says so
   * calmly instead of showing a red alert on every machine in the field.
   */
  | "unavailable"
  /** The operator chose "install when the app closes" rather than right now. */
  | "scheduled"
  /**
   * The launch-time pre-update backup is running because the database schema
   * moved with this version. The window exists while this is on screen — the
   * whole point of it is that the app is no longer a blank dock icon for the
   * minutes a 2 GB copy takes.
   */
  | "migrating";

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly version?: string;
  readonly releaseNotes?: string;
  /** Download progress, 0–100, while `phase === "downloading"`. */
  readonly percent?: number;
  /** Machine reason for `error`/`rejected` (the UI maps it to Arabic copy). */
  readonly reason?: string;
}

export interface MezanBridge {
  fetch(input: string, init?: RequestInit): Promise<IpcFetchResponse>;
  fetchToFile(input: string, init: RequestInit | undefined, defaultFileName: string): Promise<IpcFetchToFileResponse>;
  printToPDF(options?: PrintToPdfOptions): Promise<Uint8Array>;
  /** Renders the current page to PDF and writes it where the operator chooses. */
  savePDF(options?: SavePdfOptions): Promise<SavePdfResult>;
  readonly backup: {
    list(sessionToken: string): Promise<BackupListResult | BackupFailure>;
    create(sessionToken: string): Promise<BackupCreateResult>;
    restore(sessionToken: string, fileName: string): Promise<BackupRestoreResult>;
    /** Restores the archive taken just before this version's schema update. */
    revertToPreUpdate(sessionToken: string): Promise<BackupRestoreResult>;
    /** Writes one passphrase-encrypted archive that restores on other hardware. */
    exportPortable(sessionToken: string, passphrase: string): Promise<BackupExportResult>;
    drill(sessionToken: string): Promise<BackupDrillResult>;
    status(sessionToken: string): Promise<BackupStatusResult | BackupFailure>;
    /** An empty token is accepted only while the tenant is unclaimed (the first-run screen). */
    pickPortable(sessionToken: string): Promise<BackupPickPortableResult>;
    importPortable(sessionToken: string, pickId: string, passphrase: string): Promise<BackupRestoreResult>;
    chooseSecondTarget(sessionToken: string): Promise<BackupSecondTargetResult>;
    clearSecondTarget(sessionToken: string): Promise<BackupSecondTargetResult>;
    setRecovery(sessionToken: string, request: BackupRecoverySetRequest): Promise<BackupRecoveryResult>;
    /** Writes the key card where the owner picks in an OS dialog — a USB stick, not this disk. */
    saveKeyCard(sessionToken: string): Promise<BackupKeyCardSaveResult>;
  };
  /** Drives a user-initiated update action; resolves with the resulting status. */
  update(action: UpdateAction): Promise<UpdateStatus>;
  /** Subscribes to push update status; returns an unsubscribe function. */
  onUpdateEvent(listener: (status: UpdateStatus) => void): () => void;
  readonly licence: {
    status(sessionToken: string): Promise<LicenceStatusResult>;
    checkin(sessionToken: string): Promise<LicenceCheckinResult>;
    /** Opens the OS file picker, installs the chosen licence, reports the real verdict. */
    import(sessionToken: string): Promise<LicenceImportResult>;
  };
  // lan-ux
  /** In-app pairing and host relocation. See MEZAN_PAIRING_CHANNEL for why it takes no token. */
  pairing(message: PairingRequestMessage): Promise<PairingResponse>;
  /** `app.getVersion()`. Unauthenticated: the login screen has to show it. */
  appVersion(): Promise<string>;
  /** Fire-and-forget: forwards a renderer error to the main-process log. Never rejects. */
  reportError(report: RendererErrorReport): Promise<void>;
  readonly support: {
    /** Writes the diagnostic JSON to a path the owner picks. */
    saveDiagnostic(sessionToken: string, body: string): Promise<SupportActionResult>;
    reveal(sessionToken: string, target: SupportRevealTarget): Promise<SupportActionResult>;
    /** Saves the diagnostic body plus the last 500 redacted log lines to a path the owner picks. */
    saveLogs(sessionToken: string, diagnostic: string): Promise<SupportActionResult>;
    remove(sessionToken: string, target: PlaintextRiskTarget): Promise<SupportActionResult>;
  };
}
