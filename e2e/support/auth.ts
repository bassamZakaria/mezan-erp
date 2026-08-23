import type { Page } from "@playwright/test";

/**
 * Phase 1 added a desktop login gate in front of the app shell
 * (apps/web/src/login/LoginScreen.tsx — App.tsx renders it whenever
 * ApiContext has no session).
 * Every screen this suite exercises lives behind it, so every spec goes
 * through here first. The demo PIN (1234) is hardcoded sample data
 * (the seeded admin PIN) — not a secret.
 */
export async function loginAsDemoUser(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("رمز PIN رقم 1").click();
  await page.keyboard.type("1234");
  await page.getByRole("button", { name: "دخول" }).click();
  // Land on the app shell (default screen is the Dashboard).
  await page.getByRole("button", { name: "تبديل المظهر" }).waitFor();
}
