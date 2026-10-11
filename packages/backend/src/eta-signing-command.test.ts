import { describe, expect, it } from "vitest";
import { createSigningCommandRunner } from "./eta-signing-command.js";

const node = process.execPath;

describe("the external signing program", () => {
  it("returns what the program wrote for the document it was given", async () => {
    const run = createSigningCommandRunner();

    const result = await run(node, ["-e", "process.stdin.on('data', (d) => process.stdout.write('SIG:' + d))"], "canonical");

    expect(result).toEqual({ code: 0, stdout: "SIG:canonical", stderr: "" });
  });

  it("kills a program that never exits and reports a failed signature in Arabic", async () => {
    const run = createSigningCommandRunner(150);
    const started = Date.now();

    const result = await run(node, ["-e", "setInterval(() => {}, 1000); process.stdout.write(String(process.pid))"], "canonical");

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("لم ينتهِ برنامج التوقيع");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("leaves no child behind once it has timed out", async () => {
    const run = createSigningCommandRunner(150);
    const pidFile = `${process.env["TMPDIR"] ?? "/tmp"}/mezan-signer-${process.pid}-${Date.now()}.pid`;

    await run(node, ["-e", `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`], "canonical");
    const { readFileSync, rmSync } = await import("node:fs");
    const pid = Number(readFileSync(pidFile, "utf8"));
    rmSync(pidFile);

    expect(() => process.kill(pid, 0)).toThrow();
  });
});
