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
  // The URL stays `<group>/<item>` even for items nested in a section: a
  // section is a grouping in the rail, not a routing level, so adding one
  // never changes an existing address.
  const keys = [...group.itemKeys, ...(group.sections ?? []).flatMap((section) => section.itemKeys)];
  for (const key of keys) {
    const path = `${group.key}/${key}`;
    PATH_BY_SCREEN.set(key, path);
    SCREEN_BY_PATH.set(path, key);
  }
}
/**
 * Screens the nav tree no longer lists, and the workspace each still belongs
 * to. They are all reachable — `labels` from الأصناف's «طباعة الملصقات», the
 * three item screens as tabs of `items`, `stock-balance` from the hub's own
 * quick action, `production-dashboard` from the manufacturing hub, and the
 * four reports as views inside their surviving sibling — so each keeps the
 * SAME address it had while it was in the tree. Dropping a nav row must not
 * silently change a URL, or every saved link and drill-down into it breaks.
 */
const UNLISTED_SCREEN_GROUP: Record<string, string> = {
  labels: "stock",
  "product-templates": "stock",
  "configurable-products": "stock",
  "item-specifications": "stock",
  "report-inventory-movement": "stock",
  "report-inventory-expiring": "stock",
  "report-inventory-slow-moving": "stock",
  "report-inventory-drift": "stock",
  boms: "manufacturing",
};
for (const [key, group] of Object.entries(UNLISTED_SCREEN_GROUP)) {
  if (PATH_BY_SCREEN.has(key)) continue;
  const path = `${group}/${key}`;
  PATH_BY_SCREEN.set(key, path);
  SCREEN_BY_PATH.set(path, key);
}

// Screens the nav tree does not list: they address as their own bare key.
for (const key of ["users", "roles", "role-editor", "dashboard", "notifications"]) {
  if (!PATH_BY_SCREEN.has(key)) {
    PATH_BY_SCREEN.set(key, key);
    SCREEN_BY_PATH.set(key, key);
  }
}

/** The nav group a screen belongs to — `quotes` → `sales`. */
export function groupKeyForScreen(screen: string): string | null {
  const path = PATH_BY_SCREEN.get(screen);
  if (!path || !path.includes("/")) return null;
  return path.split("/")[0] ?? null;
}

/**
 * Where a group's own breadcrumb crumb goes: its hub screen (`sales` →
 * `sales-hub`), and where a group has none (HR, projects, installments…), its
 * first screen — so the crumb is a way back rather than dead text.
 */
export function hubScreenForGroup(groupKey: string): string | null {
  const hub = `${groupKey}-hub`;
  if (PATH_BY_SCREEN.has(hub)) return hub;
  const group = navGroupSpecs.find((g) => g.key === groupKey);
  if (!group) return null;
  return group.itemKeys[0] ?? group.sections?.[0]?.itemKeys[0] ?? null;
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
