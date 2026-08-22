import { app, BrowserWindow, ipcMain } from "electron";
import { createApp } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";

/**
 * Desktop-edition (Electron main process) skeleton.
 *
 * The architectural point this proves — and that the rest of Phase 0 builds on
 * — is that there is NO HTTP server and NO port on desktop. The renderer
 * marshals a request over IPC; the main process calls the SAME Hono app via
 * `app.fetch(new Request(...))` in-process and returns the response. This is a
 * skeleton: real electron-updater, backup/restore and the OS-keychain session
 * seal are later Phase 0 issues (docs/backlog.md Phase 0).
 */

const IPC_FETCH_CHANNEL = "mezan:fetch";

interface IpcFetchRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

interface IpcFetchResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export function registerHonoOverIpc(dbPath: string): void {
  const uow = createSqliteUnitOfWork(dbPath);
  const honoApp = createApp(uow);

  ipcMain.handle(
    IPC_FETCH_CHANNEL,
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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // In production the packaged `web` bundle is loaded here; wired in a later issue.
  void win;
}

app.whenReady().then(() => {
  registerHonoOverIpc(":memory:");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
