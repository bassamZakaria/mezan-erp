import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { isDev } from "./env.js";

/**
 * electron-updater scaffolding — OFF BY DEFAULT, and it stays off until
 * somebody turns it on deliberately AND the running build can prove it is ours.
 *
 * WHAT THIS USED TO DO, AND WHY THAT WAS THE WRONG DEFAULT. Every packaged
 * launch called `checkForUpdates()` against the placeholder feed in
 * electron-builder.yml with `autoInstallOnAppQuit = true` set beforehand. That
 * is a shipped remote-code-execution path waiting on one DNS record: nothing in
 * that build was code-signed, so electron-updater had no publisher identity to
 * verify a downloaded package against — whatever answered
 * `updates.mezan.example` would have been installed on the next quit, into the
 * process that holds the shop's books, on every install in the field at once,
 * with no operator action. This product also binds a LAN socket
 * (`lan-host.ts`), so "whoever answers the feed" includes anyone already
 * sitting on the shop wifi.
 *
 * WHAT CHANGED. electron-builder.yml now carries a complete signing and
 * notarization configuration driven entirely from CI secrets, with
 * `forceCodeSigning: true` so a macOS or Windows package that could not be
 * signed FAILS rather than shipping, and `.github/workflows/release.yml` runs
 * `scripts/check-signed.mjs` against the finished artifacts as a hard release
 * gate. None of that helps an install that is already in the field on an old
 * unsigned build — so this module now asks, at runtime, whether the binary it
 * is running inside is itself signed, and refuses to update if it cannot get a
 * yes. THE PRINCIPLE: the updater may only run on a build that could verify
 * what it downloads. An unsigned app has no publisher, so electron-updater's
 * own signature check (`win.verifyUpdateCodeSignature`, macOS's Gatekeeper)
 * has nothing to compare against and silently passes everything.
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
 * The override for the signature gate below, and the only way past it.
 *
 * It is spelled out in full — the word "UNSIGNED" is in the variable name — so
 * that nobody can set it while believing they are turning on something safe,
 * and so that it is greppable in any deployment script that carries it. It
 * exists for one reason: somebody has to be able to test the update plumbing on
 * a Linux or Windows build where this module cannot establish a signature at
 * all. It must never appear on a customer install.
 */
const ALLOW_UNSIGNED_FLAG = "MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED";

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

export function initAutoUpdater(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
  signature?: SignatureReport,
): void {
  if (isDev()) return;

  if (env[ENABLE_FLAG] !== "1") {
    console.log(
      `[updater] disabled. Set ${ENABLE_FLAG}=1 to check for updates. ` +
        "Even then, this build must be able to prove it is signed before anything is downloaded.",
    );
    return;
  }

  // THE SIGNATURE GATE, and it comes before everything else that could run.
  //
  // An unsigned app cannot verify an update, so it must not fetch one: on
  // Windows `verifyUpdateCodeSignature` compares the downloaded package's
  // publisher against the RUNNING app's, and an unsigned running app gives it
  // nothing to compare with. The refusal is the whole point — the override
  // below has "UNSIGNED" in its name so that turning it on is a sentence
  // somebody has to read.
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

  if (isBusinessHours(now)) {
    console.log(
      `[updater] skipped: shop hours (${BUSINESS_HOURS_START}:00–${BUSINESS_HOURS_END}:00 local). ` +
        "Updates are checked outside opening hours so nothing competes with the counter.",
    );
    return;
  }

  // Both false unless BOTH the install flag is set AND the gate above was
  // satisfied. `autoDownload` would fetch the package; `autoInstallOnAppQuit`
  // would swap the installed app for it on the next quit.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  if (env[ALLOW_INSTALL_FLAG] === "1") {
    if (report.verdict === "signed") {
      console.log(
        `[updater] ${ALLOW_INSTALL_FLAG}=1 on a signed build — updates will download and install ` +
          "on the next quit, after electron-updater verifies the package against this app's publisher.",
      );
    } else {
      console.warn(
        `[updater] ${ALLOW_INSTALL_FLAG}=1 — downloading and installing UNVERIFIABLE updates onto a ` +
          `build whose signature is ${report.verdict}. Only ever correct on a test machine.`,
      );
    }
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
