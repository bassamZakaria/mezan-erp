import { BrowserWindow, shell } from "electron";
import { preloadPath, rendererEntry } from "./env.js";
import { RENDERER_SCHEME } from "./renderer-protocol.js";

/**
 * Origins the renderer may navigate to. Everything else is a link, and a link
 * belongs in the user's browser — never in the window that holds the books.
 */
function isRendererOrigin(target: string, entry: string): boolean {
  try {
    const url = new URL(target);
    if (url.protocol === `${RENDERER_SCHEME}:`) return true;
    // Development only: the Vite dev server IS the renderer.
    return url.origin === new URL(entry).origin;
  } catch {
    return false;
  }
}

/**
 * Creates the single main window. Secure defaults throughout: context
 * isolation on, the renderer sandboxed, no Node integration — the renderer's
 * only capability is the narrow `window.mezan` bridge the preload script
 * installs (preload/index.ts). Loads the Vite dev server in development and
 * the packaged `web` bundle in production (see env.ts).
 *
 * The two handlers below are the other half of that posture. Without them the
 * renderer could navigate this window to any URL on the internet, or open a
 * child window with `window.open` — and a child window inherits nothing from
 * these `webPreferences`, so it is the one place an Electron app hands out a
 * less-hardened frame than the one it configured.
 */
export function createWindow(): BrowserWindow {
  const entry = rendererEntry().url;
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

  // No child windows. An external http(s) link opens in the real browser,
  // where the user can see the address bar; anything else is refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // The window shows this app or nothing. A navigation away from the renderer
  // origin is either a bug or an attack, and both end the same way.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isRendererOrigin(url, entry)) event.preventDefault();
  });

  // Always a URL now: dev is the Vite server, production is the `app://`
  // origin. loadFile() is deliberately not used — it yields a file:// document,
  // whose opaque origin refuses module scripts and route chunks.
  void win.loadURL(entry);

  return win;
}
