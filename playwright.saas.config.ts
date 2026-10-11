import { rmSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { MAIN_SERVER_TODAY, PLATFORM_DIR_ENV, SAAS_API_PORT, SAAS_API_URL, SAAS_WEB_PORT, SAAS_WEB_URL } from "./e2e/saas/support/env";
import { API_SERVER_COMMAND, BOOT_TIMEOUT_MS, RunDir, apiServerEnv, newRunDir, removeAbandonedRunDirs } from "./e2e/saas/support/servers";

// Playwright evaluates this file again in every worker. Only the runner creates the
// directory; workers inherit it through the environment, so a spec that inspects the
// tenant files on disk looks at the directory the server was actually given.
const inherited = process.env[PLATFORM_DIR_ENV];
if (!inherited) removeAbandonedRunDirs();
const platformDir = inherited ?? newRunDir(RunDir.Platform);
if (!inherited) {
  process.env[PLATFORM_DIR_ENV] = platformDir;
  process.on("exit", () => rmSync(platformDir, { recursive: true, force: true }));
}

export default defineConfig({
  testDir: "./e2e/saas",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "e2e-results/saas-artifacts",
  use: {
    baseURL: SAAS_WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: API_SERVER_COMMAND,
      url: `${SAAS_API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: BOOT_TIMEOUT_MS,
      stdout: "pipe",
      stderr: "pipe",
      env: apiServerEnv({ port: SAAS_API_PORT, platformDir, seedDemo: false, fakeToday: MAIN_SERVER_TODAY }),
    },
    {
      command: `cd apps/web && pnpm exec vite --config vite.saas.config.ts --port ${SAAS_WEB_PORT} --strictPort --host 127.0.0.1`,
      url: SAAS_WEB_URL,
      reuseExistingServer: false,
      timeout: BOOT_TIMEOUT_MS,
      stdout: "pipe",
      stderr: "pipe",
      env: { MEZAN_API_URL: SAAS_API_URL },
    },
  ],
});
