import { defineConfig, devices } from "@playwright/test";

/**
 * The responsive audit, on its own config and its own ports.
 *
 * It cannot share `playwright.config.ts` because that one runs an EMPTY tenant
 * on purpose — several specs assert zero counts against it — and an empty
 * tenant has only the seeded fallback admin, which `tenantIsClaimed` treats as
 * UNCLAIMED by design (auth-routes.ts: that account exists so a fresh install
 * is never account-less, and is retired the moment a real admin appears). So
 * the app correctly opens the first-run wizard there.
 *
 * A responsive audit wants the opposite: real rows. An empty list has no
 * columns to overflow and would pass every check while proving nothing. So this
 * config seeds the DEMO tenant — ~500 invoices, a full chart, real customers —
 * which is also the state a phone user actually meets.
 */
const PORT = 5233;
const API_PORT = 3133;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /responsive\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  outputDir: "e2e-results/responsive",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm exec tsx apps/server/src/index.ts`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { PORT: String(API_PORT), MEZAN_DB: ":memory:", MEZAN_SEED_DEMO: "1" },
    },
    {
      command: `cd apps/web && pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { MEZAN_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
