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
