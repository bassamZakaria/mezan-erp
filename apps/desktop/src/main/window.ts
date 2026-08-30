import { BrowserWindow, shell } from "electron";
import { preloadPath, rendererEntry } from "./env.js";
import { RENDERER_HOST, RENDERER_SCHEME } from "./renderer-protocol.js";

/**
 * Origins the renderer may navigate to. Everything else is a link, and a link
 * belongs in the user's browser — never in the window that holds the books.
 */
function isRendererOrigin(target: string, entry: string): boolean {
  try {
    const url = new URL(target);
    // The renderer's own scheme, and only its own host. `app://` is standard
    // to Chromium because `registerSchemesAsPrivileged` says so, but Node's
    // `URL` does not share that registry, so the host has to be checked here.
    if (url.protocol === `${RENDERER_SCHEME}:`) return url.host === RENDERER_HOST;

    const entryUrl = new URL(entry);
    // NEVER compare `origin` when either side can serialise to the STRING
    // "null". `app:`, `file:`, `javascript:` and `data:` all do, so in a
    // packaged build — where the entry is `app://mezan/index.html` — an origin
    // comparison returned true for `file:///etc/passwd` and for
    // `javascript:`, handing the `window.mezan` bridge (the whole Hono app) to
    // whatever document landed there. Development was unaffected, because the
    // Vite entry has a real origin, so this never showed up in a dev run.
    if (url.origin === "null" || entryUrl.origin === "null") return false;
    // Development only: the Vite dev server IS the renderer.
    return url.origin === entryUrl.origin;
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
