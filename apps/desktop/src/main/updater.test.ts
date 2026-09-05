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
};

const electronState = { isPackaged: true };
let checkForUpdatesResult: Promise<unknown> = Promise.resolve(null);

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
  // The updater registers one IPC handler for the user-initiated actions
  // (download / install / check) before it ever reaches the launch-check gates
  // these tests exercise, so the mock has to carry it or the module throws on
  // import rather than failing an assertion.
  ipcMain: { handle: () => {}, removeHandler: () => {} },
}));

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
import { registerAutoUpdater, inspectAppSignature, realSignatureEnvironment } from "./updater.js";
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
  checkForUpdatesResult = Promise.resolve(null);
  electronState.isPackaged = true;
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
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1", MEZAN_AUTO_UPDATE_INSTALL: "1" }, CLOSED, SIGNED);
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

  it("refuses an unsigned build even when the INSTALL flag is also set", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1", MEZAN_AUTO_UPDATE_INSTALL: "1" },
      CLOSED,
      UNSIGNED,
    );
    expect(updaterState.checkCalls).toBe(0);
    // The install flag must not be able to buy its way past the signature gate:
    // that ordering is the entire fix.
    expect(updaterState.autoDownload).toBe(false);
    expect(updaterState.autoInstallOnAppQuit).toBe(false);
  });

  it("proceeds on an unsigned build ONLY with the explicit ALLOW_UNSIGNED override", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1", MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED: "1" },
      CLOSED,
      UNSIGNED,
    );
    expect(updaterState.checkCalls).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Never set this on a customer install"));
  });

  it("does not treat any value but \"1\" as the override", () => {
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1", MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED: "true" },
      CLOSED,
      UNSIGNED,
    );
    expect(updaterState.checkCalls).toBe(0);
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
    registerAutoUpdater(WIN, { MEZAN_AUTO_UPDATE: "1", MEZAN_AUTO_UPDATE_INSTALL: "1" }, CLOSED, SIGNED);
    expect(updaterState.autoDownload).toBe(false);
    expect(updaterState.autoInstallOnAppQuit).toBe(false);
    expect(updaterState.checkCalls).toBe(1);
  });

  it("keeps consent even when the signature override is stacked on the install flag", () => {
    // The loudest configuration this product can be put into: the signature gate
    // overridden AND installing requested. It is reachable — a test machine needs
    // it — so what it must never do is install anything on its own, and what it
    // must never be is quiet about running unsigned.
    registerAutoUpdater(
      WIN,
      {
        MEZAN_AUTO_UPDATE: "1",
        MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED: "1",
        MEZAN_AUTO_UPDATE_INSTALL: "1",
      },
      CLOSED,
      UNSIGNED,
    );
    expect(updaterState.autoInstallOnAppQuit).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED=1"),
    );
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
