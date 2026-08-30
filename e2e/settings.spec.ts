import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * Settings foundation (apps/web/src/settings/*): tenant company/regional/tax/
 * policies tabs, Branches list + Branch-360 overview, Warehouses list.
 *
 * The tabs were reduced from eight to five and reordered/renamed —
 * بيانات المنشأة (company identity, now the DEFAULT tab) / الإقليمية والعملة
 * (regional & currency) / الضريبة / السياسات / a hidden البريد الإلكتروني.
 * There is no more plain "عام" tab.
 *
 * The e2e backend now starts with exactly ONE seeded branch (الفرع الرئيسي)
 * and TWO warehouses (WH-MAIN "رئيسي", WH-WIP "إنتاج") — no more Alexandria
 * branch or a pre-seeded van warehouse — so the branch-360 and
 * warehouse-type-filter tests create their own extra branch/warehouse first.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

test.describe("Settings — general", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "عام");
    await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible();
  });

  test("switches between company / regional / tax / policies tabs", async ({ page }) => {
    const tablist = page.getByRole("tablist");
    await expect(tablist.getByRole("tab", { name: "بيانات المنشأة" })).toHaveAttribute("aria-selected", "true");
    // "اسم المنشأة" is built through the broken `../settings/form-controls`
    // TextField (see e2e/support/broken-label.ts).
    await expect(brokenLabelField(page, "اسم المنشأة")).toHaveValue(/.+/);

    await tablist.getByRole("tab", { name: "الإقليمية والعملة" }).click();
    await expect(page.getByText("العملة", { exact: true })).toBeVisible();

    await tablist.getByRole("tab", { name: "الضريبة" }).click();
    await expect(page.getByRole("switch", { name: "تفعيل ضريبة القيمة المضافة" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(brokenLabelField(page, "نسبة الضريبة الافتراضية (%)")).toHaveValue("14");

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

  test("lists the seeded main branch", async ({ page }) => {
    await expect(page.getByText("عرض 1 من 1 فرع")).toBeVisible();
    await expect(page.locator("table tbody tr td:first-child")).toHaveText(["الفرع الرئيسي"]);
  });

  test("adding a branch appears in the list and opens its Branch-360 overview", async ({ page }) => {
    const name = unique("فرع اختبار");
    await page.getByRole("button", { name: "إضافة فرع" }).first().click();
    const form = page.getByRole("dialog", { name: "إضافة فرع" });
    await brokenLabelField(form, "اسم الفرع").fill(name);
    await brokenLabelField(form, "رمز الفرع").fill("TST");
    await form.getByRole("button", { name: "حفظ الفرع" }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 2 من 2 فرع")).toBeVisible();
    await page.getByText(name, { exact: true }).click();

    await expect(page.getByRole("heading", { name: new RegExp(`^${name} · TST$`) })).toBeVisible();
    await expect(page.getByText("مبيعات الفرع (فواتير سارية)")).toBeVisible();
    // المخزون is a real (implemented) tab now, not a stub — a fresh branch
    // with no linked warehouse gets its own honest empty state.
    await page.getByRole("tab", { name: "المخزون" }).click();
    await expect(page.getByText("لا توجد مستودعات مرتبطة بهذا الفرع")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة الفروع" }).click();
    await expect(page.getByRole("heading", { name: "الفروع", exact: true })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });
});

test.describe("Settings — warehouses", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "المستودعات");
    await expect(page.getByRole("heading", { name: "المستودعات" })).toBeVisible();
  });

  test("lists the seeded main and WIP warehouses, and shows all 5 catalog types as filter chips", async ({ page }) => {
    await expect(page.getByText("عرض 2 من 2 مستودع")).toBeVisible();
    // The type filter is a radiogroup, not plain buttons.
    for (const label of ["كل الأنواع", "رئيسي", "مستودع وسيط", "مرتجعات", "إنتاج", "ڤان (سيارة توزيع)"]) {
      await expect(page.getByRole("radio", { name: label, exact: true })).toBeVisible();
    }
  });

  test("adding a van warehouse appears in the list, and the ڤان type filter narrows to it", async ({ page }) => {
    const name = unique("سيارة اختبار");
    await page.getByRole("button", { name: "إضافة مستودع" }).first().click();
    const form = page.getByRole("dialog", { name: "إضافة مستودع" });
    await brokenLabelField(form, "اسم المستودع").fill(name);
    await brokenLabelField(form, "رمز المستودع").fill(`WH-${Date.now() % 100000}`);
    await form.getByRole("combobox", { name: "نوع المستودع" }).click();
    await page.getByRole("option", { name: "ڤان (سيارة توزيع)" }).click();
    await form.getByRole("button", { name: "حفظ المستودع" }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 3 من 3 مستودع")).toBeVisible();

    await page.getByRole("radio", { name: "ڤان (سيارة توزيع)", exact: true }).click();
    await expect(page.locator("table tbody tr td:first-child")).toHaveText([name]);

    await page.getByRole("radio", { name: "كل الأنواع" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(3);
  });
});
