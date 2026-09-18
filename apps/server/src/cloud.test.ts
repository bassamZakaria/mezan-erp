import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cloudEntry = path.join(repoRoot, "apps/server/src/cloud.ts");
const tsx = path.join(repoRoot, "node_modules/.bin/tsx");

/**
 * Runs the cloud demo entry point in a child process and reports how it ended.
 *
 * A child process, not an import: `cloud.ts` is a script with top-level
 * `await createBackend(...)` and a `serve()` call, so importing it would seed a
 * database and open a socket inside the test runner. The refusals under test
 * happen BEFORE either, so nothing is started on the paths that matter.
 */
function run(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(tsx, [cloudEntry], {
      cwd: repoRoot,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
        MEZAN_DB: path.join(repoRoot, "node_modules/.cache/mezan-cloud-test.db"),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    const kill = setTimeout(() => child.kill("SIGKILL"), 25_000);
    child.on("close", (code) => {
      clearTimeout(kill);
      resolve({ code, output });
    });
  });
}

/**
 * guards S-1 — the public demo shipped a published admin PIN behind basic auth
 * that was applied only if an undeclared variable happened to be set, i.e. a
 * writable admin session on the open internet.
 */
describe("cloud demo entry point", () => {
  it("refuses to start with no MEZAN_DEMO_PASSWORD", async () => {
    const { code, output } = await run({});
    expect(code).toBe(1);
    expect(output).toContain("REFUSING TO START");
    expect(output).toContain("MEZAN_DEMO_PASSWORD");
  }, 30_000);

  it("refuses a password too short to be a shared credential", async () => {
    const { code, output } = await run({ MEZAN_DEMO_PASSWORD: "short" });
    expect(code).toBe(1);
    expect(output).toContain("REFUSING TO START");
  }, 30_000);

  it("refuses a literal fallback-admin PIN on a public deploy", async () => {
    const { code, output } = await run({
      MEZAN_DEMO_PASSWORD: "a-long-enough-demo-password",
      MEZAN_SEED_ADMIN_PIN: "123456",
    });
    expect(code).toBe(1);
    expect(output).toContain("MEZAN_SEED_ADMIN_PIN");
  }, 30_000);
});
