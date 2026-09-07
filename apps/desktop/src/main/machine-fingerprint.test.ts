import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hardwareProfile } from "./machine-fingerprint.js";

/**
 * guards L-13: the machine fingerprint shelled out to `reg`/`ioreg` BY BARE
 * NAME. That is PATH-resolvable, so anything earlier on the PATH answers for
 * it, and a pirate who reads one licensed machine's id can make every other
 * machine report it. Two things close that: absolute paths, and a second source
 * that executes nothing at all.
 */
describe("the machine fingerprint sources", () => {
  it("invokes the OS binaries at absolute paths, never by bare name", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./machine-fingerprint.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/execFileSync\(\s*"reg"/);
    expect(source).not.toMatch(/execFileSync\(\s*"ioreg"/);
    expect(source).toContain('"/usr/sbin/ioreg"');
    expect(source).toContain("System32");
  });

  it("mixes in a hardware profile read without executing anything", () => {
    const profile = hardwareProfile();
    expect(profile.split("/").length).toBe(4);
    expect(profile.startsWith(`${process.platform}/${process.arch}/`)).toBe(true);
  });

  /**
   * It must be stable across launches or a licensed shop locks itself out: RAM
   * is rounded to whole gibibytes and only the first CPU's model is used, so
   * ordinary reporting jitter changes nothing.
   */
  it("is stable across repeated reads", () => {
    expect(hardwareProfile()).toBe(hardwareProfile());
    expect(hardwareProfile()).toMatch(/\/\d+G$/);
  });
});
