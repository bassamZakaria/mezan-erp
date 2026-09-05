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

export const MEZAN_PRINT_TO_PDF_CHANNEL = "mezan:printToPdf";

export interface PrintToPdfOptions {
  readonly pageSize?: "A4" | "A5";
  readonly landscape?: boolean;
}

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

/** Mirrors `backup/manifest.ts`'s `BackupReason`, inlined so this file imports nothing. */
export type BackupReasonDTO = "manual" | "scheduled" | "pre-migration" | "on-close";

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
}

export type BackupFailureCode =
  | "UNAUTHORIZED"
  | "UNAVAILABLE"
  | "NOT_FOUND"
  | "INVALID_NAME"
  | "VERIFICATION_FAILED"
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
 * There is no code here for "wrong machine": nothing in this build reads a
 * machine fingerprint (main/entitlements.ts), and a code for a state the
 * product cannot detect would be a claim it has not been told.
 */
export type LicenceCode = "LIC-OK" | "LIC-MISSING" | "LIC-MALFORMED" | "LIC-INVALID" | "LIC-EXPIRED";

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
}

export interface LicenceStatusDTO {
  readonly ok: true;
  readonly code: LicenceCode;
  /** Arabic, ready to render as-is. */
  readonly messageAr: string;
  readonly plan: string;
  readonly seats: number;
  /** ISO, or null for a perpetual grant. */
  readonly expiresAt: string | null;
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
  | "rejected";

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
  printToPDF(options?: PrintToPdfOptions): Promise<Uint8Array>;
  readonly backup: {
    list(sessionToken: string): Promise<BackupListResult | BackupFailure>;
    create(sessionToken: string): Promise<BackupCreateResult>;
    restore(sessionToken: string, fileName: string): Promise<BackupRestoreResult>;
  };
  /** Drives a user-initiated update action; resolves with the resulting status. */
  update(action: UpdateAction): Promise<UpdateStatus>;
  /** Subscribes to push update status; returns an unsubscribe function. */
  onUpdateEvent(listener: (status: UpdateStatus) => void): () => void;
  readonly licence: {
    status(sessionToken: string): Promise<LicenceStatusResult>;
    checkin(sessionToken: string): Promise<LicenceCheckinResult>;
  };
}
