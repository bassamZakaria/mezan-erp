import path from "node:path";

/**
 * Path resolution for the `app://` renderer scheme, kept free of any Electron
 * import so it can be unit-tested headlessly — the binary is deliberately not
 * installed in this workspace (pnpm-workspace.yaml `allowBuilds.electron:
 * false`), so anything importing `electron` cannot run under vitest.
 */

/**
 * Resolves a request path to a file inside the renderer root, or `null` if it
 * escapes it.
 *
 * The containment check is the security boundary of this module: without it a
 * request for `app://mezan/../../../etc/passwd` would be served, because the
 * handler runs in the main process with the user's full filesystem rights.
 * `path.normalize` alone is not enough — the comparison has to be made against
 * the RESOLVED path, with a trailing separator so `/web-other` cannot pass a
 * `startsWith("/web")` test.
 */
export function resolveRendererFile(root: string, requestPath: string): string | null {
  // A URL pathname is percent-encoded and always starts with "/"; an Arabic or
  // spaced filename arrives escaped and must be decoded before it hits the fs.
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const resolvedRoot = path.resolve(root);
  const contains = (candidate: string): boolean =>
    candidate === resolvedRoot || candidate.startsWith(resolvedRoot + path.sep);

  // Containment is checked on EVERY path, before deciding what the path is.
  // Doing it the other way round — route-or-asset first, containment only on
  // the asset branch — leaves the check reachable only by one branch, so a
  // traversal that happens to look like a route skips it entirely. Nothing
  // leaked, because a route resolves to index.html regardless, but a security
  // check that only some inputs reach is one refactor from being a real hole.
  const requested = path.resolve(resolvedRoot, decoded.replace(/^\/+/, ""));
  if (!contains(requested)) return null;

  // The SPA serves one document. Any path without a file extension is a route
  // (`/sell/quotes`), not an asset, so it resolves to the entry document and
  // lets the client router read the address — the same rewrite a static host
  // performs for a single-page app.
  if (path.extname(decoded) === "") return path.join(resolvedRoot, "index.html");
  return requested;
}
