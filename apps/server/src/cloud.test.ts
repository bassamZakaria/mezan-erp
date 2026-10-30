import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function boot(env: Record<string, string>): Promise<{ port: number; stop: () => Promise<void> }> {
  const port = await freePort();
  const child = spawn(tsx, [cloudEntry], {
    cwd: repoRoot,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      PORT: String(port),
      MEZAN_BACKUP_INTERVAL_MINUTES: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (c: Buffer) => {
      output += c.toString();
      if (output.includes('"event":"process.started"')) resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("close", (code) => reject(new Error(`cloud.ts exited with ${code} before listening:\n${output}`)));
  });
  return {
    port,
    stop: async () => {
      child.kill("SIGTERM");
      await exited;
    },
  };
}

/**
 * guards S-1 — the public demo shipped a published admin password behind basic auth
 * that was applied only if an undeclared variable happened to be set, i.e. a
 * writable admin session on the open internet.
 */
describe("cloud demo entry point", () => {
  it("refuses to start with no MEZAN_DEMO_PASSWORD", async () => {
    const { code, output } = await run({ MEZAN_SEED_DEMO: "1" });
    expect(code).toBe(1);
    expect(output).toContain("REFUSING TO START");
    expect(output).toContain("MEZAN_DEMO_PASSWORD");
  }, 30_000);

  it("refuses a password too short to be a shared credential", async () => {
    const { code, output } = await run({ MEZAN_SEED_DEMO: "1", MEZAN_DEMO_PASSWORD: "short" });
    expect(code).toBe(1);
    expect(output).toContain("REFUSING TO START");
  }, 30_000);

  it("refuses a literal fallback-admin password on a public deploy", async () => {
    const { code, output } = await run({
      MEZAN_DEMO_PASSWORD: "a-long-enough-demo-password",
      MEZAN_SEED_ADMIN_PASSWORD: "Cyag@2026",
    });
    expect(code).toBe(1);
    expect(output).toContain("MEZAN_SEED_ADMIN_PASSWORD");
  }, 30_000);

  it("boots without MEZAN_DEMO_PASSWORD and mounts no basic auth when no demo is seeded", async () => {
    const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-cloud-nodemo-"));
    const { port, stop } = await boot({ MEZAN_PLATFORM_DIR: platformDir });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).not.toBe(401);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    } finally {
      await stop();
      rmSync(platformDir, { recursive: true, force: true });
    }
  }, 30_000);
});
