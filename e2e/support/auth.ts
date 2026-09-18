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
const DEMO_TENANT_CODE = "demo";

export async function loginAsDemoUser(page: Page): Promise<void> {
  const platformMode = page
    .waitForResponse((r) => r.url().includes("/platform/resolve"), { timeout: 60_000 })
    .then(async (r) => ((await r.json()) as { mode?: string }).mode ?? null)
    .catch(() => null);
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

  /*
   * POLLED, not raced.
   *
   * This used to be a `Promise.race` of two 20-second `waitFor`s, then a single
   * `isVisible()` probe of the wizard, then a final 20-second wait for the PIN
   * box. On a developer machine the app is up in under a second and it always
   * worked. On a CI runner it is the dominant cause of failure: 48 of the 55
   * failures in the first real e2e run on CI came out of this one function.
   *
   * The race has three ways to lose, and they compound on a cold runner:
   *
   *   1. If neither element appears inside 20s — Vite compiling on the first
   *      request, the API still seeding `:memory:` — BOTH promises reject, the
   *      `.catch` swallows it, and the code walks on as though it had waited.
   *   2. The `isVisible()` that follows is a single instantaneous probe. It runs
   *      at whatever moment the race happened to give up, which on a slow boot
   *      is BEFORE the wizard has painted. It answers false, so the wizard is
   *      never dismissed.
   *   3. The final wait then sits for 20 more seconds on a PIN box that is
   *      behind the wizard nobody clicked, and times out at auth.ts:50.
   *
   * So it fails exactly when the machine is slow, which is exactly what CI is.
   *
   * Polling removes all three. It re-checks both elements every 250ms, dismisses
   * the wizard WHENEVER it shows up rather than at one guessed instant, tolerates
   * a click that did not take (the wizard is simply still there next tick), and
   * gives the whole thing one honest budget instead of three stacked ones.
   */
  const READY_BUDGET_MS = 60_000;
  const deadline = Date.now() + READY_BUDGET_MS;
  while (Date.now() < deadline) {
    if (await firstPinBox.isVisible().catch(() => false)) break;
    if (await dismissWizard.isVisible().catch(() => false)) {
      // Not fatal if it misses: a click that lands mid-render leaves the wizard
      // up, and the next pass simply clicks it again.
      await dismissWizard.click({ timeout: 5_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }

  // The loop above exits on the PIN box OR on the budget. Assert it explicitly,
  // so a timeout here means "the login screen never arrived in 60s" rather than
  // a confusing failure three lines later.
  await firstPinBox.waitFor({ state: "visible", timeout: 10_000 });

  // apps/server resolves the tenant from `x-mezan-tenant`; `demo` is what MEZAN_SEED_DEMO=1 provisions.
  const tenantCode = page.getByRole("textbox", { name: "رمز المنشأة" });
  if ((await platformMode) === "code" || (await tenantCode.isVisible().catch(() => false))) {
    await tenantCode.waitFor({ state: "visible", timeout: 10_000 });
    if ((await tenantCode.inputValue()) !== DEMO_TENANT_CODE) {
      await tenantCode.fill(DEMO_TENANT_CODE);
      await tenantCode.blur();
    }
    await page.getByRole("button", { name: "تغيير المنشأة" }).waitFor({ state: "visible", timeout: 20_000 });
  }

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
