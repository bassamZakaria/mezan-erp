import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  PLATFORM_OWNER_EMAIL,
  PLATFORM_OWNER_PASSWORD,
  SAAS_API_PORT,
  SAAS_API_URL,
  SAAS_WEB_PORT,
  SAAS_WEB_URL,
  TENANT_DOMAIN,
} from "./e2e/saas/support/env";

const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-saas-e2e-platform-"));

export default defineConfig({
  testDir: "./e2e/saas",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
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
      command: "pnpm exec tsx apps/server/src/index.ts",
      url: `${SAAS_API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(SAAS_API_PORT),
        MEZAN_PLATFORM_DIR: platformDir,
        MEZAN_SEED_DEMO: "1",
        MEZAN_PLATFORM_OWNER_EMAIL: PLATFORM_OWNER_EMAIL,
        MEZAN_PLATFORM_OWNER_PASSWORD: PLATFORM_OWNER_PASSWORD,
        MEZAN_PAYMOB_TEST_MODE: "1",
        MEZAN_TENANT_DOMAIN: TENANT_DOMAIN,
        MEZAN_TRUST_PROXY: "1",
      },
    },
    {
      command: `cd apps/web && pnpm exec vite --config vite.saas.config.ts --port ${SAAS_WEB_PORT} --strictPort --host 127.0.0.1`,
      url: SAAS_WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { MEZAN_API_URL: SAAS_API_URL },
    },
  ],
});
