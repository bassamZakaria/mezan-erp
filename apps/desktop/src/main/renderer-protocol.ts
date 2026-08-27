import { app, net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { resolveRendererFile } from "./renderer-paths.js";

/**
 * Serves the built renderer over a custom `app://` origin instead of `file://`.
 *
 * `file://` cannot carry this app. Chromium treats every `file://` document as
 * an opaque origin, which means:
 *   - a `<script type="module">` is refused as a cross-origin request, and the
 *     Vite build emits exactly that;
 *   - `import()` of a route chunk is refused for the same reason, so the
 *     code-split build would never load a screen;
 *   - absolute asset paths (`/assets/index-x.js`, which is what Vite emits
 *     with the default `base`) resolve against the FILESYSTEM ROOT rather than
 *     the app directory.
 *
 * A registered scheme fixes all three at once: it is a real, secure origin, so
 * module scripts and dynamic imports load normally and absolute paths resolve
 * against the renderer root below. It also leaves the door open to dropping
 * the URL hash later — `app://` supports history.pushState, `file://` does not.
 *
 * The scheme is registered as `standard` (so it has a proper origin and
 * resolves relative/absolute URLs), `secure` (so it counts as a trustworthy
 * origin and is not blocked as mixed content), and `supportFetchAPI` (so the
 * renderer can fetch its own assets). It is deliberately NOT `corsEnabled`:
 * nothing outside this origin should be able to read the app's files.
 */
export const RENDERER_SCHEME = "app";

/** The single host under the scheme. `app://mezan/index.html` is the entry. */
export const RENDERER_HOST = "mezan";

export const RENDERER_ENTRY_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`;

/**
 * Must run BEFORE `app.whenReady()` — Chromium reads the scheme registry once,
 * during startup, and a scheme registered after that is treated as an ordinary
 * unknown scheme with no origin.
 */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Must run AFTER `app.whenReady()`. The root is passed in rather than imported
 * from env.ts, which imports RENDERER_ENTRY_URL from here — taking it as an
 * argument keeps the two modules acyclic.
 */
export function serveRenderer(root: string): void {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== RENDERER_HOST) return new Response("Not found", { status: 404 });

    const file = resolveRendererFile(root, url.pathname);
    if (!file) return new Response("Forbidden", { status: 403 });

    // `net.fetch` over a file URL keeps streaming and correct MIME sniffing,
    // rather than reading whole bundles into memory to hand back a Response.
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** True once the app is packaged; dev still loads the Vite server over HTTP. */
export function shouldServeRenderer(): boolean {
  return app.isPackaged;
}
