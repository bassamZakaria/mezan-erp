import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * قواعد الإشعارات builder (apps/web/src/settings/NotificationRulesPage.tsx,
 * docs/archive/catalog/09 §قواعد الإشعارات) + the top-bar notifications inbox
 * screen (apps/web/src/screens/NotificationsScreen.tsx — reached via the
 * "صندوق الوارد" icon beside the wordmark, not a bell dropdown; see
 * app-shell.spec.ts). Real backend, real SQLite — the demo tenant is the
 * fully seeded demo company (packages/backend/src/demo-seed/platform.ts),
 * not an empty one: it already carries 4 notification rules (3 active, 1
 * disabled) and 3 real, engine-generated notifications (2 unread) from
 * seeded sales/purchase returns — so these tests read that seed instead of
 * assuming an empty list.
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
  // Both tests create a rule against the SAME shared list and the first
  // asserts an exact total — serial keeps them from racing each other
  // (playwright.config.ts runs fullyParallel).
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "قواعد الإشعارات");
    await expect(page.getByRole("heading", { name: "قواعد الإشعارات" })).toBeVisible();
  });

  test("lists the 4 seeded rules and creates a real rule over the event catalog", async ({ page }) => {
    await expect(page.getByText("عرض 4 من 4 قاعدة")).toBeVisible();
    const seededRow = page.locator("tr", { hasText: "تنبيه تأكيد فاتورة مبيعات" });
    await expect(seededRow).toBeVisible();
    await expect(seededRow.getByText("نشط", { exact: true })).toBeVisible();
    const disabledRow = page.locator("tr", { hasText: "تنبيه إلغاء مرتجع مشتريات" });
    await expect(disabledRow.getByText("غير نشط", { exact: true })).toBeVisible();

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
    await expect(page.getByText("عرض 5 من 5 قاعدة")).toBeVisible();
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
  test("opens from صندوق الوارد and shows the real, engine-generated notifications", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.getByRole("button", { name: "صندوق الوارد", exact: true }).click();
    await expect(page.getByRole("heading", { name: "الإشعارات" })).toBeVisible();

    // At least 3 real notifications from the seeded sales/purchase returns
    // (packages/backend/src/demo-seed/platform.ts) — not asserting an exact
    // total, since other e2e spec files sharing this backend also confirm
    // sales/purchase returns and genuinely add more notifications.
    await expect
      .poll(async () => {
        const text = await page.locator("main").innerText();
        return Number(text.match(/عرض\s*\d+\s*من\s*(\d+)\s*إشعار/)?.[1] ?? 0);
      })
      .toBeGreaterThanOrEqual(3);
    const salesReturnRow = page.locator("tr", { hasText: "تم تسجيل مرتجع مبيعات" }).first();
    await expect(salesReturnRow).toBeVisible();
    await expect(salesReturnRow.getByText(/تم تأكيد مرتجع مبيعات على المستند SRT-\d+/)).toBeVisible();
    const purchaseReturnRow = page.locator("tr", { hasText: "تم تسجيل مرتجع مشتريات" });
    await expect(purchaseReturnRow).toBeVisible();

    await page.getByRole("button", { name: "تحديد الكل كمقروء" }).click();
    await expect(page.getByText("غير مقروء", { exact: true }).first().locator("xpath=..")).toContainText("0");
  });
});
