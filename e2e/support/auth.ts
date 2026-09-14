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

  /*
   * A freshly seeded tenant is SEEDED but not CLAIMED, and an unclaimed tenant
   * opens the first-run wizard over the login screen
   * (`AppLayout.tsx` — `bootstrapStatus.data?.claimed === false`). The e2e
   * backend runs on `:memory:` and is therefore unclaimed on every start, so
   * every spec in this suite landed on «معالج الإعداد الأولي» and timed out
   * waiting for a PIN box that was never on screen.
   *
   * The wizard is dismissed rather than completed: these specs want the SEEDED
   * admin and the seeded chart of accounts, not a tenant the wizard just built,
   * and cancelling is exactly the path a real operator takes when the install
   * was already provisioned for them.
   */
  const dismissWizard = page.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" });
  const firstPinBox = page.getByLabel("رمز PIN رقم 1");

  // Waited for, not probed: `page.goto` resolves before the bootstrap query
  // settles, so an instant `isVisible()` check runs while NEITHER the wizard
  // nor the login screen is on the page yet, and always answers false.
  await Promise.race([
    dismissWizard.waitFor({ state: "visible", timeout: 20_000 }),
    firstPinBox.waitFor({ state: "visible", timeout: 20_000 }),
  ]).catch(() => undefined);

  if (await dismissWizard.isVisible().catch(() => false)) {
    await dismissWizard.click();
  }

  // Whichever branch ran, the login screen is the thing we act on next, so wait
  // for it explicitly rather than letting the race decide we are ready.
  await firstPinBox.waitFor({ state: "visible", timeout: 20_000 });

  const email = page.getByRole("textbox", { name: "البريد الإلكتروني" });
  if (await email.isVisible().catch(() => false)) {
    await email.fill(SEED_ADMIN_EMAIL);
  }

  for (const [index, digit] of [...SEED_ADMIN_PIN].entries()) {
    await page.getByLabel(`رمز PIN رقم ${index + 1}`).fill(digit);
  }

  const submit = page.getByRole("button", { name: "دخول" });
  if (await submit.isEnabled()) await submit.click();

  /*
   * Land on the app shell (default screen is the Dashboard).
   *
   * Waits for the MAIN landmark rather than a chrome control. The theme toggle
   * used to serve as the signal, but it lives in the workspace column, and
   * below `RAIL_BREAKPOINT` that column is a drawer — so on a phone-sized
   * viewport the old wait never resolved even though the shell had rendered
   * perfectly well. `main` is there at every width by definition.
   */
  await page.locator("main").first().waitFor({ state: "visible" });
}
