import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The main window is the only privileged frame in the product: it holds the
 * books, and its preload bridge can reach the whole Hono app. Every flag below
 * is load-bearing, and each one is a single word away from being wrong, so they
 * are asserted rather than eyeballed.
 *
 * The module needs a real Electron runtime, so `electron` is mocked at the
 * boundary and the recorded constructor options and handlers are inspected.
 */

interface Recorded {
  options?: Record<string, unknown>;
  windowOpenHandler?: (details: { url: string }) => { action: string };
  listeners: Map<string, Array<(...args: unknown[]) => void>>;
  loadedUrl?: string;
}

const recorded: Recorded = { listeners: new Map() };
const openExternal = vi.fn();

class FakeBrowserWindow {
  webContents = {
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => {
      recorded.windowOpenHandler = handler;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = recorded.listeners.get(event) ?? [];
      list.push(listener);
      recorded.listeners.set(event, list);
    },
  };

  constructor(options: Record<string, unknown>) {
    recorded.options = options;
  }

  once() {
    return this;
  }

  loadURL(url: string) {
    recorded.loadedUrl = url;
    return Promise.resolve();
  }

  show() {}
}

vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  shell: { openExternal },
  app: { isPackaged: true },
}));

async function build() {
  recorded.listeners = new Map();
  recorded.options = undefined;
  recorded.windowOpenHandler = undefined;
  recorded.loadedUrl = undefined;
  openExternal.mockClear();
  const { createWindow } = await import("./window.js");
  createWindow();
  const prefs = recorded.options!["webPreferences"] as Record<string, unknown>;
  const willNavigate = recorded.listeners.get("will-navigate") ?? [];
  return { prefs, willNavigate };
}

function navigateTo(willNavigate: Array<(...args: unknown[]) => void>, url: string) {
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  for (const listener of willNavigate) listener(event, url);
  return prevented;
}

beforeEach(() => {
  vi.resetModules();
});

describe("main window hardening flags", () => {
  it("isolates the context, disables Node in the renderer and sandboxes it", async () => {
    const { prefs } = await build();
    expect(prefs["contextIsolation"]).toBe(true);
    expect(prefs["nodeIntegration"]).toBe(false);
    expect(prefs["sandbox"]).toBe(true);
  });

  it("never disables web security or the other escape hatches, not even by setting them explicitly true", async () => {
    const { prefs } = await build();
    // Absent means Electron default, which is the safe value for all of these.
    // The failure this catches is someone adding `webSecurity: false` to make a
    // local asset load, which turns off the same-origin policy for the window
    // that holds the books.
    for (const flag of ["webSecurity", "allowRunningInsecureContent", "experimentalFeatures", "nodeIntegrationInWorker", "nodeIntegrationInSubFrames", "enableBlinkFeatures"]) {
      expect(prefs[flag]).toBeUndefined();
    }
    expect(typeof prefs["preload"]).toBe("string");
    expect(String(prefs["preload"])).toContain("preload");
  });

  it("loads the app:// origin, never a file:// document", async () => {
    await build();
    expect(recorded.loadedUrl).toBe("app://mezan/index.html");
    expect(recorded.loadedUrl?.startsWith("file:")).toBe(false);
  });
});

describe("child windows and navigation", () => {
  it("denies every child window, whatever the scheme", async () => {
    await build();
    const handler = recorded.windowOpenHandler;
    expect(handler).toBeDefined();
    for (const url of ["https://example.test/x", "http://example.test/x", "app://mezan/index.html", "file:///etc/passwd", "javascript:alert(1)"]) {
      expect(handler!({ url }).action).toBe("deny");
    }
  });

  it("hands an external http(s) link to the real browser, and nothing else", async () => {
    await build();
    const handler = recorded.windowOpenHandler!;
    handler({ url: "https://mezan.test/help" });
    expect(openExternal).toHaveBeenCalledWith("https://mezan.test/help");

    openExternal.mockClear();
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "app://mezan/index.html"]) {
      handler({ url });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("refuses to navigate the window to an ordinary web origin", async () => {
    const { willNavigate } = await build();
    expect(willNavigate.length).toBeGreaterThan(0);
    for (const url of ["https://attacker.example/", "http://attacker.example/", "not a url"]) {
      expect(navigateTo(willNavigate, url)).toBe(true);
    }
  });

  it("refuses file://, javascript: and data: in a PACKAGED build — the opaque-origin trap (D128)", async () => {
    // This was a real hole, and it was production-only. `isRendererOrigin`
    // compared `url.origin`, and `app:` is not a scheme Node's URL recognises,
    // so `new URL("app://mezan/index.html").origin` serialises to the STRING
    // "null" — as does every file:, javascript: and data: URL. They compared
    // equal, the navigation was allowed, and the preload bridge
    // (`window.mezan.fetch`, i.e. the whole Hono app) was handed to whatever
    // document landed there — a local HTML file the user was persuaded to
    // save, for instance.
    //
    // Development never showed it: the Vite entry has a real origin, so
    // file:// was correctly refused there the whole time.
    const { willNavigate } = await build();
    for (const url of [
      "file:///etc/passwd",
      "file:///Users/owner/Downloads/report.html",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
    ]) {
      expect(navigateTo(willNavigate, url), url).toBe(true);
    }
  });

  it("refuses another host under the renderer's own scheme", async () => {
    // Same root cause as above: `app://attacker.example/x` used to read as the
    // renderer origin. The protocol handler does answer 404 for a foreign
    // host, so this was the outer of two gates rather than the only one — but
    // a guard that admits an attacker-chosen host is not a guard.
    const { willNavigate } = await build();
    expect(navigateTo(willNavigate, "app://attacker.example/x")).toBe(true);
  });

  it("still allows the renderer's OWN entry through (the negative control)", async () => {
    // Without this, every assertion above is satisfied by a guard that blocks
    // everything — which would leave the packaged app unable to navigate
    // itself at all.
    const { willNavigate } = await build();
    expect(navigateTo(willNavigate, "app://mezan/index.html")).toBe(false);
    expect(navigateTo(willNavigate, "app://mezan/settings")).toBe(false);
  });

  it("still allows navigation within the renderer origin, so the app router keeps working", async () => {
    const { willNavigate } = await build();
    for (const url of ["app://mezan/index.html", "app://mezan/sell/invoices"]) {
      expect(navigateTo(willNavigate, url)).toBe(false);
    }
  });
});
