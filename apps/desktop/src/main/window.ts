import { BrowserWindow } from "electron";
import { preloadPath, rendererEntry } from "./env.js";

/**
 * Creates the single main window. Secure defaults throughout: context
 * isolation on, the renderer sandboxed, no Node integration — the renderer's
 * only capability is the narrow `window.mezan` bridge the preload script
 * installs (preload/index.ts). Loads the Vite dev server in development and
 * the packaged `web` bundle in production (see env.ts).
 */
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  const entry = rendererEntry();
  if ("url" in entry) {
    void win.loadURL(entry.url);
  } else {
    void win.loadFile(entry.file);
  }

  return win;
}
