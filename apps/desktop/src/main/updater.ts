import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import { handleGuarded } from "./ipc-guard.js";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { isDev } from "./env.js";
import {
  MEZAN_UPDATE_EVENT_CHANNEL,
  MEZAN_UPDATE_INVOKE_CHANNEL,
  type UpdateAction,
  type UpdateStatus,
} from "../shared/ipc-contract.js";
import {
  canonicalUpdateMessage,
  isNewerVersion,
  legacySignatureFileName,
  selectArtifactSha512,
  sha512OfFile,
  signatureFileName,
  verifyUpdateSignature,
} from "./update-verify.js";

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
 * Three independent safeguards close that, and ALL must hold:
 *   1. App-level Ed25519 verification (main/update-verify.ts). Nothing is ever
 *      downloaded or installed unless a detached signature over
 *      `version || channel || arch || sha512` verifies against the vendor key
 *      BAKED INTO THE BUILD. This does not depend on OS code-signing and
 *      refuses an unsigned/placeholder feed outright (no key → no download).
 *   2. The bytes are re-hashed and re-verified AFTER the download, before the
 *      installer is handed to the OS.
 *   3. User consent. autoDownload is always false, and installing asks — naming
 *      the tills that are about to lose their host. Nothing swaps the running
 *      app underneath a till mid-sale.
 *
 * The launch-time check stays OFF unless the operator opts in
 * (`MEZAN_AUTO_UPDATE=1`) and, even then, waits for closing time so a download
 * never competes with the counter. User-initiated actions over IPC are always
 * available (each still gated by the three above).
 *
 * CONFIG IS BAKED, NOT READ FROM THE ENVIRONMENT.
 *
 * `__MEZAN_UPDATE_PUBLIC_KEY__` is an esbuild `define` (scripts/build.mjs), so on a
 * packaged build it is a string literal in the bundle. A packaged app IGNORES
 * the environment for it: a trust anchor an attacker can set in the launching
 * environment is not a trust anchor. Unpackaged runs may still override it,
 * because there is nothing baked in to override.
 */

/**
 * The vendor Ed25519 public key, substituted at build time. Absent (a `tsx` or
 * vitest run) `typeof` answers "undefined" rather than throwing, and an empty
 * key refuses every update — fail closed.
 */
declare const __MEZAN_UPDATE_PUBLIC_KEY__: string;
const VENDOR_UPDATE_PUBLIC_KEY_HEX: string =
  typeof __MEZAN_UPDATE_PUBLIC_KEY__ === "string" ? __MEZAN_UPDATE_PUBLIC_KEY__ : "";

/**
 * COMPILED OUT, not read from the environment.
 *
 * This used to be `MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED=1`, which meant a packaged
 * customer install could be told to skip its own signature gate by whoever
 * launched it. It is now a build-time define that is `false` in every build the
 * release workflow produces, so the escape hatch does not exist in the field at
 * all — only in a build somebody deliberately made for a test machine.
 */
declare const __MEZAN_ALLOW_UNSIGNED_UPDATES__: boolean;
const ALLOW_UNSIGNED_BUILD: boolean =
  typeof __MEZAN_ALLOW_UNSIGNED_UPDATES__ === "boolean" ? __MEZAN_ALLOW_UNSIGNED_UPDATES__ : false;

/** Opts the launch-time check in at all. Absent or not "1" means it never runs on launch. */
const ENABLE_FLAG = "MEZAN_AUTO_UPDATE";

/** Shop hours, local time — the launch check waits until the shop is closed. */
const BUSINESS_HOURS_START = 8;
const BUSINESS_HOURS_END = 23;

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

/** What the download proved, kept so `install` can prove it again on the bytes. */
interface VerifiedRelease {
  readonly version: string;
  readonly channel: string;
  readonly arch: string;
  readonly sha512: string;
  readonly signatureB64: string;
  readonly publicKeyHex: string;
}

let latestInfo: UpdateInfo | null = null;
let verified: VerifiedRelease | null = null;
let downloadedFile: string | null = null;

function send(win: BrowserWindow, status: UpdateStatus): void {
  if (!win.isDestroyed()) win.webContents.send(MEZAN_UPDATE_EVENT_CHANNEL, status);
}

/**
 * A packaged build reads its feed from `app-update.yml`, which electron-builder
 * baked at release time, and NOT from the environment — the same reasoning as
 * the public key above.
 */
function feedBaseUrl(env: Record<string, string | undefined>): string | null {
  if (!app.isPackaged) {
    const fromEnv = env["MEZAN_UPDATE_FEED_URL"];
    if (fromEnv) return fromEnv.replace(/\/+$/, "");
  }
  try {
    const configured = autoUpdater.getFeedURL();
    return configured ? configured.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

function publicKeyHex(env: Record<string, string | undefined>): string {
  if (app.isPackaged) return VENDOR_UPDATE_PUBLIC_KEY_HEX;
  return env["MEZAN_UPDATE_PUBLIC_KEY"] || VENDOR_UPDATE_PUBLIC_KEY_HEX;
}

/**
 * Is this install on the update channel at all?
 *
 * A build with no vendor key or no feed is not broken and must not be reported
 * as an error: it is an install that is updated by running a new installer, and
 * the renderer says exactly that. Nine tenths of the field is this today.
 */
function updatesConfigured(env: Record<string, string | undefined>): boolean {
  return publicKeyHex(env) !== "" && feedBaseUrl(env) !== null;
}

function currentChannel(): string {
  try {
    return autoUpdater.channel ?? "latest";
  } catch {
    return "latest";
  }
}

async function fetchSignature(base: string, version: string, arch: string): Promise<string | null> {
  const names = [
    signatureFileName(version, process.platform, arch),
    // A single-platform feed may publish the shorter name; the signature covers
    // the whole tuple either way, so a wrong file simply fails to verify.
    legacySignatureFileName(version, arch),
  ];
  for (const name of names) {
    try {
      const res = await fetch(`${base}/${name}`);
      if (!res.ok) continue;
      const body = (await res.text()).trim();
      if (body) return body;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Fetches the detached signature and verifies it over the canonical release
 * tuple. Returns the reason on failure, or the verified release on success.
 */
async function verifyRelease(
  info: UpdateInfo,
  env: Record<string, string | undefined>,
): Promise<VerifiedRelease | string> {
  const key = publicKeyHex(env);
  if (!key) return "NO_PUBLIC_KEY";

  const base = feedBaseUrl(env);
  if (!base) return "NO_FEED_URL";

  const version = info.version;
  if (!version) return "NO_VERSION";
  // A signature binds a version, and this is where that binding is USED: the
  // release being applied has to be newer than the one running, or a genuinely
  // signed old installer republished under a new name is a downgrade attack.
  if (!isNewerVersion(version, app.getVersion())) return "NOT_NEWER";

  const arch = process.arch;
  const sha512 = selectArtifactSha512(info, { arch, platform: process.platform });
  if (!sha512) return "NO_ARTIFACT_HASH";

  const channel = currentChannel();
  const signatureB64 = await fetchSignature(base, version, arch);
  if (!signatureB64) return "SIGNATURE_UNAVAILABLE";

  const message = canonicalUpdateMessage({ version, channel, arch, sha512 });
  const ok = await verifyUpdateSignature({ publicKeyHex: key, message, signatureB64 });
  if (!ok) return "SIGNATURE_INVALID";

  return { version, channel, arch, sha512, signatureB64, publicKeyHex: key };
}

/**
 * Re-proves the DOWNLOADED bytes before the OS is handed an installer.
 *
 * electron-updater checks the download against `info.sha512` itself, which is a
 * value from the same feed metadata an attacker would be rewriting. This hashes
 * the file on disk and re-runs the vendor signature over the tuple that hash
 * belongs to, so the last thing that happens before `quitAndInstall` is a proof
 * rather than a memory of one.
 */
async function reverifyDownload(release: VerifiedRelease, filePath: string): Promise<boolean> {
  try {
    const actual = await sha512OfFile(filePath);
    if (actual !== release.sha512) return false;
  } catch {
    return false;
  }
  return verifyUpdateSignature({
    publicKeyHex: release.publicKeyHex,
    message: canonicalUpdateMessage(release),
    signatureB64: release.signatureB64,
  });
}

export type InstallChoice = "now" | "on-quit" | "cancel";

export interface InstallPrompt {
  readonly version: string;
  /** Labels of the tills currently connected to this host. */
  readonly devices: readonly string[];
  readonly inBusinessHours: boolean;
}

export type ConfirmInstall = (prompt: InstallPrompt) => Promise<{
  readonly choice: InstallChoice;
  /** The operator ticked "install now even though the shop is open". */
  readonly overrideBusinessHours: boolean;
}>;

/**
 * THE CONFIRMATION AN INSTALL DID NOT HAVE.
 *
 * `install` used to be `quitAndInstall()` on a button press, at any hour, with
 * no mention of the tills that lose their host the instant this process exits —
 * every one of them showing «تعذّر الوصول إلى الجهاز الرئيسي» to a customer at
 * the counter. So the dialog NAMES them, defaults to installing when the app is
 * next closed, and will not install during shop hours unless the operator ticks
 * a box saying they mean it.
 */
function electronConfirmInstall(win: BrowserWindow): ConfirmInstall {
  return async (prompt) => {
    const deviceLines =
      prompt.devices.length === 0
        ? "لا توجد أجهزة متصلة الآن."
        : `الأجهزة المتصلة الآن وستفقد الاتصال بالجهاز الرئيسي:\n• ${prompt.devices.join("\n• ")}`;
    const result = await dialog.showMessageBox(win, {
      type: "question",
      title: "تثبيت التحديث",
      message: `تثبيت الإصدار ${prompt.version}؟`,
      detail:
        `${deviceLines}\n\n` +
        (prompt.inBusinessHours
          ? "الوقت الآن داخل ساعات العمل. التثبيت الفوري يغلق البرنامج ويقطع كل الأجهزة المتصلة."
          : "التثبيت يغلق البرنامج ثم يعيد تشغيله بالإصدار الجديد."),
      buttons: ["التثبيت بعد إغلاق البرنامج", "التثبيت الآن", "إلغاء"],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: "أفهم أن الأجهزة المتصلة ستتوقف، وأريد التثبيت الآن",
      checkboxChecked: false,
      noLink: true,
    });
    const choice: InstallChoice =
      result.response === 0 ? "on-quit" : result.response === 1 ? "now" : "cancel";
    return { choice, overrideBusinessHours: result.checkboxChecked === true };
  };
}

export type InstallDecision = "install-now" | "install-on-quit" | "cancelled" | "refused-in-hours";

/**
 * The whole of the install gate, as a decision over three booleans — because a
 * gate that only exists inside an IPC handler around a `dialog` call is a gate
 * nobody can test, and this one decides whether five tills go dark at 1pm.
 */
export function resolveInstallDecision(input: {
  readonly choice: InstallChoice;
  readonly overrideBusinessHours: boolean;
  readonly inBusinessHours: boolean;
}): InstallDecision {
  if (input.choice === "cancel") return "cancelled";
  if (input.choice === "on-quit") return "install-on-quit";
  if (input.inBusinessHours && !input.overrideBusinessHours) return "refused-in-hours";
  return "install-now";
}

export interface UpdaterDeps {
  /**
   * Labels of the tills holding a seat on this host, read from the live seat
   * registry at the moment the operator presses install — never a cached count.
   */
  readonly connectedDevices?: () => readonly string[];
  /** Injected in tests; production uses the Electron dialog. */
  readonly confirmInstall?: ConfirmInstall;
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
  deps: UpdaterDeps = {},
): void {
  if (isDev()) return;

  const confirmInstall = deps.confirmInstall ?? electronConfirmInstall(win);
  const connectedDevices = deps.connectedDevices ?? (() => []);

  // Never silent, never auto-installed — consent + verification gate every step.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("error", (err) => {
    send(win, { phase: "error", reason: err instanceof Error ? err.message : "UPDATE_ERROR" });
  });
  autoUpdater.on("update-available", (info) => {
    latestInfo = info;
    verified = null;
    downloadedFile = null;
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
  autoUpdater.on("update-downloaded", (event) => {
    downloadedFile = (event as { downloadedFile?: string }).downloadedFile ?? null;
    send(win, { phase: "ready", version: event.version });
  });

  handleGuarded(
    MEZAN_UPDATE_INVOKE_CHANNEL,
    async (_event, action: UpdateAction): Promise<UpdateStatus> => {
      switch (action) {
        case "check": {
          // Not an error, and not a dead button: an install with no vendor key
          // or no feed is updated by running a new installer, and says so.
          if (!updatesConfigured(env)) return { phase: "unavailable" };
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
          if (!updatesConfigured(env)) return { phase: "unavailable" };
          if (!latestInfo) return { phase: "error", reason: "NO_UPDATE" };
          // Verify authenticity BEFORE downloading — a release that cannot be
          // proven to come from the vendor key is never fetched or applied.
          send(win, { phase: "verifying", version: latestInfo.version });
          const outcome = await verifyRelease(latestInfo, env);
          if (typeof outcome === "string") {
            verified = null;
            return { phase: "rejected", version: latestInfo.version, reason: outcome };
          }
          verified = outcome;
          downloadedFile = null;
          try {
            await autoUpdater.downloadUpdate();
            return { phase: "downloading", version: latestInfo.version };
          } catch (err) {
            return { phase: "error", reason: err instanceof Error ? err.message : "DOWNLOAD_FAILED" };
          }
        }
        case "install": {
          // Never install something we did not verify and download.
          if (!verified) return { phase: "rejected", reason: "NOT_VERIFIED" };
          if (downloadedFile && !(await reverifyDownload(verified, downloadedFile))) {
            verified = null;
            return { phase: "rejected", version: latestInfo?.version, reason: "DOWNLOAD_TAMPERED" };
          }

          const inBusinessHours = isBusinessHours(new Date());
          const answer = await confirmInstall({
            version: verified.version,
            devices: connectedDevices(),
            inBusinessHours,
          });
          switch (resolveInstallDecision({ ...answer, inBusinessHours })) {
            case "cancelled":
              return { phase: "ready", version: verified.version };
            case "refused-in-hours":
              return { phase: "rejected", version: verified.version, reason: "IN_BUSINESS_HOURS" };
            case "install-on-quit":
              // Consented, and only now: the flag stays false until a person has
              // chosen it for this one release.
              autoUpdater.autoInstallOnAppQuit = true;
              return { phase: "scheduled", version: verified.version };
            default:
              autoUpdater.quitAndInstall();
              return { phase: "ready", version: verified.version };
          }
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
    if (!ALLOW_UNSIGNED_BUILD) {
      console.error(
        `[updater] REFUSED: this build's signature is ${report.verdict} (${report.detail}). ` +
          "An unsigned app has no publisher, so a downloaded update cannot be verified as ours — " +
          "and this product binds a LAN socket, where anyone on the shop wifi can answer for the " +
          "update feed. Install updates from the signed installer instead.",
      );
      return;
    }
    console.warn(
      "[updater] this build was compiled with MEZAN_ALLOW_UNSIGNED_UPDATES — proceeding on a build " +
        `whose signature is ${report.verdict} (${report.detail}). Never ship such a build.`,
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
