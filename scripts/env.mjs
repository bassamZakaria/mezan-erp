import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

/**
 * Named local environments, each a FULL COPY of what the cloud demo runs:
 * apps/server/src/cloud.ts serving the built web bundle at `/` and the backend
 * at `/api` from one process. Running the same entrypoint as the deployed
 * service is the point — a staging box that runs `pnpm dev` instead tests the
 * vite proxy, not the thing that ships.
 */
const ENVIRONMENTS = {
  testing: { port: 4101, platformDir: ".data/testing-platform" },
  staging: { port: 4102, platformDir: ".data/staging-platform" },
};

const [name, ...flags] = process.argv.slice(2);
const environment = ENVIRONMENTS[name];

if (!environment) {
  console.error(`[env] unknown environment ${name ?? "(none)"}`);
  console.error(`[env] usage: node scripts/env.mjs <${Object.keys(ENVIRONMENTS).join("|")}> [--fresh] [--no-build]`);
  process.exit(1);
}

const fresh = flags.includes("--fresh");
const skipBuild = flags.includes("--no-build");
const { port, platformDir } = environment;

mkdirSync(".data", { recursive: true });

if (fresh) {
  rmSync(platformDir, { recursive: true, force: true });
  console.log(`[env] ${name}: removed ${platformDir}`);
}

if (!skipBuild) {
  console.log(`[env] ${name}: building the web bundle`);
  const build = spawnSync("pnpm", ["--filter", "web", "build"], { stdio: "inherit" });
  if (build.status !== 0) {
    console.error(`[env] ${name}: web build failed — not starting`);
    process.exit(build.status ?? 1);
  }
}

console.log(`[env] ${name}: http://localhost:${port}  (platform dir: ${platformDir})`);
console.log(`[env] ${name}: platform owner at /platform/login — owner@mezan.local / owner-password-123`);
console.log(`[env] ${name}: browser basic auth — demo / local-demo-password`);
console.log(`[env] ${name}: demo tenant code "demo" — sign in as admin@cyag.example with PIN 123456`);

const child = spawn("pnpm", ["exec", "tsx", "apps/server/src/cloud.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    MEZAN_PLATFORM_DIR: platformDir,
    MEZAN_SEED_DEMO: "1",
    MEZAN_PLATFORM_OWNER_EMAIL: "owner@mezan.local",
    MEZAN_PLATFORM_OWNER_PASSWORD: "owner-password-123",
    MEZAN_DEMO_PASSWORD: "local-demo-password",
    ...(process.env.MEZAN_PAYMOB_SECRET_KEY ? {} : { MEZAN_PAYMOB_TEST_MODE: process.env.MEZAN_PAYMOB_TEST_MODE ?? "1" }),
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
