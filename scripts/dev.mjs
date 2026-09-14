import { spawn } from "node:child_process";

const fresh = process.argv.includes("--fresh");
const platformDir = process.env.MEZAN_PLATFORM_DIR ?? ".data/dev-platform";

if (fresh) {
  const { rmSync } = await import("node:fs");
  rmSync(platformDir, { recursive: true, force: true });
  console.log(`[dev] removed ${platformDir} (--fresh)`);
}

const children = new Map();
const failures = new Map();

function run(name, command, args, env) {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.set(name, child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const shortLived = Date.now() - startedAt < 3000;
    const strikes = shortLived ? (failures.get(name) ?? 0) + 1 : 0;
    failures.set(name, strikes);
    if (strikes >= 3) {
      console.error(`[dev] ${name} keeps failing on startup (${signal ?? code}) — stopping everything`);
      shutdown(code ?? 1);
      return;
    }
    console.error(`[dev] ${name} exited (${signal ?? code}) — restarting`);
    run(name, command, args, env);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("server", "pnpm", ["exec", "tsx", "apps/server/src/index.ts"], {
  MEZAN_SEED_DEMO: "1",
  MEZAN_PLATFORM_DIR: platformDir,
  MEZAN_PLATFORM_OWNER_EMAIL: "owner@mezan.local",
  MEZAN_PLATFORM_OWNER_PASSWORD: "owner-password-123",
});
run("web", "pnpm", ["--filter", "web", "dev"], {});
