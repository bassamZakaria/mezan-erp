import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * قواعد الإشعارات builder (apps/web/src/settings/NotificationRulesPage.tsx,
 * docs/archive/catalog/09 §قواعد الإشعارات) + the top-bar notifications inbox
 * screen (apps/web/src/screens/NotificationsScreen.tsx — reached via the
 * "صندوق الوارد" icon beside the wordmark, not a bell dropdown; see
 * app-shell.spec.ts). Real backend, real SQLite — the demo tenant starts
 * with zero configured rules and zero notifications.
 *
 * الحدث/نوع المستلم/قيمة المستلم/الأولوية are the portaled `Select`
 * combobox (packages/ui/src/primitives/Select.tsx), chosen via click +
 * `role="option"`, not `.selectOption()`. "اسم القاعدة *" goes through the
 * broken `../settings/form-controls` TextField (see
 * e2e/support/broken-label.ts).
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function chooseCombo(scope: Page, comboLabel: string, optionName: string | RegExp): Promise<void> {
  await scope.getByRole("combobox", { name: comboLabel }).click();
  await scope.getByRole("option", { name: optionName }).click();
}

test.describe("Notification rules builder", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "قواعد الإشعارات");
    await expect(page.getByRole("heading", { name: "قواعد الإشعارات" })).toBeVisible();
  });

  test("starts empty and creates a real rule over the event catalog", async ({ page }) => {
    await expect(page.getByText("لا توجد قواعد إشعارات")).toBeVisible();

    const name = unique("فاتورة مبيعات مؤكدة");
    await page.getByRole("button", { name: "إضافة قاعدة" }).click();
    const dialog = page.getByRole("dialog", { name: "إضافة قاعدة" });
    await brokenLabelField(dialog, "اسم القاعدة *").fill(name);
    await chooseCombo(page, "الحدث *", /تم تأكيد فاتورة مبيعات/);
    // "نوع المستلم *" already defaults to "حسب الصلاحية" (permission).
    await chooseCombo(page, "قيمة المستلم *", /sales\.invoice\.view$/);
    await chooseCombo(page, "الأولوية *", "عالية");
    await brokenLabelField(dialog, "نص الإشعار (عربي)").fill(
      "تم إنشاء الفاتورة {{documentNumber}} بقيمة {{amount}} للعميل {{customerName}}.",
    );
    await dialog.getByRole("button", { name: "إضافة", exact: true }).click();

    await expect(dialog).toBeHidden();
    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText("تم تأكيد فاتورة مبيعات", { exact: true })).toBeVisible();
  });

  test("toggles a rule inactive then deletes it", async ({ page }) => {
    const name = unique("قاعدة للحذف");
    await page.getByRole("button", { name: "إضافة قاعدة" }).click();
    const dialog = page.getByRole("dialog", { name: "إضافة قاعدة" });
    await brokenLabelField(dialog, "اسم القاعدة *").fill(name);
    await chooseCombo(page, "قيمة المستلم *", /sales\.invoice\.view$/);
    await dialog.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator("tr", { hasText: name });
    await row.getByText("نشط", { exact: true }).click();
    await expect(row.getByText("غير نشط", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "حذف" }).click();
    const confirmDialog = page.getByRole("dialog", { name: "حذف قاعدة التنبيه؟" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "حذف" }).click();

    await expect(page.locator("tr", { hasText: name })).toHaveCount(0);
  });
});

test.describe("Notifications inbox", () => {
  test("opens from صندوق الوارد and shows the real (empty) notification list", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.getByRole("button", { name: "صندوق الوارد", exact: true }).click();
    await expect(page.getByRole("heading", { name: "الإشعارات" })).toBeVisible();
    await expect(page.getByText(/لا توجد إشعارات|لا يوجد إشعارات/)).toBeVisible();
  });
});
