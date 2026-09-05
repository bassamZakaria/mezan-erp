import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  MEZAN_BACKUP_CREATE_CHANNEL,
  MEZAN_BACKUP_LIST_CHANNEL,
  MEZAN_BACKUP_RESTORE_CHANNEL,
  MEZAN_FETCH_CHANNEL,
  MEZAN_LICENCE_STATUS_CHANNEL,
  MEZAN_PRINT_TO_PDF_CHANNEL,
  MEZAN_UPDATE_EVENT_CHANNEL,
  MEZAN_UPDATE_INVOKE_CHANNEL,
  type BackupCreateResult,
  type BackupFailure,
  type BackupListResult,
  type BackupRestoreResult,
  type IpcFetchRequest,
  type IpcFetchResponse,
  type LicenceStatusResult,
  type MezanBridge,
  type PrintToPdfOptions,
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
  printToPDF(options?: PrintToPdfOptions): Promise<Uint8Array> {
    return ipcRenderer.invoke(MEZAN_PRINT_TO_PDF_CHANNEL, options);
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
  },
};

contextBridge.exposeInMainWorld("mezan", mezanBridge);
