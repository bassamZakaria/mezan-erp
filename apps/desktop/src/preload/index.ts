import { contextBridge, ipcRenderer } from "electron";
import {
  MEZAN_FETCH_CHANNEL,
  type IpcFetchRequest,
  type IpcFetchResponse,
  type MezanBridge,
} from "../shared/ipc-contract.js";

/**
 * Secure preload bridge. Runs with `contextIsolation: true` / `sandbox: true`
 * / `nodeIntegration: false` (see main/window.ts) — the renderer never gets
 * direct Node or Electron access, only this single, narrow, typed surface.
 *
 * `window.mezan.fetch` marshals a `Request` over IPC to the main process,
 * which calls the shared Hono app's `app.fetch()` in-process and returns the
 * response (docs/plan.md §2.2). The renderer's HTTP client abstraction swaps
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
};

contextBridge.exposeInMainWorld("mezan", mezanBridge);
