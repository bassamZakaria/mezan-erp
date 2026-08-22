import { test, expect, type Page } from "@playwright/test";
import { clickSidebarItem } from "./support/nav";

/**
 * Chart of Accounts screen (apps/web/src/screens/ChartOfAccountsScreen.tsx).
 * 23 demo accounts (apps/web/src/accounts-sample-data.ts); every header
 * account starts expanded, so the tree renders fully open on first load.
 */

function treeRow(page: Page, nameAr: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(nameAr, { exact: true }) });
}

test.describe("Chart of Accounts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clickSidebarItem(page, "دليل الحسابات");
    await expect(page.getByRole("heading", { name: "دليل الحسابات" })).toBeVisible();
  });

  test("tree starts fully expanded, then collapses and re-expands one branch", async ({ page }) => {
    await expect(page.getByText("عرض 23 من 23 حساب")).toBeVisible();
    await expect(treeRow(page, "ذمم مدينة")).toBeVisible();

    await page.getByRole("button", { name: "طي الكل" }).click();
    await expect(page.getByText("عرض 5 من 23 حساب")).toBeVisible();
    await expect(treeRow(page, "ذمم مدينة")).toBeHidden();
    await expect(treeRow(page, "الأصول")).toBeVisible();

    // Expand only the "الأصول" (Assets) branch — its direct children show,
    // but its grandchildren (under the still-collapsed "ذمم مدينة" header)
    // stay hidden.
    await treeRow(page, "الأصول").getByRole("button", { name: "توسيع" }).click();
    await expect(treeRow(page, "ذمم مدينة")).toBeVisible();
    await expect(treeRow(page, "ذمم أقساط مدينة")).toBeHidden();
  });

  test("clicking a leaf account opens its detail panel with balances and tabs", async ({ page }) => {
    await treeRow(page, "صندوق نقدي الفرع الرئيسي").click();

    const panel = page.getByRole("dialog", { name: /1300-1/ });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("238.00")).toBeVisible(); // رصيد أول المدة
    await expect(panel.getByText("100.00")).toBeVisible(); // حركة الفترة
    await expect(panel.getByText("338.00")).toBeVisible(); // رصيد نهاية المدة

    await expect(panel.getByRole("tab", { name: "حركات الحساب" })).toHaveAttribute("aria-selected", "true");
    await panel.getByRole("tab", { name: "سجل التدقيق" }).click();
    await expect(panel.getByRole("tab", { name: "سجل التدقيق" })).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByText("سجل التدقيق يعرض كل تعديل")).toBeVisible();

    await panel.getByRole("button", { name: "إغلاق اللوحة" }).click();
    await expect(panel).toBeHidden();
  });

  test("adding an account validates a duplicate code, then succeeds with a unique one", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة حساب" }).click();
    const form = page.getByRole("dialog", { name: "إضافة حساب" });
    await expect(form).toBeVisible();

    await form.getByLabel("الكود *").fill("1000"); // already used by "الأصول"
    await form.getByLabel("الاسم *").fill("حساب مكرر");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("مستخدم بالفعل");
    await expect(form).toBeVisible(); // stays open on validation error

    await form.getByLabel("الكود *").fill("1999");
    await form.getByLabel("الاسم *").fill("حساب اختبار جديد");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();

    await expect(form).toBeHidden();
    await expect(treeRow(page, "حساب اختبار جديد")).toBeVisible();
    await expect(page.getByText("عرض 24 من 24 حساب")).toBeVisible();
  });

  test("editing an account via the row action updates its name in the tree", async ({ page }) => {
    await page.getByRole("button", { name: "تعديل معدات" }).click();
    const form = page.getByRole("dialog", { name: "تعديل حساب" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("الكود *")).toBeDisabled();
    await expect(form.getByLabel("الكود *")).toHaveValue("1510");

    await form.getByLabel("الاسم *").fill("معدات مكتبية");
    await form.getByRole("button", { name: "حفظ", exact: true }).click();

    await expect(form).toBeHidden();
    await expect(treeRow(page, "معدات مكتبية")).toBeVisible();
    await expect(treeRow(page, "معدات")).toBeHidden();
  });
});
