import { navGroupSpecs } from "./nav-config";
import type { ScreenKey } from "./App";

/**
 * Hash-based routing for the shell.
 *
 * Every screen has a URL, and a screen's sub-pages — "new", a document id —
 * are path segments under it, so `عرض سعر جديد` is `#/sales/quotes/new` and a
 * document is `#/sales/quotes/<id>`, the way the reference product does it.
 * Before this, a create form was a side panel with no address: it could not be
 * linked, bookmarked, reloaded into, reached with the browser's Back button,
 * or deep-linked to from another screen.
 *
 * The HASH, not the path, carries the route: the desktop edition loads the
 * built app from `file://` through Electron, where a pushState path has no
 * server to resolve it on reload. A hash survives that, and needs no dev-server
 * rewrite either.
 */

/** `<group>/<item>` for every screen in the nav tree — `quotes` → `sales/quotes`. */
const PATH_BY_SCREEN = new Map<string, string>();
const SCREEN_BY_PATH = new Map<string, string>();

for (const group of navGroupSpecs) {
  for (const key of group.itemKeys) {
    const path = `${group.key}/${key}`;
    PATH_BY_SCREEN.set(key, path);
    SCREEN_BY_PATH.set(path, key);
  }
}
// Screens the nav tree does not list: they address as their own bare key.
for (const key of ["users", "roles", "role-editor", "dashboard"]) {
  if (!PATH_BY_SCREEN.has(key)) {
    PATH_BY_SCREEN.set(key, key);
    SCREEN_BY_PATH.set(key, key);
  }
}

export interface Route {
  readonly screen: ScreenKey;
  /** Everything after the screen's own path — `["new"]`, `["QT-000004"]`, `[]`. */
  readonly segments: readonly string[];
}

export function hashForRoute(screen: ScreenKey, segments: readonly string[] = []): string {
  const base = PATH_BY_SCREEN.get(screen) ?? screen;
  const tail = segments.filter((s) => s !== "").map(encodeURIComponent).join("/");
  return `#/${tail === "" ? base : `${base}/${tail}`}`;
}

/**
 * Longest-prefix match, so a screen path containing a slash still resolves
 * when sub-segments follow it.
 */
export function parseHash(hash: string, fallback: ScreenKey): Route {
  const raw = hash.replace(/^#\/?/, "");
  if (raw === "") return { screen: fallback, segments: [] };
  const parts = raw.split("/").filter((p) => p !== "");
  for (let take = Math.min(parts.length, 2); take >= 1; take -= 1) {
    const candidate = parts.slice(0, take).join("/");
    const screen = SCREEN_BY_PATH.get(candidate);
    if (screen) {
      return { screen: screen as ScreenKey, segments: parts.slice(take).map(decodeURIComponent) };
    }
  }
  return { screen: fallback, segments: [] };
}
