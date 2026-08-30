import { BrowserWindow, shell, type WebContents } from "electron";
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
 * Hosts a link inside the product may open in the user's browser.
 *
 * EMPTY, and correct today: this handler used to hand ANY http(s) URL the
 * renderer produced to `shell.openExternal`, which is the OS "open this in
 * whatever handles it" call — and apps/web contains no external link at all, so
 * every URL that could ever have reached it came from somewhere other than a
 * link the product authored: a supplier name rendered into an anchor, an
 * imported file's contents, a compromised renderer. There was nothing to allow,
 * and allowing everything protected nothing.
 *
 * Add a host here when the product genuinely starts linking out (a help site, a
 * licence portal, the ETA e-invoicing portal). One host per line, with the
 * screen that links to it named — not a suffix match, because
 * `mezan.example.attacker.test` ends with the same characters.
 */
export const EXTERNAL_LINK_ALLOWED_HOSTS: readonly string[] = [];

export function isAllowedExternalLink(
  target: string,
  allowedHosts: readonly string[] = EXTERNAL_LINK_ALLOWED_HOSTS,
): boolean {
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    // Exact host equality. A `endsWith(".mezan.test")` check — the shape this
    // reaches for first — also admits `mezan.test.attacker.example`, and a
    // `includes()` admits anything at all.
    return allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// One registration per frame. `hardenWebContents` is called from two places by
// design — `createWindow` for the frame it just built, and the app-wide
// `web-contents-created` catch-all in main/index.ts for every frame nobody
// remembered — and a `will-navigate` listener added twice would run twice.
const hardened = new WeakSet<WebContents>();

/**
 * The navigation posture, applied to ONE frame.
 *
 * This lived inline in `createWindow` and was therefore bound to that single
 * `webContents` — so the main window was hardened and nothing else was. Any
 * other frame the app ever creates (a devtools-spawned view, a `<webview>`, a
 * future second window someone adds without reading this file) started with
 * Electron's defaults: free navigation, and `window.open` producing a child
 * frame that inherits none of the `webPreferences` below.
 */
export function hardenWebContents(contents: WebContents, entry: string): void {
  if (hardened.has(contents)) return;
  hardened.add(contents);

  // No child windows. A link to an allow-listed host opens in the real browser,
  // where the user can see the address bar; everything else is refused, and
  // says so in the log rather than failing silently — a refusal nobody can see
  // reads as a broken button.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalLink(url)) {
      void shell.openExternal(url);
    } else {
      console.warn(`[window] refused to open ${url} externally — host is not on the allow-list`);
    }
    return { action: "deny" };
  });

  // The window shows this app or nothing. A navigation away from the renderer
  // origin is either a bug or an attack, and both end the same way.
  contents.on("will-navigate", (event, url) => {
    if (!isRendererOrigin(url, entry)) event.preventDefault();
  });

  // `<webview>` is off at the `webPreferences` level, but that flag is per
  // frame and this refusal is not: a webview attaches with its OWN preferences
  // object, which is the one place an app can hand out a frame with Node
  // integration on without ever writing `nodeIntegration: true`.
  contents.on("will-attach-webview", (event) => {
    console.warn("[window] refused a <webview> attachment — this product embeds no third-party frames");
    event.preventDefault();
  });
}

/**
 * Creates the single main window. Secure defaults throughout: context
 * isolation on, the renderer sandboxed, no Node integration — the renderer's
 * only capability is the narrow `window.mezan` bridge the preload script
 * installs (preload/index.ts). Loads the Vite dev server in development and
 * the packaged `web` bundle in production (see env.ts).
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

  hardenWebContents(win.webContents, entry);

  // Always a URL now: dev is the Vite server, production is the `app://`
  // origin. loadFile() is deliberately not used — it yields a file:// document,
  // whose opaque origin refuses module scripts and route chunks.
  void win.loadURL(entry);

  return win;
}
