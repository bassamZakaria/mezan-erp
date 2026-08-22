import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * Settings foundation (apps/web/src/settings/*): tenant general/company/tax/
 * policies tabs, Branches list + Branch-360 overview, Warehouses list with
 * all 5 catalog warehouse types.
 */

test.describe("Settings — general", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "عام");
    await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible();
  });

  test("switches between general / company / tax / policies tabs", async ({ page }) => {
    const tablist = page.getByRole("tablist");
    await expect(tablist.getByRole("tab", { name: "عام" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("العملة واللغة")).toBeVisible();

    await tablist.getByRole("tab", { name: "بيانات المنشأة" }).click();
    await expect(page.getByLabel("اسم المنشأة")).toHaveValue("Cyag — شركة سياج للصناعات");

    await tablist.getByRole("tab", { name: "الضريبة" }).click();
    await expect(page.getByRole("switch", { name: "تفعيل ضريبة القيمة المضافة" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByLabel("نسبة الضريبة الافتراضية (%)")).toHaveValue("14");

    await tablist.getByRole("tab", { name: "السياسات" }).click();
    await expect(page.getByRole("switch", { name: "تفعيل الرقابة الائتمانية" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("editing a field marks the settings dirty and saving clears it", async ({ page }) => {
    const saveButton = page.getByRole("button", { name: "حفظ الإعدادات" });
    await expect(saveButton).toBeDisabled();

    await page.getByRole("tablist").getByRole("tab", { name: "السياسات" }).click();
    await page.getByRole("switch", { name: "تفعيل الرقابة الائتمانية" }).click();

    await expect(page.getByText("تغييرات غير محفوظة")).toBeVisible();
    await expect(saveButton).toBeEnabled();

    await saveButton.click();
    await expect(page.getByText("تغييرات غير محفوظة")).toBeHidden();
    await expect(saveButton).toBeDisabled();
  });
});

test.describe("Settings — branches", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "الفروع");
    await expect(page.getByRole("heading", { name: "الفروع", exact: true })).toBeVisible();
  });

  test("lists both demo branches", async ({ page }) => {
    await expect(page.getByText("عرض 2 من 2 فرع")).toBeVisible();
    // Scope to the "اسم الفرع" (name) column — "الفرع الرئيسي" also appears
    // as the parent-branch value in ALEX's row, so an unscoped text query
    // would match twice.
    await expect(page.locator("table tbody tr td:first-child")).toHaveText([
      "الفرع الرئيسي",
      "فرع الإسكندرية",
    ]);
  });

  test("opens Branch-360 overview for a branch and returns to the list", async ({ page }) => {
    await page.getByText("فرع الإسكندرية", { exact: true }).click();

    await expect(page.getByRole("heading", { name: "فرع الإسكندرية · ALEX" })).toBeVisible();
    await expect(page.getByText("إيرادات الشهر")).toBeVisible();
    await expect(page.getByText("حسابات الخزينة")).toBeVisible();

    // Out-of-scope Branch 360 tabs render as an explicit stub, not a crash.
    await page.getByRole("tab", { name: "المخزون" }).click();
    await expect(page.getByText('جزء من Branch 360 الكامل')).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة الفروع" }).click();
    await expect(page.getByRole("heading", { name: "الفروع", exact: true })).toBeVisible();
    await expect(page.locator("table tbody tr td:first-child")).toHaveText([
      "الفرع الرئيسي",
      "فرع الإسكندرية",
    ]);
  });
});

test.describe("Settings — warehouses", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "المستودعات");
    await expect(page.getByRole("heading", { name: "المستودعات" })).toBeVisible();
  });

  test("shows all 5 catalog warehouse types as filter chips", async ({ page }) => {
    for (const label of ["رئيسي", "مستودع وسيط", "مرتجعات", "إنتاج", "ڤان (سيارة توزيع)"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByText("عرض 6 من 6 مستودع")).toBeVisible();
  });

  test("filtering by a warehouse type narrows the list", async ({ page }) => {
    await page.getByRole("button", { name: "ڤان (سيارة توزيع)", exact: true }).click();
    await expect(page.locator("table tbody tr td:first-child")).toHaveText(["سياره نقل ١"]);

    await page.getByRole("button", { name: "كل الأنواع" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(6);
  });
});
