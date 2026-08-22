import { autoUpdater } from "electron-updater";
import { isDev } from "./env.js";

/**
 * electron-updater scaffolding — CONFIG ONLY.
 *
 * What this wires: the `publish` target lives in electron-builder.yml
 * (generic/GitHub-releases — swap for the real distribution channel later),
 * and this module points `autoUpdater` at it, checks once on launch, and
 * logs state transitions.
 *
 * What this deliberately does NOT do (Phase 0 scope — see PR description):
 * code-signing or notarization. Unsigned auto-updates are actively unsafe —
 * most OSes will refuse or scarily warn on an unsigned auto-update — so
 * `checkForUpdatesAndNotify()` is only ever called against a packaged build,
 * never in dev/CI, and the signing/notarization config in
 * electron-builder.yml is left as documented TODO stubs for a later issue.
 */
export function initAutoUpdater(): void {
  if (isDev()) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.error("[updater] error", err);
  });
  autoUpdater.on("update-available", (info) => {
    console.log("[updater] update available", info.version);
  });
  autoUpdater.on("update-not-available", () => {
    console.log("[updater] up to date");
  });

  autoUpdater.checkForUpdates().catch((err: unknown) => {
    // Never fatal — an offline desktop install with no update feed
    // configured yet is the expected common case, not an error state.
    console.warn("[updater] check failed (expected if offline / no feed configured)", err);
  });
}
