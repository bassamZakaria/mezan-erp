import { ipcMain } from "electron";
import type { App } from "@mezan/api";
import {
  MEZAN_FETCH_CHANNEL,
  MEZAN_PRINT_TO_PDF_CHANNEL,
  type IpcFetchRequest,
  type IpcFetchResponse,
  type PrintToPdfOptions,
} from "../shared/ipc-contract.js";

/**
 * Registers the single IPC handler that carries every renderer request into
 * the shared Hono app. There is no HTTP server and no port on desktop
 * (docs/archive/plan.md §2.2): the preload bridge marshals a `Request` over IPC and
 * this handler calls `honoApp.fetch(new Request(...))` in-process, returning
 * the response as a structured-clone-safe plain object.
 */
export function registerHonoOverIpc(honoApp: App): void {
  ipcMain.handle(
    MEZAN_FETCH_CHANNEL,
    async (_event, req: IpcFetchRequest): Promise<IpcFetchResponse> => {
      const response = await honoApp.fetch(
        new Request(req.url, {
          method: req.method ?? "GET",
          headers: req.headers,
          body: req.body,
        }),
      );
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        status: response.status,
        headers,
        body: await response.text(),
      };
    },
  );
}

/**
 * The CLIENT-machine counterpart of {@link registerHonoOverIpc}: the same
 * channel and the same response shape, answered by the host over the network
 * instead of by a Hono app in this process (main/lan-client.ts).
 *
 * Registering one or the other is the entire host/client branch as the renderer
 * experiences it. A client build has no database, no backend and no LAN socket
 * of its own — the ONE copy of the books stays on the host — so there is no
 * second app instance here for a request to accidentally reach.
 *
 * A transport failure is answered as a real HTTP response, not by rejecting the
 * IPC call: `window.mezan.fetch` is the renderer's `fetch`, every data hook
 * reads `status` off it, and an IPC rejection surfaces as an unhandled promise
 * with an Electron-shaped message instead of the screen's own error state. 502
 * with a body the UI can render is what the shell already knows how to show.
 */
export function registerHonoOverLanClient(
  forward: (path: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>,
): void {
  ipcMain.handle(
    MEZAN_FETCH_CHANNEL,
    async (_event, req: IpcFetchRequest): Promise<IpcFetchResponse> => {
      // The renderer addresses `http://mezan.local/sales-invoices` (see
      // apps/web's createElectronTransport — `new Request()` rejects a bare
      // pathname). Only the path travels; the host is the paired one.
      const url = new URL(req.url);
      try {
        const response = await forward(`${url.pathname}${url.search}`, {
          method: req.method ?? "GET",
          headers: req.headers,
          body: req.body,
        });
        // Every refusal, once, with the method and path. A client that cannot
        // read anything looks identical from the screen whether the host is
        // refusing it a seat, refusing its session, or genuinely lacks the
        // route — and the renderer shows the same empty state for all three.
        // This line is the only place a consultant can tell them apart, and its
        // absence cost a whole debugging pass on the first two-machine run.
        if (response.status >= 400) {
          console.warn(`[client] ${req.method ?? "GET"} ${url.pathname} -> ${response.status}`);
        }
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[client] request to the host failed", err);
        return {
          status: 502,
          headers: { "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            error: "HOST_UNREACHABLE",
            message: `تعذّر الوصول إلى الجهاز الرئيسي. Could not reach the main machine. ${message}`,
          }),
        };
      }
    },
  );
}

/**
 * Registers the `printToPDF` IPC handler (docs/archive/plan.md §2.4). `event.sender`
 * is the `webContents` of whichever renderer window invoked the call, so
 * this needs no window reference of its own — it prints exactly the page
 * that asked, the same print DOM the browser edition renders via
 * `window.print()`.
 */
export function registerPrintToPdfOverIpc(): void {
  ipcMain.handle(
    MEZAN_PRINT_TO_PDF_CHANNEL,
    async (event, options?: PrintToPdfOptions): Promise<Uint8Array> => {
      const pdf = await event.sender.printToPDF({
        landscape: options?.landscape ?? false,
        pageSize: options?.pageSize ?? "A4",
      });
      return new Uint8Array(pdf);
    },
  );
}
