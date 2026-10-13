import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — targets the web build (apps/web), the Electron
 * shell's E2E is deferred/stubbed in CI (see .github/workflows/ci.yml). Run
 * locally with `pnpm test:e2e` (starts its own dev server on PORT below).
 *
 * Not wired into the required `pnpm typecheck && pnpm lint && pnpm test &&
 * pnpm --filter web build` gate — see the optional `e2e` CI job.
 */
const PORT = 5183;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const API_PORT = 3187;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-e2e-platform-"));

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [/every-screen\.spec\.ts/, /saas\//],
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "e2e-results/artifacts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    // The real cloud entrypoint (apps/server), on a fresh temp platform
    // directory per run so e2e never inherits another run's tenants.
    {
      command: `pnpm exec tsx apps/server/src/index.ts`,
      url: `${API_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(API_PORT),
        MEZAN_PLATFORM_DIR: platformDir,
        MEZAN_SEED_DEMO: "1",
        MEZAN_PLATFORM_OWNER_EMAIL: "owner@mezan.local",
        MEZAN_PLATFORM_OWNER_PASSWORD: "owner-password-123",
      },
    },
    {
      // `pnpm --filter web exec vite -- --port …` silently drops the forwarded
      // flags in this pnpm version — running from apps/web directly is the
      // form that reliably passes them through to vite's CLI.
      // `--host 127.0.0.1` matters: Vite's default "localhost" host can bind
      // IPv6-only on some machines, and Playwright's readiness probe below
      // hits 127.0.0.1 explicitly — mismatched families look like a hung
      // server (ECONNREFUSED) even though Vite logged "ready".
      command: `cd apps/web && pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { MEZAN_API_URL: API_URL },
    },
  ],
});
