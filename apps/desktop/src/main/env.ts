import { app } from "electron";
import path from "node:path";
import { RENDERER_ENTRY_URL } from "./renderer-protocol.js";

/**
 * Small environment/paths helpers, kept in one place so the rest of the main
 * process never inlines `app.isPackaged`/`__dirname`-style logic. Every
 * function here calls into the real Electron `app` singleton, so — unlike
 * the rest of main/** and backup/** — this module is exercised at Electron
 * runtime only, never imported by vitest. It still typechecks headlessly in
 * CI because `electron`'s type declarations install without the binary
 * (ELECTRON_SKIP_BINARY_DOWNLOAD=1, pnpm-workspace.yaml `allowBuilds.electron:
 * false` — see root CI workflow).
 *
 * `__dirname` here (not `import.meta.url`) deliberately: scripts/build.mjs
 * bundles main/preload to CommonJS (Electron's preload sandbox still
 * expects CJS), where esbuild rewrites `__dirname` to the real output
 * location — `import.meta` is unavailable in that output format.
 */
const moduleDir = __dirname;

/** True during `pnpm --filter desktop start` against the Vite dev server. */
export function isDev(): boolean {
  return !app.isPackaged;
}

/** Absolute path to the bundled preload script (see scripts/build.mjs). */
export function preloadPath(): string {
  return path.join(moduleDir, "..", "preload", "index.cjs");
}

/**
 * The URL the main window loads. Dev: the Vite dev server (overridable via
 * MEZAN_WEB_DEV_SERVER_URL for a non-default port). Production: the `app://`
 * origin backed by the `web` bundle electron-builder copies into
 * `resources/web` via `extraResources` (see electron-builder.yml).
 */
export function rendererEntry(): { url: string } {
  if (isDev()) {
    return { url: process.env["MEZAN_WEB_DEV_SERVER_URL"] ?? "http://localhost:5173" };
  }
  // Production is served over the custom `app://` scheme, never file:// —
  // see main/renderer-protocol.ts for why file:// cannot carry this renderer.
  return { url: RENDERER_ENTRY_URL };
}

/** Directory electron-builder copies the built web bundle into. */
export function rendererRoot(): string {
  return path.join(process.resourcesPath, "web");
}

/**
 * Default on-disk locations. The live database lives under Electron's
 * per-user app-data directory; backups are written OUTSIDE it (a sibling
 * "Mezan Backups" folder under the OS documents/user-data root) so an
 * uninstall — which typically wipes `userData` — never destroys them
 * (docs/archive/plan.md §3.7).
 */
export function defaultDbPath(): string {
  return path.join(app.getPath("userData"), "mezan.db");
}

export function defaultBackupsDir(): string {
  return path.join(path.dirname(app.getPath("userData")), "Mezan Backups");
}
