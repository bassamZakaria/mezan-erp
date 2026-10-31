import { test, expect, type Page } from "@playwright/test";
import { PASSWORD_LABEL } from "./saas/support/env";

const SEED_ADMIN_EMAIL = "admin@cyag.example";
const SEED_ADMIN_PASSWORD = "Cyag@2026";

/**
 * The cloud login gate (apps/web/src/login/LoginScreen.tsx). These tests
 * exercise the gate itself, so — unlike every other spec — they do NOT use
 * support/auth.ts's loginAsDemoUser and start each test with a plain
 * `page.goto("/")`.
 *
 * A brand-new browser context (Playwright's default, no localStorage) has no
 * remembered device users, so the login screen renders straight into "typing"
 * mode rather than the «مَن يعمل الآن؟» face picker.
 *
 * This platform resolves the tenant by CODE (`tenantMode === "code"` —
 * LoginScreen.tsx), so a login screen with no code entered yet refuses to
 * submit at all — filling the password alone surfaces "حدّد رمز المنشأة" (specify
 * the company code) instead of an actual login attempt or a wrong-password error.
 * `selectDemoTenant` fills and resolves the "demo" code first, the same way
 * support/auth.ts's `loginAsDemoUser` does.
 *
 * The first-run wizard is not reachable here: it sets up the one company a
 * desktop install holds, and a company on the cloud is created by signing up.
 * Its steps are covered in apps/web/src/login/FirstRunWizard.test.tsx.
 */

async function fillPassword(page: Page, password: string): Promise<void> {
  const field = page.getByLabel(PASSWORD_LABEL, { exact: true });
  await field.fill(password);
  await field.press("Enter");
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

  test("دخول is disabled until the email and password are entered, then logs in with the demo password", async ({
    page,
  }) => {
    await selectDemoTenant(page);
    const loginButton = page.getByRole("button", { name: "دخول" });
    await expect(loginButton).toBeDisabled();

    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(SEED_ADMIN_EMAIL);
    await fillPassword(page, SEED_ADMIN_PASSWORD);

    // Lands on the app shell (default screen is the Dashboard).
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
  });

  test("shows a validation error for an incorrect password and stays on the login screen", async ({ page }) => {
    await selectDemoTenant(page);
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(SEED_ADMIN_EMAIL);
    await fillPassword(page, "wrong-password-0");

    await expect(page.getByRole("alert")).toHaveText("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeHidden();
  });
});

test.describe("The way to a first account on the cloud", () => {
  test("is the signup page, before and after a company code is entered, and never the first-run wizard", async ({ page }) => {
    const wizardLink = page.getByRole("button", { name: "الإعداد الأولي" });
    const signupLink = page.getByRole("link", { name: "أنشئ حسابًا جديدًا" });

    await page.goto("/");
    await expect(signupLink).toBeVisible();
    await expect(wizardLink).toHaveCount(0);

    await selectDemoTenant(page);
    await expect(wizardLink).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "معالج الإعداد الأولي" })).toHaveCount(0);

    await signupLink.click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "أنشئ حساب ميزان" })).toBeVisible();
  });
});
