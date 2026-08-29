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
 * The shape exposed on `window.mezan` by the preload bridge. Kept minimal —
 * one `fetch`-shaped call, plus print-to-PDF — so the renderer's HTTP client
 * abstraction only has to swap the `fetch` implementation between editions
 * (real `fetch` online, `window.mezan.fetch` on desktop), never branch on
 * platform. `printToPDF` backs the desktop path of @mezan/ui's
 * `useElectronPrintToPdf` (docs/archive/plan.md §2.4) — it renders the SAME print
 * DOM the browser edition prints via `window.print()`, just via
 * `webContents.printToPDF` on the main-process side (main/ipc.ts) instead.
 */
export interface MezanBridge {
  fetch(input: string, init?: RequestInit): Promise<IpcFetchResponse>;
  printToPDF(options?: PrintToPdfOptions): Promise<Uint8Array>;
}
