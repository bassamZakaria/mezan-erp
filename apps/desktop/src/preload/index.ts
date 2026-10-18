import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  MEZAN_BACKUP_CREATE_CHANNEL,
  MEZAN_BACKUP_LIST_CHANNEL,
  MEZAN_BACKUP_RESTORE_CHANNEL,
  MEZAN_BACKUP_REVERT_CHANNEL,
  MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
  MEZAN_BACKUP_DRILL_CHANNEL,
  MEZAN_BACKUP_STATUS_CHANNEL,
  MEZAN_BACKUP_PICK_PORTABLE_CHANNEL,
  MEZAN_BACKUP_IMPORT_PORTABLE_CHANNEL,
  MEZAN_BACKUP_SECOND_TARGET_CHOOSE_CHANNEL,
  MEZAN_BACKUP_SECOND_TARGET_CLEAR_CHANNEL,
  MEZAN_BACKUP_RECOVERY_SET_CHANNEL,
  MEZAN_BACKUP_RECOVERY_SAVE_KEY_CARD_CHANNEL,
  MEZAN_APP_VERSION_CHANNEL,
  MEZAN_FETCH_CHANNEL,
  MEZAN_FETCH_TO_FILE_CHANNEL,
  MEZAN_LICENCE_CHECKIN_CHANNEL,
  MEZAN_LICENCE_IMPORT_CHANNEL,
  MEZAN_LICENCE_STATUS_CHANNEL,
  MEZAN_PAIRING_CHANNEL,
  MEZAN_PRINT_TO_PDF_CHANNEL,
  MEZAN_SAVE_PDF_CHANNEL,
  MEZAN_SUPPORT_DELETE_CHANNEL,
  MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL,
  MEZAN_SUPPORT_REVEAL_CHANNEL,
  MEZAN_SUPPORT_SAVE_LOGS_CHANNEL,
  MEZAN_LOG_RENDERER_ERROR_CHANNEL,
  MEZAN_UPDATE_EVENT_CHANNEL,
  MEZAN_UPDATE_INVOKE_CHANNEL,
  type SavePdfOptions,
  type SavePdfResult,
  type BackupCreateResult,
  type BackupDrillResult,
  type BackupPickPortableResult,
  type BackupSecondTargetResult,
  type BackupStatusResult,
  type BackupExportResult,
  type BackupFailure,
  type BackupListResult,
  type BackupRestoreResult,
  type BackupKeyCardSaveResult,
  type BackupRecoveryResult,
  type BackupRecoverySetRequest,
  type IpcFetchRequest,
  type IpcFetchResponse,
  type IpcFetchToFileRequest,
  type IpcFetchToFileResponse,
  type LicenceCheckinResult,
  type LicenceImportResult,
  type LicenceStatusResult,
  type MezanBridge,
  type PairingRequestMessage,
  type PairingResponse,
  type PlaintextRiskTarget,
  type RendererErrorReport,
  type SupportRevealTarget,
  type PrintToPdfOptions,
  type SupportActionResult,
  type UpdateAction,
  type UpdateStatus,
} from "../shared/ipc-contract.js";

/**
 * Secure preload bridge. Runs with `contextIsolation: true` / `sandbox: true`
 * / `nodeIntegration: false` (see main/window.ts) — the renderer never gets
 * direct Node or Electron access, only this single, narrow, typed surface.
 *
 * `window.mezan.fetch` marshals a `Request` over IPC to the main process,
 * which calls the shared Hono app's `app.fetch()` in-process and returns the
 * response (docs/archive/plan.md §2.2). The renderer's HTTP client abstraction swaps
 * this in for real `fetch` on desktop and never has to branch on platform.
 */
function normalizeInit(init?: RequestInit): Omit<IpcFetchRequest, "url"> {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
  }

  let body: string | undefined;
  if (typeof init?.body === "string") {
    body = init.body;
  } else if (init?.body != null) {
    throw new TypeError(
      "window.mezan.fetch only accepts a string body (JSON.stringify it first).",
    );
  }

  return {
    method: init?.method ?? "GET",
    headers,
    body,
  };
}

const mezanBridge: MezanBridge = {
  fetch(input: string, init?: RequestInit): Promise<IpcFetchResponse> {
    const request: IpcFetchRequest = { url: input, ...normalizeInit(init) };
    return ipcRenderer.invoke(MEZAN_FETCH_CHANNEL, request);
  },
  fetchToFile(input: string, init: RequestInit | undefined, defaultFileName: string): Promise<IpcFetchToFileResponse> {
    const request: IpcFetchToFileRequest = { url: input, ...normalizeInit(init), defaultFileName };
    return ipcRenderer.invoke(MEZAN_FETCH_TO_FILE_CHANNEL, request);
  },
  printToPDF(options?: PrintToPdfOptions): Promise<Uint8Array> {
    return ipcRenderer.invoke(MEZAN_PRINT_TO_PDF_CHANNEL, options);
  },
  savePDF(options?: SavePdfOptions): Promise<SavePdfResult> {
    return ipcRenderer.invoke(MEZAN_SAVE_PDF_CHANNEL, options);
  },
  /**
   * Backup and restore. Each call forwards the caller's SESSION TOKEN — the
   * one `POST /auth/login` minted — because an IPC channel carries no headers
   * and the main process must not take the renderer's word for what it may do
   * (main/restore-ipc.ts verifies it against the live session registry).
   *
   * This is a passthrough and nothing more: the bridge never reads the token,
   * never keeps it, and adds no arguments of its own, so the whole of the
   * restore contract stays in one place instead of half of it living here.
   */
  backup: {
    list(sessionToken: string): Promise<BackupListResult | BackupFailure> {
      return ipcRenderer.invoke(MEZAN_BACKUP_LIST_CHANNEL, sessionToken);
    },
    create(sessionToken: string): Promise<BackupCreateResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_CREATE_CHANNEL, sessionToken);
    },
    restore(sessionToken: string, fileName: string): Promise<BackupRestoreResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_RESTORE_CHANNEL, sessionToken, fileName);
    },
    revertToPreUpdate(sessionToken: string): Promise<BackupRestoreResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_REVERT_CHANNEL, sessionToken);
    },
    exportPortable(sessionToken: string, passphrase: string): Promise<BackupExportResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL, sessionToken, passphrase);
    },
    drill(sessionToken: string): Promise<BackupDrillResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_DRILL_CHANNEL, sessionToken);
    },
    status(sessionToken: string): Promise<BackupStatusResult | BackupFailure> {
      return ipcRenderer.invoke(MEZAN_BACKUP_STATUS_CHANNEL, sessionToken);
    },
    pickPortable(sessionToken: string): Promise<BackupPickPortableResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_PICK_PORTABLE_CHANNEL, sessionToken);
    },
    importPortable(sessionToken: string, pickId: string, passphrase: string): Promise<BackupRestoreResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_IMPORT_PORTABLE_CHANNEL, sessionToken, pickId, passphrase);
    },
    chooseSecondTarget(sessionToken: string): Promise<BackupSecondTargetResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_SECOND_TARGET_CHOOSE_CHANNEL, sessionToken);
    },
    clearSecondTarget(sessionToken: string): Promise<BackupSecondTargetResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_SECOND_TARGET_CLEAR_CHANNEL, sessionToken);
    },
    setRecovery(sessionToken: string, request: BackupRecoverySetRequest): Promise<BackupRecoveryResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_RECOVERY_SET_CHANNEL, sessionToken, request);
    },
    saveKeyCard(sessionToken: string): Promise<BackupKeyCardSaveResult> {
      return ipcRenderer.invoke(MEZAN_BACKUP_RECOVERY_SAVE_KEY_CARD_CHANNEL, sessionToken);
    },
  },
  /** Drives the signed update channel (main/updater.ts + main/update-verify.ts). */
  update(action: UpdateAction): Promise<UpdateStatus> {
    return ipcRenderer.invoke(MEZAN_UPDATE_INVOKE_CHANNEL, action);
  },
  onUpdateEvent(listener: (status: UpdateStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on(MEZAN_UPDATE_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(MEZAN_UPDATE_EVENT_CHANNEL, handler);
  },
  /**
   * Licence health plus the LAN address, both of which live in the main
   * process and neither of which the Hono app can answer — see the channel's
   * own doc in shared/ipc-contract.ts. Takes the session token for the same
   * reason `backup` does: an IPC channel carries no headers.
   */
  licence: {
    status(sessionToken: string): Promise<LicenceStatusResult> {
      return ipcRenderer.invoke(MEZAN_LICENCE_STATUS_CHANNEL, sessionToken);
    },
    /** The operator asking now, rather than waiting for the silent startup check. */
    checkin(sessionToken: string): Promise<LicenceCheckinResult> {
      return ipcRenderer.invoke(MEZAN_LICENCE_CHECKIN_CHANNEL, sessionToken);
    },
    /** OS file picker → `userData/license.mezan` → re-verification → the real verdict. */
    import(sessionToken: string): Promise<LicenceImportResult> {
      return ipcRenderer.invoke(MEZAN_LICENCE_IMPORT_CHANNEL, sessionToken);
    },
  },
  /**
   * In-app pairing and host relocation, and the ONE bridge call that carries no
   * session token — because the two states it exists for (a machine nobody has
   * set up, a till that cannot reach its host) are the two where no session can
   * exist. The main-process handler is where that is made safe; see
   * MEZAN_PAIRING_CHANNEL and main/pairing-ipc.ts.
   */
  pairing(message: PairingRequestMessage): Promise<PairingResponse> {
    return ipcRenderer.invoke(MEZAN_PAIRING_CHANNEL, message);
  },
  /**
   * `app.getVersion()`. No session token: the login screen prints the version
   * before anybody has one, and that literal is exactly what «ما هي نسختك؟»
   * kept getting a wrong answer from.
   */
  appVersion(): Promise<string> {
    return ipcRenderer.invoke(MEZAN_APP_VERSION_CHANNEL);
  },
  reportError(report: RendererErrorReport): Promise<void> {
    return ipcRenderer.invoke(MEZAN_LOG_RENDERER_ERROR_CHANNEL, report).then(
      () => undefined,
      () => undefined,
    );
  },
  support: {
    saveDiagnostic(sessionToken: string, body: string): Promise<SupportActionResult> {
      return ipcRenderer.invoke(MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL, sessionToken, body);
    },
    reveal(sessionToken: string, target: SupportRevealTarget): Promise<SupportActionResult> {
      return ipcRenderer.invoke(MEZAN_SUPPORT_REVEAL_CHANNEL, sessionToken, target);
    },
    saveLogs(sessionToken: string, diagnostic: string): Promise<SupportActionResult> {
      return ipcRenderer.invoke(MEZAN_SUPPORT_SAVE_LOGS_CHANNEL, sessionToken, diagnostic);
    },
    remove(sessionToken: string, target: PlaintextRiskTarget): Promise<SupportActionResult> {
      return ipcRenderer.invoke(MEZAN_SUPPORT_DELETE_CHANNEL, sessionToken, target);
    },
  },
};

contextBridge.exposeInMainWorld("mezan", mezanBridge);
