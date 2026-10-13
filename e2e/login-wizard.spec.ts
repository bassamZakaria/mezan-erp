import { test, expect, type Page } from "@playwright/test";

const SEED_ADMIN_EMAIL = "admin@cyag.example";

/**
 * Login screen + first-run wizard (apps/web/src/login/LoginScreen.tsx,
 * apps/web/src/login/FirstRunWizard.tsx, App.tsx's `mode` state machine:
 * "login" -> "wizard" -> "app"). These tests exercise the login gate itself,
 * so — unlike every other spec — they do NOT use support/auth.ts's
 * loginAsDemoUser and start each test with a plain `page.goto("/")`.
 *
 * The PIN is now SIX digits everywhere (login and the wizard's admin step —
 * `PIN_LENGTH = 6` in LoginScreen.tsx, `/^\d{6}$/` in FirstRunWizard.tsx), not
 * four. A brand-new browser context (Playwright's default, no localStorage)
 * has no remembered device users, so the login screen renders straight into
 * "typing" mode with the seed admin's email pre-filled — the same state
 * support/auth.ts relies on — rather than the «مَن يعمل الآن؟» face picker.
 *
 * This platform resolves the tenant by CODE (`tenantMode === "code"` —
 * LoginScreen.tsx), so a login screen with no code entered yet refuses to
 * submit at all — filling the PIN alone surfaces "حدّد رمز المنشأة" (specify
 * the company code) instead of an actual login attempt or a wrong-PIN error.
 * `selectDemoTenant` fills and resolves the "demo" code first, the same way
 * support/auth.ts's `loginAsDemoUser` does.
 *
 * The wizard's step-indicator (<ol> of step labels) and the "تفعيل
 * الترخيص" step's own <section aria-label> render identical text for that
 * one step, so step content is scoped via `getByRole("region", {name})`
 * (the section's implicit landmark role) rather than plain text, to avoid
 * the ambiguous-locator trap that class of duplicate text creates.
 *
 * The wizard's licence step used to be a fake "تفعيل" (activate) toggle that
 * always painted a green "مُفعّل" pill with nothing behind it. It is now a
 * real file import (`licenceUi.import` — "استيراد ملف الترخيص") gated on
 * `isDesktopHost()`, which is false in this Playwright/Chromium run (no
 * Electron licence bridge) — so on the web build the button is disabled and
 * the step shows the honest "desktop only" explanation instead. The step's
 * own "التالي" is deliberately NEVER gated on licence state either way (see
 * the comment in FirstRunWizard.tsx) — a shop with no licence file yet must
 * still be able to finish the rest of setup.
 */

async function fillPin(page: Page, digits: string): Promise<void> {
  for (const [index, digit] of [...digits].entries()) {
    await page.getByLabel(`رمز PIN رقم ${index + 1}`).fill(digit);
  }
}

function wizardStep(page: Page, ariaLabel: string) {
  return page.getByRole("region", { name: ariaLabel });
}

async function selectDemoTenant(page: Page): Promise<void> {
  const tenantCode = page.getByRole("textbox", { name: "رمز المنشأة" });
  await tenantCode.fill("demo");
  await tenantCode.blur();
  await page.getByRole("button", { name: "تغيير المنشأة" }).waitFor({ state: "visible", timeout: 20_000 });
}

test.describe("Login screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("دخول is disabled until all 6 PIN digits are entered, then logs in with the correct demo PIN", async ({
    page,
  }) => {
    await selectDemoTenant(page);
    const loginButton = page.getByRole("button", { name: "دخول" });
    await expect(loginButton).toBeDisabled();

    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(SEED_ADMIN_EMAIL);
    await fillPin(page, "123456");
    // The 6th digit auto-submits (LoginScreen.tsx) — the button flips straight
    // from disabled (incomplete PIN) to disabled-while-pending, so "enabled" is
    // never a stable intermediate state to assert; the real proof it accepted
    // the PIN is landing on the app shell.

    // Lands on the app shell (default screen is the Dashboard).
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
  });

  test("shows a validation error for an incorrect PIN and stays on the login screen", async ({ page }) => {
    await selectDemoTenant(page);
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(SEED_ADMIN_EMAIL);
    await fillPin(page, "000000");

    await expect(page.getByRole("alert")).toHaveText("اسم المستخدم أو رمز PIN غير صحيح.");
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeHidden();
  });
});

test.describe("First-run wizard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "الإعداد الأولي" }).click();
    await expect(page.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeVisible();
  });

  test("cancelling returns to the login screen", async ({ page }) => {
    await page.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });

  test("back navigation returns to the previous step without losing entered data", async ({ page }) => {
    const activateStep = wizardStep(page, "تفعيل الترخيص");
    // On the web build (no Electron licence bridge) the import button is
    // disabled and the step explains why, rather than offering a fake
    // "activate" toggle — see the header comment.
    await expect(activateStep.getByRole("button", { name: "استيراد ملف الترخيص" })).toBeDisabled();
    await expect(activateStep.getByText("تُثبَّت التراخيص على الجهاز الرئيسي")).toBeVisible();
    // Deliberately never gated on licence state — a shop with no licence
    // file yet must still be able to finish the rest of setup.
    await page.getByRole("button", { name: "التالي" }).click();

    const adminStep = wizardStep(page, "إنشاء حساب المسؤول");
    await expect(adminStep).toBeVisible();
    await adminStep.getByLabel("الاسم الكامل").fill("سارة إبراهيم");
    await adminStep.getByLabel("البريد الإلكتروني").fill("sara-back-nav@example.com");

    await page.getByRole("button", { name: "رجوع" }).click();
    await expect(activateStep).toBeVisible();

    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep).toBeVisible();
    await expect(adminStep.getByLabel("الاسم الكامل")).toHaveValue("سارة إبراهيم");
    await expect(adminStep.getByLabel("البريد الإلكتروني")).toHaveValue("sara-back-nav@example.com");
  });

  test("validates the admin-account step, then surfaces the already-claimed refusal and offers a way back to sign in", async ({
    page,
  }) => {
    // The wizard's admin-creation call is tenant-scoped like every other API
    // call — without a resolved tenant code it fails client-side with "حدّد
    // رمز المنشأة" before ever reaching the server, and the tenant-code field
    // lives on the LOGIN screen, not inside the wizard. Back out, select
    // "demo", then reopen a fresh wizard so the final submission below
    // reaches the REAL /bootstrap/admin refusal instead.
    await page.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await selectDemoTenant(page);
    await page.getByRole("button", { name: "الإعداد الأولي" }).click();
    await expect(page.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeVisible();

    const activateStep = wizardStep(page, "تفعيل الترخيص");
    const nextButton = page.getByRole("button", { name: "التالي" });
    // Deliberately never gated on licence state (FirstRunWizard.tsx) — a shop
    // with no licence file yet must still be able to finish setting up.
    await expect(nextButton).toBeEnabled();
    // On the web build (no Electron licence bridge) the import button is
    // disabled and the step explains why, rather than offering a fake
    // "activate" toggle — see the header comment.
    await expect(activateStep.getByRole("button", { name: "استيراد ملف الترخيص" })).toBeDisabled();
    await nextButton.click();

    const adminStep = wizardStep(page, "إنشاء حساب المسؤول");
    await expect(adminStep).toBeVisible();

    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep.getByRole("alert")).toHaveText("اسم المنشأة مطلوب.");
    await adminStep.getByLabel("اسم المنشأة").fill("متجر سارة");

    // Missing name/email.
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep.getByRole("alert")).toHaveText("الاسم الكامل والبريد الإلكتروني مطلوبان.");

    await adminStep.getByLabel("الاسم الكامل").fill("سارة إبراهيم");
    await adminStep.getByLabel("البريد الإلكتروني").fill("sara-finish-flow@example.com");

    // PIN not 6 digits yet.
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep.getByRole("alert")).toHaveText("الرمز السرّي يجب أن يكون ٦ أرقام.");

    await adminStep.getByLabel("الرمز السرّي (٦ أرقام)").fill("123456");
    await adminStep.getByLabel("تأكيد رمز PIN").fill("654321");

    // PIN / confirmation mismatch.
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep.getByRole("alert")).toHaveText("رمز PIN وتأكيده غير متطابقين.");

    await adminStep.getByLabel("تأكيد رمز PIN").fill("123456");
    await page.getByRole("button", { name: "التالي" }).click();

    // The demo tenant is already claimed (a real seeded admin exists), so a
    // brand-new /bootstrap/admin call is refused with a 409 rather than
    // advancing to "seed" — the wizard's own recovery path for "opening the
    // wizard on a machine already set up" (FirstRunWizard.tsx). Every step
    // through here still ran the wizard's OWN client-side validation for
    // real; only the tenant this environment can point it at is already set
    // up, so the happy path to "seed"/"import" cannot be exercised in this
    // suite without claiming a tenant some other test also depends on being
    // unclaimed.
    await expect(adminStep.getByRole("alert")).toHaveText("تم إعداد هذه المنشأة بالفعل. سجّل الدخول بحسابك.");
    await expect(adminStep).toBeVisible();

    await adminStep.getByRole("button", { name: "سجّل الدخول بحسابك" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });
});
