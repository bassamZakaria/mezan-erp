import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, goHome } from "./support/nav";

/**
 * Routing through the workspace-column shell (packages/ui/src/shell/AppShell.tsx).
 * Every screen is reached through «كل الشاشات» (see support/nav.ts) except the
 * dashboard, which is the icon beside the wordmark in row one, not a workspace
 * screen. The app now uses real URLs (apps/web/src/router/routes.tsx) rather
 * than a `hashchange` listener, so the URL is asserted after every navigation.
 * There is no more "قريباً" placeholder concept — every nav item routes
 * somewhere (apps/web/src/router/screens.ts's SCREEN_MODULES).
 */

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("starts on the Dashboard with the home icon marked current", async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "لوحة التحكم", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("دليل الحسابات switches to the Chart of Accounts screen", async ({ page }) => {
    await clickSidebarItem(page, "دليل الحسابات");
    await expect(page).toHaveURL(/\/money\/coa$/);
    await expect(page.getByRole("heading", { name: "دليل الحسابات" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeHidden();
    // The dashboard icon loses its current marker once another screen is open.
    await expect(page.getByRole("button", { name: "لوحة التحكم", exact: true })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    // The workspace column now marks المالية والإقفال (money) current.
    await expect(
      page.locator('nav[aria-label="التنقل بين مساحات العمل"] button', { hasText: "المالية والإقفال" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("Settings screens route to general / branches / warehouses", async ({ page }) => {
    await clickSidebarItem(page, "عام");
    await expect(page).toHaveURL(/\/setup\/settings-general$/);
    await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible();

    await clickSidebarItem(page, "الفروع");
    await expect(page).toHaveURL(/\/setup\/settings-branches$/);
    await expect(page.getByRole("heading", { name: "الفروع" })).toBeVisible();

    await clickSidebarItem(page, "المستودعات");
    await expect(page).toHaveURL(/\/setup\/settings-warehouses$/);
    await expect(page.getByRole("heading", { name: "المستودعات" })).toBeVisible();
  });

  test("can navigate to Sales Invoices and back to the Dashboard via the home icon", async ({ page }) => {
    await clickSidebarItem(page, "فواتير المبيعات");
    await expect(page).toHaveURL(/\/sell\/sales-invoices$/);
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

    await goHome(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
  });

  test("«كل الشاشات» search narrows the list to matching screens and opens the one chosen", async ({ page }) => {
    await page.getByRole("button", { name: "كل الشاشات", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();

    const results = dialog.locator('nav[aria-label="تصفية حسب مساحة العمل"] + div');
    await expect(results.getByRole("button", { name: "الموردون", exact: true })).toBeVisible();

    await dialog.getByRole("searchbox", { name: "ابحث في كل الشاشات" }).fill("الموردون");
    // Narrowing to an unrelated screen hides it from the results pane.
    await expect(results.getByRole("button", { name: "دليل الحسابات", exact: true })).toBeHidden();
    await expect(results.getByRole("button", { name: "الموردون", exact: true })).toBeVisible();

    await results.getByRole("button", { name: "الموردون", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/vendors$/);
    await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
  });
});
