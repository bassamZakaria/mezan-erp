import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, ipcMain, type BrowserWindow } from "electron";
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

/**
 * THE SIGNATURE GATE — ported from the pre-merge updater, and it guards a
 * different thing from `update-verify.ts`.
 *
 * `update-verify.ts` proves the DOWNLOAD is ours (Ed25519 over its SHA-512).
 * This proves the RUNNING APP is ours. They are not the same check and neither
 * covers the other: on Windows `verifyUpdateCodeSignature` compares a
 * downloaded package's publisher against the running app's, and an unsigned
 * running app gives it nothing to compare with. So an app that cannot prove its
 * own signature does not fetch updates at all.
 */
const ALLOW_UNSIGNED_FLAG = "MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED";

/**
 * `unknown` is a distinct answer from `unsigned` on purpose, and BOTH refuse.
 * They are reported separately only so the log tells an operator whether the
 * build is definitely wrong or merely unprovable — the decision is identical,
 * because "I could not tell" must never read as "it is fine".
 */
export type SignatureVerdict = "signed" | "unsigned" | "unknown";

export interface SignatureReport {
  readonly verdict: SignatureVerdict;
  /** One line, safe to print to a log a support agent will read down the phone. */
  readonly detail: string;
}

export interface CommandResult {
  /** True when the executable is not installed (spawn ENOENT). */
  readonly missing: boolean;
  readonly status: number | null;
  readonly output: string;
}

/**
 * Everything `inspectAppSignature` touches outside itself, injected so the
 * gate is testable without a packaged app, a certificate or a real `codesign`.
 * The defect this guards against is a decision, not a syscall, and a decision
 * that cannot be unit-tested is a decision nobody will notice regressing.
 */
export interface SignatureEnvironment {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  /** `/Applications/Mezan.app/Contents/MacOS/Mezan` on a packaged macOS build. */
  readonly execPath: string;
  readonly fileExists: (target: string) => boolean;
  readonly runCodesign: (args: readonly string[]) => CommandResult;
}

export function realSignatureEnvironment(): SignatureEnvironment {
  return {
    isPackaged: app.isPackaged,
    platform: process.platform,
    execPath: process.execPath,
    fileExists: (target) => fs.existsSync(target),
    runCodesign: (args) => {
      const result = spawnSync("codesign", [...args], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return {
        missing: result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ENOENT",
        status: result.status,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      };
    },
  };
}

/**
 * Is the application we are running inside signed?
 *
 * NOTE FOR ANYONE EXTENDING THIS: Electron exposes no code-signature API.
 * There is no `app.getCodeSignature()` in Electron 39 — the only signature
 * information in `electron.d.ts` belongs to `PushSubscription`. So macOS is
 * answered by shelling out to the OS's own `codesign`, and Windows and Linux
 * are answered honestly with `unknown`. Do not replace this with a check that
 * "looks like" an API call; a signature check that returns a made-up yes is
 * worse than none, because it converts a refusal into a green light.
 *
 * This spawns a process, so it is called only on the opt-in path, at most once
 * per launch, after the enable flag has already been read.
 */
export function inspectAppSignature(env: SignatureEnvironment): SignatureReport {
  if (!env.isPackaged) {
    return {
      verdict: "unsigned",
      detail: "running unpackaged (a dev build is never signed)",
    };
  }

  if (env.platform !== "darwin") {
    // Windows: Authenticode COULD be read via PowerShell's
    // Get-AuthenticodeSignature, but that is a ~1s spawn of a whole shell on
    // every launch and, more to the point, the signed Windows release path is
    // not yet exercised. Linux: AppImage and .deb carry no per-application
    // signature at all, which is why electron-builder.yml keeps Linux off the
    // signed release path entirely. Both answer `unknown`, and `unknown`
    // refuses. When a signed Windows release exists, replace this branch with
    // a real check — not with an assumption.
    return {
      verdict: "unknown",
      detail: `no signature check exists for platform "${env.platform}"`,
    };
  }

  // /Applications/Mezan.app/Contents/MacOS/Mezan → /Applications/Mezan.app
  const bundle = path.resolve(env.execPath, "..", "..", "..");
  if (!bundle.endsWith(".app")) {
    return {
      verdict: "unknown",
      detail: `could not locate the .app bundle from ${env.execPath}`,
    };
  }

  // Cheap first: a signed bundle always has this. Its absence is a definite no
  // and saves the spawn entirely.
  if (!env.fileExists(path.join(bundle, "Contents", "_CodeSignature", "CodeResources"))) {
    return { verdict: "unsigned", detail: `${bundle} carries no code signature` };
  }

  const verify = env.runCodesign(["--verify", "--strict", bundle]);
  if (verify.missing) {
    return { verdict: "unknown", detail: "`codesign` is not available on this machine" };
  }
  if (verify.status !== 0) {
    return {
      verdict: "unsigned",
      detail: `codesign --verify --strict rejected ${bundle}: ${firstLine(verify.output)}`,
    };
  }

  // `codesign --verify` PASSES on an ad-hoc signature, which carries no
  // publisher whatsoever — the exact state in which electron-updater has
  // nothing to verify a download against. So the identity is read separately
  // and an ad-hoc or non-Developer-ID signature is treated as unsigned, which
  // is what it is for our purposes.
  const display = env.runCodesign(["--display", "--verbose=4", bundle]);
  if (display.missing) {
    return { verdict: "unknown", detail: "`codesign` is not available on this machine" };
  }
  if (display.status !== 0) {
    return {
      verdict: "unknown",
      detail: `codesign --display failed for ${bundle}: ${firstLine(display.output)}`,
    };
  }
  if (/^Signature=adhoc$/m.test(display.output)) {
    return { verdict: "unsigned", detail: `${bundle} is signed ad-hoc, which names no publisher` };
  }
  const authority = /^Authority=(Developer ID Application:.*)$/m.exec(display.output)?.[1];
  if (!authority) {
    return {
      verdict: "unsigned",
      detail: `${bundle} is not signed by a Developer ID Application certificate`,
    };
  }

  return { verdict: "signed", detail: authority.trim() };
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

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
  /**
   * Injectable so the signature gate is testable without a packaged app, a
   * certificate or a real `codesign`. Omitted in production, where it is
   * computed lazily on the opt-in path only — see the call site.
   */
  signature?: SignatureReport,
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

  // Computed HERE, not as a default argument: a default argument is evaluated
  // on every call, which would spawn `codesign` on a dev launch that returns at
  // the very first line of this function.
  const report = signature ?? inspectAppSignature(realSignatureEnvironment());
  if (report.verdict !== "signed") {
    if (env[ALLOW_UNSIGNED_FLAG] !== "1") {
      console.error(
        `[updater] REFUSED: this build's signature is ${report.verdict} (${report.detail}). ` +
          "An unsigned app has no publisher, so a downloaded update cannot be verified as ours — " +
          "and this product binds a LAN socket, where anyone on the shop wifi can answer for the " +
          `update feed. Install updates from the signed installer instead. ${ALLOW_UNSIGNED_FLAG}=1 ` +
          "overrides this on a test machine only.",
      );
      return;
    }
    console.warn(
      `[updater] ${ALLOW_UNSIGNED_FLAG}=1 — proceeding on a build whose signature is ` +
        `${report.verdict} (${report.detail}). Never set this on a customer install.`,
    );
  } else {
    console.log(`[updater] signature ok: ${report.detail}`);
  }

  autoUpdater.checkForUpdates().catch((err: unknown) => {
    // Never fatal — an offline install with no feed configured is the common
    // case, not an error state.
    console.warn("[updater] launch check failed (expected if offline / no feed)", err);
  });
}
