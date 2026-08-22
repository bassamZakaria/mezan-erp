import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";

test.describe("App shell", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("renders RTL with Arabic lang/dir on the document root", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(page).toHaveTitle(/ميزان|Mezan/);
  });

  test("sidebar shows the brand mark and every module group in Arabic", async ({ page }) => {
    const sidebar = page.locator("aside");
    await expect(sidebar.getByText("ميزان", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Mezan ERP")).toBeVisible();

    for (const group of ["المبيعات", "المشتريات", "المحاسبة", "الإعدادات"]) {
      await expect(sidebar.getByRole("button", { name: group, exact: true })).toBeVisible();
    }

    // Sales group is expanded by default — its items are visible without interaction.
    await expect(sidebar.getByText("فواتير المبيعات")).toBeVisible();
    // Settings starts collapsed (sample-data.ts's defaultCollapsed: true).
    await expect(sidebar.getByRole("button", { name: "الإعدادات", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(sidebar.getByText("عام", { exact: true })).toBeHidden();
  });

  test("sidebar footer and topbar both show the signed-in user", async ({ page }) => {
    // The signed-in user's real name + role (from the session), sidebar footer + topbar chip.
    await expect(page.getByText("محمد الشهابي")).toHaveCount(2);
    await expect(page.getByText("مدير الشركة")).toHaveCount(2);
  });

  test("topbar shows the branch scope chip and notification badge", async ({ page }) => {
    const topbar = page.locator("header");
    await expect(topbar.getByText("الفرع الرئيسي")).toBeVisible();
    await expect(topbar.getByRole("button", { name: /الإشعارات/ })).toBeVisible();
  });

  test("Ctrl+K opens the command palette, filters, and Escape closes it", async ({ page }) => {
    await expect(page.getByRole("dialog", { name: "لوحة الأوامر" })).toBeHidden();

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "لوحة الأوامر" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("دليل الحسابات")).toBeVisible();
    await expect(dialog.getByText("فاتورة مبيعات جديدة")).toBeVisible();

    await dialog.getByPlaceholder("اكتب أمراً أو ابحث…").fill("القيود");
    await expect(dialog.getByText("القيود المحاسبية")).toBeVisible();
    await expect(dialog.getByText("فاتورة مبيعات جديدة")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("clicking the topbar search launcher also opens the command palette", async ({ page }) => {
    await page.getByRole("button", { name: /بحث عن صفحة/ }).click();
    await expect(page.getByRole("dialog", { name: "لوحة الأوامر" })).toBeVisible();
  });
});
