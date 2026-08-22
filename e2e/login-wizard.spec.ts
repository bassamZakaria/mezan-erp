import { test, expect, type Page } from "@playwright/test";

/**
 * Login screen + first-run wizard (apps/web/src/login/LoginScreen.tsx,
 * apps/web/src/login/FirstRunWizard.tsx, App.tsx's `mode` state machine:
 * "login" -> "wizard" -> "app"). These tests exercise the login gate itself,
 * so — unlike every other spec — they do NOT use support/auth.ts's
 * loginAsDemoUser and start each test with a plain `page.goto("/")`.
 *
 * The wizard's step-indicator (<ol> of step labels) and the "تفعيل
 * الترخيص" step's own <section aria-label> render identical text for that
 * one step, so step content is scoped via `getByRole("region", {name})`
 * (the section's implicit landmark role) rather than plain text, to avoid
 * the ambiguous-locator trap that class of duplicate text creates.
 */

async function fillPin(page: Page, digits: string): Promise<void> {
  await page.getByLabel("رمز PIN رقم 1").click();
  await page.keyboard.type(digits);
}

function wizardStep(page: Page, ariaLabel: string) {
  return page.getByRole("region", { name: ariaLabel });
}

test.describe("Login screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("دخول is disabled until all 4 PIN digits are entered, then logs in with the correct demo PIN", async ({
    page,
  }) => {
    const loginButton = page.getByRole("button", { name: "دخول" });
    await expect(loginButton).toBeDisabled();

    await fillPin(page, "1234");
    await expect(loginButton).toBeEnabled();
    await loginButton.click();

    // Lands on the app shell (default screen is the Dashboard).
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
  });

  test("shows a validation error for an incorrect PIN and stays on the login screen", async ({ page }) => {
    await fillPin(page, "0000");
    await page.getByRole("button", { name: "دخول" }).click();

    await expect(page.getByRole("alert")).toHaveText("اسم المستخدم أو رمز PIN غير صحيح.");
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeHidden();
  });
});

test.describe("First-run wizard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "أول مرة على ميزان؟ ابدأ معالج الإعداد الأولي" }).click();
    await expect(page.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeVisible();
  });

  test("cancelling returns to the login screen", async ({ page }) => {
    await page.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });

  test("back navigation returns to the previous step without losing entered data", async ({ page }) => {
    const activateStep = wizardStep(page, "تفعيل الترخيص");
    await activateStep.getByRole("button", { name: "تفعيل" }).click();
    await expect(activateStep.getByRole("button", { name: "تم التفعيل" })).toBeDisabled();
    await page.getByRole("button", { name: "التالي" }).click();

    const adminStep = wizardStep(page, "إنشاء حساب المسؤول");
    await expect(adminStep).toBeVisible();
    await adminStep.getByLabel("الاسم الكامل").fill("سارة إبراهيم");
    await adminStep.getByLabel("البريد الإلكتروني").fill("sara@example.com");

    await page.getByRole("button", { name: "رجوع" }).click();
    await expect(activateStep).toBeVisible();
    // Activation status persisted across the back-navigation.
    await expect(activateStep.getByRole("button", { name: "تم التفعيل" })).toBeDisabled();

    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep).toBeVisible();
    await expect(adminStep.getByLabel("الاسم الكامل")).toHaveValue("سارة إبراهيم");
    await expect(adminStep.getByLabel("البريد الإلكتروني")).toHaveValue("sara@example.com");
  });

  test("validates the admin-account step, then advances through seed and import to finish in the app", async ({
    page,
  }) => {
    const activateStep = wizardStep(page, "تفعيل الترخيص");
    const nextButton = page.getByRole("button", { name: "التالي" });
    await expect(nextButton).toBeDisabled();
    await activateStep.getByRole("button", { name: "تفعيل" }).click();
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    const adminStep = wizardStep(page, "إنشاء حساب المسؤول");
    await expect(adminStep).toBeVisible();

    // Missing name/email.
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep.getByRole("alert")).toHaveText("الاسم الكامل والبريد الإلكتروني مطلوبان.");

    await adminStep.getByLabel("الاسم الكامل").fill("سارة إبراهيم");
    await adminStep.getByLabel("البريد الإلكتروني").fill("sara@example.com");

    // PIN not 4 digits yet.
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep.getByRole("alert")).toHaveText("رمز PIN يجب أن يكون 4 أرقام.");

    await adminStep.getByLabel("رمز PIN (4 أرقام)").fill("1234");
    await adminStep.getByLabel("تأكيد رمز PIN").fill("4321");

    // PIN / confirmation mismatch.
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(adminStep.getByRole("alert")).toHaveText("رمز PIN وتأكيده غير متطابقين.");

    await adminStep.getByLabel("تأكيد رمز PIN").fill("1234");
    await page.getByRole("button", { name: "التالي" }).click();

    const seedStep = wizardStep(page, "تهيئة البيانات الأساسية");
    await expect(seedStep).toBeVisible();
    const seedNext = page.getByRole("button", { name: "التالي" });
    await expect(seedNext).toBeDisabled();
    await seedStep.getByRole("button", { name: "تشغيل الكل" }).click();
    await expect(seedStep.getByText("جاهز")).toHaveCount(5);
    await expect(seedNext).toBeEnabled();
    await seedNext.click();

    const importStep = wizardStep(page, "استيراد البيانات");
    await expect(importStep).toBeVisible();
    await expect(importStep.getByRole("button", { name: "استيراد الآن" })).toBeDisabled();

    await page.getByRole("button", { name: "إنهاء والانتقال إلى النظام" }).click();
    // The wizard persisted a real admin (سارة إبراهيم) and established their
    // session, so we land in the app shell greeted by that real user.
    await expect(page.getByRole("button", { name: "تبديل المظهر" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /مرحباً، سارة/ })).toBeVisible();
  });
});
