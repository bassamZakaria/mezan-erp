import type { Page } from "@playwright/test";

/**
 * Phase 1 added a desktop login gate in front of the app shell
 * (apps/web/src/login/LoginScreen.tsx — App.tsx's `mode === "login"`).
 * Every screen this suite exercises lives behind it, so every spec goes
 * through here first. The seed admin's email and PIN (123456) are hardcoded
 * sample data (packages/backend/src/seed.ts's SEED_ADMIN_PIN) — not a secret.
 *
 * The PIN is six separate inputs that each hold one digit and move focus on,
 * so it is filled box by box: typing into the first one alone leaves the rest
 * empty and «دخول» stays disabled.
 */
const SEED_ADMIN_EMAIL = "admin@cyag.example";
const SEED_ADMIN_PIN = "123456";

export async function loginAsDemoUser(page: Page): Promise<void> {
  await page.goto("/");

  const email = page.getByRole("textbox", { name: "البريد الإلكتروني" });
  if (await email.isVisible().catch(() => false)) {
    await email.fill(SEED_ADMIN_EMAIL);
  }

  for (const [index, digit] of [...SEED_ADMIN_PIN].entries()) {
    await page.getByLabel(`رمز PIN رقم ${index + 1}`).fill(digit);
  }

  const submit = page.getByRole("button", { name: "دخول" });
  if (await submit.isEnabled()) await submit.click();

  // Land on the app shell (default screen is the Dashboard).
  await page.getByRole("button", { name: "تبديل المظهر" }).waitFor();
}
