import { autoUpdater } from "electron-updater";
import { isDev } from "./env.js";

/**
 * electron-updater scaffolding — OFF BY DEFAULT, and it stays off until
 * somebody turns it on deliberately.
 *
 * WHAT THIS USED TO DO, AND WHY THAT WAS THE WRONG DEFAULT. Every packaged
 * launch called `checkForUpdates()` against the placeholder feed in
 * electron-builder.yml with `autoInstallOnAppQuit = true` set beforehand. That
 * is a shipped remote-code-execution path waiting on one DNS record: nothing in
 * this build is code-signed (see the TODOs in electron-builder.yml), so
 * electron-updater has no publisher identity to verify a downloaded package
 * against — whatever answered `updates.mezan.example` would have been installed
 * on the next quit, into the process that holds the shop's books, on every
 * install in the field at once, with no operator action.
 *
 * The two things that have to be true before this may be re-enabled are (a) a
 * real code-signing certificate on Windows and a Developer ID + notarization on
 * macOS, so a package that is not ours is refused before it is unpacked, and
 * (b) a real feed URL under our control. Until then the opt-in below exists for
 * exactly one purpose: testing the update plumbing on a machine somebody is
 * sitting in front of.
 */

/** Turns the updater on at all. Absent or anything but "1" means it never runs. */
const ENABLE_FLAG = "MEZAN_AUTO_UPDATE";
/**
 * Separate from the flag above, and deliberately so. Turning the updater on to
 * watch it log a version is not the same decision as letting it write an
 * unverified binary over the installed app, so "download and install" needs its
 * own explicit yes and must not ride along on the first one.
 */
const ALLOW_INSTALL_FLAG = "MEZAN_AUTO_UPDATE_INSTALL";

/**
 * The hours a shop is open, local time. A till that is mid-sale must not have
 * the app it is running replaced underneath it, and an update download must not
 * compete with the counter for a 4G dongle's bandwidth — so even with both
 * flags set, the check waits for closing time. Cheap, and it is the difference
 * between "the update landed overnight" and "the update landed at the Friday
 * lunch rush", which is the failure people remember.
 */
const BUSINESS_HOURS_START = 8;
const BUSINESS_HOURS_END = 23;

function isBusinessHours(now: Date): boolean {
  const hour = now.getHours();
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

export function initAutoUpdater(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): void {
  if (isDev()) return;

  if (env[ENABLE_FLAG] !== "1") {
    console.log(
      `[updater] disabled. This build is not code-signed, so a downloaded update ` +
        `cannot be verified as ours. Set ${ENABLE_FLAG}=1 to check for updates anyway.`,
    );
    return;
  }

  if (isBusinessHours(now)) {
    console.log(
      `[updater] skipped: shop hours (${BUSINESS_HOURS_START}:00–${BUSINESS_HOURS_END}:00 local). ` +
        "Updates are checked outside opening hours so nothing competes with the counter.",
    );
    return;
  }

  // Both false, always, in this build. `autoDownload` would fetch the package;
  // `autoInstallOnAppQuit` would swap the installed app for it on the next
  // quit. Neither is safe without signing, and neither is reachable by the
  // enable flag alone — the install flag below is what a signed release will
  // eventually set, and it is gated so that turning it on today is a visible,
  // logged act rather than a default.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  if (env[ALLOW_INSTALL_FLAG] === "1") {
    console.warn(
      `[updater] ${ALLOW_INSTALL_FLAG}=1 — downloading and installing UNSIGNED updates. ` +
        "Only ever correct on a test machine. Never set this on a customer install.",
    );
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  autoUpdater.on("error", (err) => {
    console.error("[updater] error", err);
  });
  autoUpdater.on("update-available", (info) => {
    console.log(
      `[updater] update available: ${info.version}. Not downloaded — install it from the ` +
        "signed installer, or set " +
        `${ALLOW_INSTALL_FLAG}=1 on a test machine.`,
    );
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
