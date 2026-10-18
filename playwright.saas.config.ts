import { rmSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import {
  DEFAULT_BROWSER_CLIENT,
  DEMO_API_PORT,
  DEMO_API_URL,
  DEMO_PLATFORM_DIR_ENV,
  DEMO_SERVER_TODAY,
  DEMO_WEB_PORT,
  DEMO_WEB_URL,
  MAIN_SERVER_TODAY,
  PLATFORM_DIR_ENV,
  SAAS_API_PORT,
  SAAS_API_URL,
  SAAS_WEB_PORT,
  SAAS_WEB_URL,
  browserSource,
} from "./e2e/saas/support/env";
import { API_SERVER_COMMAND, BOOT_TIMEOUT_MS, DEMO_BOOT_TIMEOUT_MS, RunDir, apiServerEnv, newRunDir, removeAbandonedRunDirs, webServerCommand } from "./e2e/saas/support/servers";

// INVARIANT: Playwright evaluates this file again in every worker. Only the runner creates the
// directory; workers inherit it through the environment, so a spec that inspects the
// tenant files on disk looks at the directory the server was actually given.
function runDir(envName: string, kind: RunDir): string {
  const inherited = process.env[envName];
  if (inherited) return inherited;
  const dir = newRunDir(kind);
  process.env[envName] = dir;
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

if (!process.env[PLATFORM_DIR_ENV]) removeAbandonedRunDirs();
const platformDir = runDir(PLATFORM_DIR_ENV, RunDir.Platform);
const demoPlatformDir = runDir(DEMO_PLATFORM_DIR_ENV, RunDir.Demo);

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
    extraHTTPHeaders: browserSource(DEFAULT_BROWSER_CLIENT),
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
      command: webServerCommand(SAAS_WEB_PORT),
      url: SAAS_WEB_URL,
      reuseExistingServer: false,
      timeout: BOOT_TIMEOUT_MS,
      stdout: "pipe",
      stderr: "pipe",
      env: { MEZAN_API_URL: SAAS_API_URL },
    },
    {
      command: API_SERVER_COMMAND,
      url: `${DEMO_API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: DEMO_BOOT_TIMEOUT_MS,
      stdout: "ignore",
      stderr: "pipe",
      env: apiServerEnv({ port: DEMO_API_PORT, platformDir: demoPlatformDir, seedDemo: true, fakeToday: DEMO_SERVER_TODAY }),
    },
    {
      command: webServerCommand(DEMO_WEB_PORT),
      url: DEMO_WEB_URL,
      reuseExistingServer: false,
      timeout: BOOT_TIMEOUT_MS,
      stdout: "ignore",
      stderr: "pipe",
      env: { MEZAN_API_URL: DEMO_API_URL },
    },
  ],
});
