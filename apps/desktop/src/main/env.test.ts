import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";

/**
 * env.ts decides two things that matter to security: which URL the privileged
 * main window loads, and where the books and their backups live on disk. The
 * dev-server override is an ENVIRONMENT VARIABLE, so the question this file
 * answers is whether a shipped build can be pointed somewhere else by setting
 * one.
 */

const electronApp = {
  isPackaged: false,
  getPath: vi.fn((name: string) => path.join("/Users/tester/Library/Application Support", name === "userData" ? "Mezan" : name)),
};

vi.mock("electron", () => ({ app: electronApp }));

const ORIGINAL_ENV = process.env["MEZAN_WEB_DEV_SERVER_URL"];

beforeEach(() => {
  electronApp.isPackaged = false;
  delete process.env["MEZAN_WEB_DEV_SERVER_URL"];
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env["MEZAN_WEB_DEV_SERVER_URL"];
  else process.env["MEZAN_WEB_DEV_SERVER_URL"] = ORIGINAL_ENV;
});

describe("which URL the main window is allowed to load", () => {
  it("serves the app:// origin in a packaged build", async () => {
    const { rendererEntry, isDev } = await import("./env.js");
    electronApp.isPackaged = true;
    expect(isDev()).toBe(false);
    expect(rendererEntry().url).toBe("app://mezan/index.html");
  });

  it("IGNORES MEZAN_WEB_DEV_SERVER_URL in a packaged build, so an env var cannot repoint the privileged window", async () => {
    const { rendererEntry } = await import("./env.js");
    electronApp.isPackaged = true;
    process.env["MEZAN_WEB_DEV_SERVER_URL"] = "http://attacker.example/app";
    expect(rendererEntry().url).toBe("app://mezan/index.html");
  });

  it("uses the Vite dev server in development, defaulting to localhost:5173", async () => {
    const { rendererEntry, isDev } = await import("./env.js");
    expect(isDev()).toBe(true);
    expect(rendererEntry().url).toBe("http://localhost:5173");

    process.env["MEZAN_WEB_DEV_SERVER_URL"] = "http://localhost:5199";
    expect(rendererEntry().url).toBe("http://localhost:5199");
  });
});

describe("where the books and their backups land", () => {
  it("keeps the live database inside the per-user app-data directory", async () => {
    const { defaultDbPath } = await import("./env.js");
    const dbPath = defaultDbPath();
    expect(path.basename(dbPath)).toBe("mezan.db");
    expect(path.dirname(dbPath)).toBe(electronApp.getPath("userData"));
  });

  it("keeps backups OUTSIDE userData, because an uninstall wipes that directory", async () => {
    const { defaultBackupsDir, defaultDbPath } = await import("./env.js");
    const backups = defaultBackupsDir();
    const userData = electronApp.getPath("userData");
    expect(path.basename(backups)).toBe("Mezan Backups");
    expect(backups.startsWith(`${userData}${path.sep}`)).toBe(false);
    expect(path.dirname(backups)).toBe(path.dirname(userData));
    // Both are still plaintext on disk — no encryption at rest exists yet, so
    // the file that IS the books is readable by any OS account that can reach
    // the folder. Recorded here because the path decision above is the only
    // control this module carries.
    expect(defaultDbPath().endsWith(".db")).toBe(true);
  });

  it("points the preload at the built CJS bundle beside the main output", async () => {
    const { preloadPath } = await import("./env.js");
    const preload = preloadPath();
    expect(path.basename(preload)).toBe("index.cjs");
    expect(path.basename(path.dirname(preload))).toBe("preload");
  });
});
