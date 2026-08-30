import { ipcMain, type BrowserWindow } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { isDev } from "./env.js";
import {
  MEZAN_UPDATE_EVENT_CHANNEL,
  MEZAN_UPDATE_INVOKE_CHANNEL,
  type UpdateAction,
  type UpdateStatus,
} from "../shared/ipc-contract.js";
import { primaryArtifactSha512, verifyUpdateSignature } from "./update-verify.js";

/**
 * Signed auto-update channel (docs/archive/plan.md §2.3).
 *
 * The danger this module is built around: electron-updater on its own verifies
 * a download against the OS PUBLISHER identity the app was code-signed with, and
 * this build is not yet code-signed. Left as it first shipped — a launch-time
 * `checkForUpdates()` with `autoInstallOnAppQuit = true` against a placeholder
 * feed — that was a one-DNS-record path to running a stranger's code inside the
 * process that holds the shop's books, on every install at once, on the next
 * quit, with no operator action.
 *
 * Two independent safeguards close that, and BOTH must hold:
 *   1. App-level Ed25519 verification (main/update-verify.ts). Nothing is ever
 *      downloaded or installed unless a detached signature over the release's
 *      SHA-512 verifies against the vendor key (`MEZAN_UPDATE_PUBLIC_KEY`). This
 *      does not depend on OS code-signing and refuses an unsigned/placeholder
 *      feed outright (no key → no download). It is the offline-first trust
 *      anchor; OS notarization/signing remains a separate vendor-cert step.
 *   2. User consent. autoDownload/autoInstallOnAppQuit are always false — the
 *      renderer surfaces "available" and the user chooses download, then
 *      install. Nothing swaps the running app underneath a till mid-sale.
 *
 * The launch-time check stays OFF unless the operator opts in
 * (`MEZAN_AUTO_UPDATE=1`) and, even then, waits for closing time so a download
 * never competes with the counter. User-initiated actions over IPC are always
 * available (each still gated by (1) and (2) above).
 *
 * Config baked by the release build, overridable by env:
 *   - MEZAN_UPDATE_PUBLIC_KEY : vendor Ed25519 public key (hex)
 *   - MEZAN_UPDATE_FEED_URL   : base URL of the update feed (matches
 *                               electron-builder.yml `publish.url`)
 */

const VENDOR_UPDATE_PUBLIC_KEY_HEX = ""; // set by the release build

/** Opts the launch-time check in at all. Absent or not "1" means it never runs on launch. */
const ENABLE_FLAG = "MEZAN_AUTO_UPDATE";

/** Shop hours, local time — the launch check waits until the shop is closed. */
const BUSINESS_HOURS_START = 8;
const BUSINESS_HOURS_END = 23;

function isBusinessHours(now: Date): boolean {
  const hour = now.getHours();
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

let latestInfo: UpdateInfo | null = null;
let signatureVerified = false;

function send(win: BrowserWindow, status: UpdateStatus): void {
  if (!win.isDestroyed()) win.webContents.send(MEZAN_UPDATE_EVENT_CHANNEL, status);
}

function feedBaseUrl(env: Record<string, string | undefined>): string | null {
  const fromEnv = env["MEZAN_UPDATE_FEED_URL"];
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    const configured = autoUpdater.getFeedURL();
    return configured ? configured.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/**
 * Fetches the detached signature (`<feed>/<version>.sig`) and verifies it over
 * the release's SHA-512. Returns the reason on failure, or null on success.
 */
async function verifyRelease(
  info: UpdateInfo,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  const publicKeyHex = env["MEZAN_UPDATE_PUBLIC_KEY"] || VENDOR_UPDATE_PUBLIC_KEY_HEX;
  if (!publicKeyHex) return "NO_PUBLIC_KEY";

  const sha512 = primaryArtifactSha512(info);
  if (!sha512) return "NO_ARTIFACT_HASH";

  const base = feedBaseUrl(env);
  if (!base) return "NO_FEED_URL";

  let signatureB64: string;
  try {
    const res = await fetch(`${base}/${info.version}.sig`);
    if (!res.ok) return "SIGNATURE_UNAVAILABLE";
    signatureB64 = (await res.text()).trim();
  } catch {
    return "SIGNATURE_FETCH_FAILED";
  }

  const ok = await verifyUpdateSignature({ publicKeyHex, sha512, signatureB64 });
  return ok ? null : "SIGNATURE_INVALID";
}

/**
 * Wires the updater to a window and registers the renderer-driven IPC handler.
 * User-initiated actions (check/download/install) are always available and each
 * is Ed25519-verified; the LAUNCH auto-check runs only on explicit opt-in and
 * outside shop hours. No-op in dev.
 */
export function registerAutoUpdater(
  win: BrowserWindow,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): void {
  if (isDev()) return;

  // Never silent, never auto-installed — consent + verification gate every step.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("error", (err) => {
    send(win, { phase: "error", reason: err instanceof Error ? err.message : "UPDATE_ERROR" });
  });
  autoUpdater.on("update-available", (info) => {
    latestInfo = info;
    signatureVerified = false;
    send(win, {
      phase: "available",
      version: info.version,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
  });
  autoUpdater.on("update-not-available", () => {
    latestInfo = null;
    send(win, { phase: "not-available" });
  });
  autoUpdater.on("download-progress", (p) => {
    send(win, { phase: "downloading", percent: Math.round(p.percent), version: latestInfo?.version });
  });
  autoUpdater.on("update-downloaded", (info) => {
    send(win, { phase: "ready", version: info.version });
  });

  ipcMain.handle(
    MEZAN_UPDATE_INVOKE_CHANNEL,
    async (_event, action: UpdateAction): Promise<UpdateStatus> => {
      switch (action) {
        case "check": {
          send(win, { phase: "checking" });
          try {
            const result = await autoUpdater.checkForUpdates();
            const info = result?.updateInfo;
            if (!info) return { phase: "not-available" };
            return {
              phase: "available",
              version: info.version,
              releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
            };
          } catch (err) {
            return { phase: "error", reason: err instanceof Error ? err.message : "CHECK_FAILED" };
          }
        }
        case "download": {
          if (!latestInfo) return { phase: "error", reason: "NO_UPDATE" };
          // Verify authenticity BEFORE downloading — a release that cannot be
          // proven to come from the vendor key is never fetched or applied.
          send(win, { phase: "verifying", version: latestInfo.version });
          const reason = await verifyRelease(latestInfo, env);
          if (reason) {
            signatureVerified = false;
            return { phase: "rejected", version: latestInfo.version, reason };
          }
          signatureVerified = true;
          try {
            await autoUpdater.downloadUpdate();
            return { phase: "downloading", version: latestInfo.version };
          } catch (err) {
            return { phase: "error", reason: err instanceof Error ? err.message : "DOWNLOAD_FAILED" };
          }
        }
        case "install": {
          // Never install something we did not verify and download.
          if (!signatureVerified) return { phase: "rejected", reason: "NOT_VERIFIED" };
          autoUpdater.quitAndInstall();
          return { phase: "ready", version: latestInfo?.version };
        }
        default:
          return { phase: "idle" };
      }
    },
  );

  // Launch-time check: opt-in only, and only outside shop hours.
  if (env[ENABLE_FLAG] !== "1") {
    console.log(
      `[updater] launch check disabled. Set ${ENABLE_FLAG}=1 to check on launch; ` +
        "user-initiated checks are always available and every update is signature-verified.",
    );
    return;
  }
  if (isBusinessHours(now)) {
    console.log(
      `[updater] launch check skipped: shop hours (${BUSINESS_HOURS_START}:00–${BUSINESS_HOURS_END}:00 local).`,
    );
    return;
  }
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    // Never fatal — an offline install with no feed configured is the common
    // case, not an error state.
    console.warn("[updater] launch check failed (expected if offline / no feed)", err);
  });
}
