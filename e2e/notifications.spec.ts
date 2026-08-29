import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * قواعد الإشعارات builder (apps/web/src/settings/NotificationRulesPage.tsx,
 * docs/archive/catalog/09 §قواعد الإشعارات) + the top-bar notifications bell
 * (packages/ui/src/shell/NotificationsPanel.tsx). Real backend, real SQLite —
 * the demo tenant starts with zero configured rules and zero notifications.
 */

test.describe("Notification rules builder", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "قواعد الإشعارات");
    await expect(page.getByRole("heading", { name: "قواعد الإشعارات" })).toBeVisible();
  });

  test("starts empty and creates a real rule over the 39-event catalog", async ({ page }) => {
    await expect(page.getByText("لا توجد قواعد إشعارات")).toBeVisible();

    await page.getByRole("button", { name: "إضافة قاعدة" }).click();
    const dialog = page.getByRole("dialog", { name: "إضافة قاعدة" });
    await dialog.getByLabel("اسم القاعدة *").fill("فاتورة مبيعات مؤكدة");
    await dialog.getByLabel("الحدث *").selectOption("SALES_INVOICE_CONFIRMED");
    await dialog.getByLabel("نوع المستلم *").selectOption("permission");
    await dialog.getByLabel("قيمة المستلم *").selectOption("sales.invoice.view");
    await dialog.getByLabel("الأولوية *").selectOption("high");
    await dialog
      .getByLabel("نص الإشعار (عربي)")
      .fill("تم إنشاء الفاتورة {{documentNumber}} بقيمة {{amount}} للعميل {{customerName}}.");
    await dialog.getByRole("button", { name: "إضافة" }).click();

    await expect(dialog).not.toBeVisible();
    const row = page.locator("tr", { hasText: "فاتورة مبيعات مؤكدة" });
    await expect(row).toBeVisible();
    await expect(row.getByText("تم تأكيد فاتورة مبيعات", { exact: true })).toBeVisible();
  });

  test("toggles a rule inactive then deletes it", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة قاعدة" }).click();
    const dialog = page.getByRole("dialog", { name: "إضافة قاعدة" });
    await dialog.getByLabel("اسم القاعدة *").fill("قاعدة للحذف");
    await dialog.getByLabel("قيمة المستلم *").selectOption("sales.invoice.view");
    await dialog.getByRole("button", { name: "إضافة" }).click();
    await expect(dialog).not.toBeVisible();

    const row = page.locator("tr", { hasText: "قاعدة للحذف" });
    await row.getByText("نشط").click();
    await expect(row.getByText("غير نشط")).toBeVisible();

    await row.getByRole("button", { name: "حذف" }).click();
    await expect(page.getByText("قاعدة للحذف")).not.toBeVisible();
  });
});

test.describe("Top-bar notifications panel", () => {
  test("opens from the bell and shows the real (empty) notification list", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.getByRole("button", { name: /الإشعارات/ }).click();
    await expect(page.getByRole("dialog", { name: "الإشعارات" })).toBeVisible();
    await expect(page.getByText("لا توجد إشعارات")).toBeVisible();
  });
});
