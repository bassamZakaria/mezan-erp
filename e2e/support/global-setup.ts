import { chromium, type FullConfig } from "@playwright/test";
import { loginAsDemoUser } from "./auth";

/**
 * Signs in once before any test's clock starts.
 *
 * Vite compiles the app on the first request and the API opens the tenant on
 * the first login, and on a cold server that costs each worker's first test
 * about twenty seconds of its thirty — so whichever spec happened to run first
 * timed out, a different one every run. Paying that cost here, once, leaves
 * every test the budget it was written against.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("global setup: no baseURL on the first project");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await loginAsDemoUser(page);
    await page.waitForLoadState("networkidle");
  } finally {
    await browser.close();
  }
}
