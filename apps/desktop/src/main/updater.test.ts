import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The updater's gates are the difference between "we ship updates" and "anyone
 * on the shop wifi ships updates". They are pure decisions about an env bag, a
 * clock and a signature verdict, so they are asserted rather than reasoned
 * about — a gate has no natural regression signal, because an app that updates
 * from a stranger looks exactly like an app that updates from us.
 *
 * `electron` and `electron-updater` are mocked at the module boundary (the same
 * shape window.test.ts uses); the recorded flags on the fake autoUpdater are
 * what the assertions read.
 */

const updaterState = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
  checkCalls: 0,
  quitAndInstallCalls: 0,
  feedUrl: "" as string | null,
};

const electronState = { isPackaged: true, version: "1.0.0" };
let checkForUpdatesResult: Promise<unknown> = Promise.resolve(null);
/** The handler the updater registers, captured so the IPC actions can be driven. */
let invokeHandler: ((event: unknown, action: string) => Promise<unknown>) | null = null;

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
    getVersion: () => electronState.version,
  },
  dialog: { showMessageBox: () => Promise.resolve({ response: 2, checkboxChecked: false }) },
  // The updater registers one IPC handler for the user-initiated actions
  // (download / install / check) before it ever reaches the launch-check gates
  // these tests exercise, so the mock has to carry it or the module throws on
  // import rather than failing an assertion.
  ipcMain: {
    handle: (_channel: string, handler: (event: unknown, action: string) => Promise<unknown>) => {
      invokeHandler = handler;
    },
    removeHandler: () => {},
  },
}));

/**
 * A stand-in for the Electron invoke event, carrying the renderer frame the
 * `guarded` wrapper (main/ipc-guard.ts, audit S-5) checks. `null` used to do —
 * it no longer does, because a channel that answers a frame it cannot identify
 * is the finding.
 */
const RENDERER_EVENT = { senderFrame: { url: "app://mezan/index.html" } } as never;

vi.mock("electron-updater", () => ({
  autoUpdater: {
    get autoDownload() {
      return updaterState.autoDownload;
    },
    set autoDownload(value: boolean) {
      updaterState.autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return updaterState.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value: boolean) {
      updaterState.autoInstallOnAppQuit = value;
    },
    channel: "latest",
    getFeedURL: () => updaterState.feedUrl,
    downloadUpdate: () => Promise.resolve([]),
    quitAndInstall: () => {
      updaterState.quitAndInstallCalls += 1;
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      const list = updaterState.listeners.get(event) ?? [];
      list.push(listener);
      updaterState.listeners.set(event, list);
    },
    checkForUpdates() {
      updaterState.checkCalls += 1;
      return checkForUpdatesResult;
    },
  },
}));

// A static import is correct here despite the mocks above: vitest hoists
// `vi.mock` calls above the import block, so `electron` and `electron-updater`
// are already replaced by the time this module is evaluated.
import {
  registerAutoUpdater,
  inspectAppSignature,
  realSignatureEnvironment,
  resolveInstallDecision,
} from "./updater.js";
import type { BrowserWindow } from "electron";

/**
 * The updater posts status to a window; the launch-check paths asserted below
 * all return before that happens, so a stub is enough and keeps these tests
 * free of a real BrowserWindow.
 */
/** Every status the updater pushes to the renderer, in order. */
const sentToRenderer: unknown[] = [];
const WIN = {
  isDestroyed: () => false,
  webContents: {
    send: (_channel: string, status: unknown) => {
      sentToRenderer.push(status);
    },
  },
} as unknown as BrowserWindow;
import type { SignatureEnvironment, SignatureReport } from "./updater.js";

const SIGNED: SignatureReport = {
  verdict: "signed",
  detail: "Developer ID Application: PLACEHOLDER (TEAMID)",
};
const UNSIGNED: SignatureReport = { verdict: "unsigned", detail: "no code signature" };
const UNKNOWN: SignatureReport = { verdict: "unknown", detail: "no check for this platform" };

/** 03:00 — outside the 08:00–23:00 shop hours the updater refuses to run in. */
const CLOSED = new Date(2026, 0, 15, 3, 0, 0);
/** 12:00 — the Friday lunch rush the business-hours gate exists for. */
const OPEN = new Date(2026, 0, 15, 12, 0, 0);

beforeEach(() => {
  updaterState.autoDownload = false;
  updaterState.autoInstallOnAppQuit = false;
  updaterState.listeners.clear();
  updaterState.checkCalls = 0;
  updaterState.quitAndInstallCalls = 0;
  updaterState.feedUrl = "";
  invokeHandler = null;
  checkForUpdatesResult = Promise.resolve(null);
  electronState.isPackaged = true;
  electronState.version = "1.0.0";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function macEnvironment(overrides: Partial<SignatureEnvironment> = {}): SignatureEnvironment {
  return {
    isPackaged: true,
    platform: "darwin",
    execPath: "/Applications/Mezan.app/Contents/MacOS/Mezan",
    fileExists: () => true,
    runCodesign: (args) =>
      args[0] === "--verify"
        ? { missing: false, status: 0, output: "" }
        : {
            missing: false,
            status: 0,
            output: "Signature=Developer ID\nAuthority=Developer ID Application: Placeholder (TEAMID)\n",
          },
    ...overrides,
  };
}

describe("registerAutoUpdater — the enable gate", () => {
  it("does nothing at all in a dev build", () => {
    electronState.isPackaged = false;
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, CLOSED, SIGNED);
    expect(updaterState.checkCalls).toBe(0);
    expect(updaterState.autoInstallOnAppQuit).toBe(false);
  });

  it("stays off when the enable flag is absent, even on a signed build", () => {
    registerAutoUpdater(WIN, {}, CLOSED, SIGNED);
    expect(updaterState.checkCalls).toBe(0);
  });

  it("stays off for any value of the enable flag other than exactly \"1\"", () => {
    for (const value of ["0", "true", "yes", "", "1 "]) {
      registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: value }, CLOSED, SIGNED);
    }
    expect(updaterState.checkCalls).toBe(0);
  });
});

describe("registerAutoUpdater — the signature gate", () => {
  it("refuses to check for updates on an unsigned build, even with the enable flag set", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, CLOSED, UNSIGNED);
    expect(updaterState.checkCalls).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("REFUSED"));
  });

  it("refuses when the signature is merely UNKNOWN — 'I could not tell' is not 'it is fine'", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, CLOSED, UNKNOWN);
    expect(updaterState.checkCalls).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("REFUSED"));
  });

  /**
   * GUARDS U-12, and it is the inversion of the assertion that used to live
   * here. `MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED=1` in the ENVIRONMENT used to switch
   * the signature gate off on a packaged customer install — i.e. whoever
   * launched the app decided whether it checked its own signature. The override
   * is now a build-time define, false in everything the release workflow
   * produces, so the environment cannot reach it at all.
   */
  it("ignores MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED — the override is compiled out, not read", () => {
    registerAutoUpdater(
      WIN,
      { MEZAN_AUTO_UPDATE: "1", MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED: "1" },
      CLOSED,
      UNSIGNED,
    );
    expect(updaterState.checkCalls).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("REFUSED"));
  });

  it("checks for updates on a signed build", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, CLOSED, SIGNED);
    expect(updaterState.checkCalls).toBe(1);
  });
});

describe("registerAutoUpdater — shop hours and the install gate", () => {
  it("does not touch the network during shop hours", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, OPEN, SIGNED);
    expect(updaterState.checkCalls).toBe(0);
  });

  it("checks but does not download without the install flag", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, CLOSED, SIGNED);
    expect(updaterState.checkCalls).toBe(1);
    expect(updaterState.autoDownload).toBe(false);
    expect(updaterState.autoInstallOnAppQuit).toBe(false);
  });

  /**
   * REWRITTEN, and the change is the point. These two used to assert that
   * `MEZAN_AUTO_UPDATE_INSTALL=1` set `autoDownload` and `autoInstallOnAppQuit`
   * to true — i.e. that a correctly configured install would swap the running
   * app underneath whoever was using it, on quit, with no one agreeing to it.
   *
   * The signed-update channel removed that on purpose: consent is now a second,
   * independent safeguard beside the Ed25519 artifact signature, so BOTH flags
   * stay false no matter what the environment says, and the renderer asks. The
   * old assertions are inverted rather than deleted, because "nothing installs
   * itself" is exactly the guarantee a regression here would quietly take away.
   */
  it("never auto-downloads or auto-installs, whatever the environment asks for", () => {
    // GUARDS U-13: `MEZAN_AUTO_UPDATE_INSTALL` was documented and asserted here
    // and read by nothing. Consent is a dialog now, not an environment variable.
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1", MEZAN_AUTO_UPDATE_INSTALL: "1" }, CLOSED, SIGNED);
    expect(updaterState.autoDownload).toBe(false);
    expect(updaterState.autoInstallOnAppQuit).toBe(false);
    expect(updaterState.checkCalls).toBe(1);
  });

  it("registers the error/available/not-available handlers so a failure is never silent", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, CLOSED, SIGNED);
    // `download-progress` and `update-downloaded` joined the set when downloads
    // became a user-driven step with a progress bar behind it.
    expect([...updaterState.listeners.keys()].sort()).toEqual([
      "download-progress",
      "error",
      "update-available",
      "update-downloaded",
      "update-not-available",
    ]);
    // "Never silent" now means it reaches the PERSON, not a console nobody
    // opens: the failure is pushed to the renderer as an `error` status, which
    // is what UpdateBanner renders. Asserting the console instead would pass on
    // a build where the banner never lit up.
    sentToRenderer.length = 0;
    updaterState.listeners.get("error")?.[0]?.(new Error("boom"));
    expect(sentToRenderer).toEqual([{ phase: "error", reason: "boom" }]);
  });
});

describe("inspectAppSignature", () => {
  it("calls an unpackaged build unsigned", () => {
    const report = inspectAppSignature(macEnvironment({ isPackaged: false }));
    expect(report.verdict).toBe("unsigned");
  });

  it("returns UNKNOWN on Windows — Electron exposes no signature API to read", () => {
    const report = inspectAppSignature(
      macEnvironment({ platform: "win32", execPath: "C:/Program Files/Mezan/Mezan.exe" }),
    );
    expect(report.verdict).toBe("unknown");
    expect(report.detail).toContain("win32");
  });

  it("returns UNKNOWN on Linux — AppImage and .deb carry no per-app signature", () => {
    const report = inspectAppSignature(macEnvironment({ platform: "linux" }));
    expect(report.verdict).toBe("unknown");
  });

  it("returns UNKNOWN when the .app bundle cannot be located from execPath", () => {
    const report = inspectAppSignature(macEnvironment({ execPath: "/usr/local/bin/mezan" }));
    expect(report.verdict).toBe("unknown");
    expect(report.detail).toContain("could not locate");
  });

  it("calls a bundle with no _CodeSignature directory unsigned, without spawning codesign", () => {
    const runCodesign = vi.fn();
    const report = inspectAppSignature(
      macEnvironment({ fileExists: () => false, runCodesign }),
    );
    expect(report.verdict).toBe("unsigned");
    expect(runCodesign).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN when codesign itself is missing — never a pass", () => {
    const report = inspectAppSignature(
      macEnvironment({ runCodesign: () => ({ missing: true, status: null, output: "" }) }),
    );
    expect(report.verdict).toBe("unknown");
  });

  it("calls a bundle codesign rejects unsigned", () => {
    const report = inspectAppSignature(
      macEnvironment({
        runCodesign: () => ({ missing: false, status: 1, output: "code object is not signed at all" }),
      }),
    );
    expect(report.verdict).toBe("unsigned");
    expect(report.detail).toContain("not signed at all");
  });

  it("rejects an AD-HOC signature, which passes codesign --verify but names no publisher", () => {
    const report = inspectAppSignature(
      macEnvironment({
        runCodesign: (args) =>
          args[0] === "--verify"
            ? { missing: false, status: 0, output: "" }
            : { missing: false, status: 0, output: "Signature=adhoc\n" },
      }),
    );
    expect(report.verdict).toBe("unsigned");
    expect(report.detail).toContain("ad-hoc");
  });

  it("rejects a development identity — Apple will not notarize one", () => {
    const report = inspectAppSignature(
      macEnvironment({
        runCodesign: (args) =>
          args[0] === "--verify"
            ? { missing: false, status: 0, output: "" }
            : {
                missing: false,
                status: 0,
                output: "Authority=Apple Development: Someone (XXXX)\n",
              },
      }),
    );
    expect(report.verdict).toBe("unsigned");
    expect(report.detail).toContain("Developer ID Application");
  });

  it("returns UNKNOWN when codesign --display fails after --verify succeeded", () => {
    const report = inspectAppSignature(
      macEnvironment({
        runCodesign: (args) =>
          args[0] === "--verify"
            ? { missing: false, status: 0, output: "" }
            : { missing: false, status: 2, output: "unexpected\n" },
      }),
    );
    expect(report.verdict).toBe("unknown");
  });

  it("returns UNKNOWN when codesign disappears between the two calls", () => {
    const report = inspectAppSignature(
      macEnvironment({
        runCodesign: (args) =>
          args[0] === "--verify"
            ? { missing: false, status: 0, output: "" }
            : { missing: true, status: null, output: "" },
      }),
    );
    expect(report.verdict).toBe("unknown");
  });

  it("accepts a Developer ID Application signature and reports the authority", () => {
    const report = inspectAppSignature(macEnvironment());
    expect(report.verdict).toBe("signed");
    expect(report.detail).toBe("Developer ID Application: Placeholder (TEAMID)");
  });
});

describe("realSignatureEnvironment", () => {
  /**
   * The seam the production path actually uses. Asserted loosely on purpose: it
   * spawns the real `codesign`, which exists on a macOS developer machine and
   * does not exist on the Linux CI runner. BOTH answers are correct and both
   * are safe — a machine with no `codesign` yields `missing: true`, which
   * `inspectAppSignature` turns into `unknown`, which refuses. What is asserted
   * is that the seam is wired to something real at all, since a probe that
   * silently returned a hard-coded pass is the one failure mode that would make
   * every test above meaningless.
   */
  it("wires the probe to the real filesystem and the real codesign", () => {
    const environment = realSignatureEnvironment();
    expect(environment.platform).toBe(process.platform);
    expect(environment.execPath).toBe(process.execPath);
    expect(environment.fileExists(process.execPath)).toBe(true);
    expect(environment.fileExists(path.join(process.execPath, "definitely-not-here"))).toBe(false);

    const result = environment.runCodesign(["--verify", "/nonexistent-bundle.app"]);
    if (result.missing) {
      expect(result.status).toBeNull();
    } else {
      // codesign exists and correctly refused a path that is not a bundle.
      expect(result.status).not.toBe(0);
    }
  });
});

describe("the update check never throws into the main process", () => {
  it("swallows a rejected checkForUpdates — an offline shop is the common case, not an error", async () => {
    const failure = new Error("getaddrinfo ENOTFOUND");
    checkForUpdatesResult = Promise.reject(failure);
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1" }, CLOSED, SIGNED);
    await new Promise((resolve) => setImmediate(resolve));
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("check failed"),
      failure,
    );
  });
});

/**
 * GUARDS U-8. `install()` was `quitAndInstall()` on a button press: at 1pm,
 * with five tills connected, with nothing asked and nobody told.
 */
describe("resolveInstallDecision — the gate on quitAndInstall", () => {
  it("defaults to installing when the app closes", () => {
    expect(
      resolveInstallDecision({
        choice: "on-quit",
        overrideBusinessHours: false,
        inBusinessHours: true,
      }),
    ).toBe("install-on-quit");
  });

  it("refuses an immediate install during shop hours without an explicit override", () => {
    expect(
      resolveInstallDecision({ choice: "now", overrideBusinessHours: false, inBusinessHours: true }),
    ).toBe("refused-in-hours");
  });

  it("installs now during shop hours only when the operator ticked the box", () => {
    expect(
      resolveInstallDecision({ choice: "now", overrideBusinessHours: true, inBusinessHours: true }),
    ).toBe("install-now");
  });

  it("installs now outside shop hours with no override needed", () => {
    expect(
      resolveInstallDecision({
        choice: "now",
        overrideBusinessHours: false,
        inBusinessHours: false,
      }),
    ).toBe("install-now");
  });

  it("cancels, and cancelling is not an install", () => {
    expect(
      resolveInstallDecision({
        choice: "cancel",
        overrideBusinessHours: true,
        inBusinessHours: false,
      }),
    ).toBe("cancelled");
  });
});

describe("the IPC actions", () => {
  /**
   * GUARDS U-5 and support ticket #8. A build with no feed and no vendor key —
   * i.e. every install in the field today — answered «تعذّر إكمال التحديث» in a
   * red, undismissable alert on every screen. It is not an error: the machine is
   * updated by running a new installer, and the phase says so.
   */
  it("answers `unavailable`, not `error`, when no feed is configured", async () => {
    updaterState.feedUrl = "";
    registerAutoUpdater(WIN, {}, CLOSED, SIGNED);
    expect(await invokeHandler?.(RENDERER_EVENT, "check")).toEqual({ phase: "unavailable" });
    // And it never touched the network to find that out.
    expect(updaterState.checkCalls).toBe(0);
  });

  it("refuses to install anything that was not verified and downloaded", async () => {
    registerAutoUpdater(WIN, {}, CLOSED, SIGNED);
    expect(await invokeHandler?.(RENDERER_EVENT, "install")).toEqual({
      phase: "rejected",
      reason: "NOT_VERIFIED",
    });
    expect(updaterState.quitAndInstallCalls).toBe(0);
  });

  /**
   * GUARDS U-1. The vendor key is a build-time define and a packaged build
   * reads NOTHING else — not the environment, which is the exact hole L-1 and
   * U-1 name. With no key baked in, a feed that says "there is an update" gets
   * no download at all, and the answer is the calm "this build does not receive
   * updates" rather than a red alert.
   */
  it("downloads nothing when no vendor key is baked in, whatever the environment says", async () => {
    updaterState.feedUrl = "https://updates.example.test/mezan";
    registerAutoUpdater(WIN, { MEZAN_UPDATE_PUBLIC_KEY: "ff".repeat(32) }, CLOSED, SIGNED);
    updaterState.listeners.get("update-available")?.[0]?.({ version: "9.9.9" });
    expect(await invokeHandler?.(RENDERER_EVENT, "download")).toEqual({ phase: "unavailable" });
  });
});
