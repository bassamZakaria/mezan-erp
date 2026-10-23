import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_REQUEST_CAPS, PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD } from "./e2e/saas/support/env";

/**
 * Every screen, at desktop and phone width, on its own ports (5311/3311) so it
 * can never attach to another suite's server through `reuseExistingServer`.
 *
 * `apps/server` ignores `MEZAN_DB`; its state lives under `MEZAN_PLATFORM_DIR`.
 * A fresh temp directory per run is what actually makes the tenant fresh — the
 * default `./.data/dev-platform` would carry the previous run's journeys over.
 */
const PORT = 5311;
const API_PORT = 3311;
const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-every-screen-"));

export default defineConfig({
  testDir: "./e2e",
  testMatch: [/every-screen\.spec\.ts/, /journeys\/.*\.spec\.ts/],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "e2e-results/every-screen",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ar-EG",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
      testIgnore: /journeys\//,
    },
  ],
  webServer: [
    {
      command: `pnpm exec tsx apps/server/src/index.ts`,
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(API_PORT),
        MEZAN_DB: ":memory:",
        MEZAN_SEED_DEMO: "1",
        MEZAN_PLATFORM_DIR: platformDir,
        MEZAN_PLATFORM_OWNER_EMAIL: PLATFORM_OWNER_EMAIL,
        MEZAN_PLATFORM_OWNER_PASSWORD: PLATFORM_OWNER_PASSWORD,
        ...E2E_REQUEST_CAPS,
      },
    },
    {
      command: `cd apps/web && pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { MEZAN_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
