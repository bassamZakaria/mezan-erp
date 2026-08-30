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
export interface MezanBridge {
  fetch(input: string, init?: RequestInit): Promise<IpcFetchResponse>;
  printToPDF(options?: PrintToPdfOptions): Promise<Uint8Array>;
  readonly backup: {
    list(sessionToken: string): Promise<BackupListResult | BackupFailure>;
    create(sessionToken: string): Promise<BackupCreateResult>;
    restore(sessionToken: string, fileName: string): Promise<BackupRestoreResult>;
  };
}
