import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileLogger } from "./log.js";

/**
 * guards support #1: there was no log file at all. Every startup failure was a
 * `console.error` into a console a shop owner launching from the Dock never
 * opens, followed by `app.exit(1)` — so the support call is «البرنامج لا يفتح»
 * with nothing on either end of the phone to go on.
 */
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-log-"));
  dirs.push(dir);
  return dir;
}

describe("createFileLogger", () => {
  it("writes a timestamped line to a file under the given directory", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = await scratchDir();
    const log = createFileLogger(dir);
    log("[crypto] no keyring on this machine");

    const contents = await readFile(log.filePath, "utf8");
    expect(contents).toContain("[crypto] no keyring on this machine");
    expect(contents).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("creates the directory if it does not exist yet", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = path.join(await scratchDir(), "nested", "logs");
    const log = createFileLogger(dir);
    log("first line");
    expect((await stat(log.filePath)).isFile()).toBe(true);
  });

  it("rotates once past the size cap rather than growing without bound", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = await scratchDir();
    const log = createFileLogger(dir);
    await writeFile(log.filePath, "x".repeat(1_000_001), "utf8");

    log("after rotation");
    const contents = await readFile(log.filePath, "utf8");
    expect(contents).toContain("after rotation");
    expect(contents.length).toBeLessThan(1000);
    expect((await stat(path.join(dir, "mezan.1.log"))).size).toBeGreaterThan(1_000_000);
  });

  /** A log write must never be the reason the app fails to start. */
  it("never throws when the directory cannot be written", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createFileLogger("/proc/definitely-not-writable/mezan");
    expect(() => log("still fine")).not.toThrow();
  });
});
