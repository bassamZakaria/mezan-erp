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
/**
 * Content Security Policy for the packaged renderer.
 *
 * The window's `webPreferences` decide what the renderer MAY DO; this decides
 * what it may LOAD. Without it a single injected string — an item name, a
 * customer note, anything that reaches `dangerouslySetInnerHTML` — could pull
 * a script off the internet inside the origin that holds the books.
 *
 * `default-src 'none'` and add back only what the built SPA needs: its own
 * bundles, its own styles (Tailwind emits a stylesheet, but component
 * libraries still set inline `style` attributes), data/blob images for
 * generated barcodes and previews, and connections to itself. The renderer
 * reaches the backend over the IPC bridge, not over the network, so
 * `connect-src` never needs a remote host.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export function serveRenderer(root: string): void {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== RENDERER_HOST) return new Response("Not found", { status: 404 });

    const file = resolveRendererFile(root, url.pathname);
    if (!file) return new Response("Forbidden", { status: 403 });

    // `net.fetch` over a file URL keeps streaming and correct MIME sniffing,
    // rather than reading whole bundles into memory to hand back a Response.
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
    headers.set("x-content-type-options", "nosniff");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

/** True once the app is packaged; dev still loads the Vite server over HTTP. */
export function shouldServeRenderer(): boolean {
  return app.isPackaged;
}
