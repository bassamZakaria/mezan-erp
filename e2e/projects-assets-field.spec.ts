import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Projects (apps/web/src/screens/ProjectsScreen.tsx), Fixed Assets
 * (AssetCategoriesScreen/AssetRegisterScreen/DepreciationRunsScreen) and
 * Field/Van Trips (VanTripsScreen) — all real API-backed against the fresh
 * seeded tenant (zero rows to start). Each describe runs `serial` so a
 * later test can build on a record an earlier test in the same file
 * created (the real backend persists it for the rest of this run).
 *
 * Van Trips' "فتح رحلة" (open trip) form requires the الڤان and مخزن
 * التحميل selects to resolve to two DIFFERENT warehouses — but the only
 * warehouse the seeded tenant has is the one main warehouse (WH-MAIN), and
 * there is no `useCreateWarehouse` hook anywhere in the app (Settings ›
 * المستودعات — apps/web/src/settings/WarehousesPage.tsx — is still
 * client-side-only sample data, never persisted to the real backend
 * VanTripsScreen reads from). So opening a trip is currently a genuine dead
 * end through the UI; this suite documents that instead of faking a
 * work-around.
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

test.describe("Projects", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "المشاريع والمقاولات");
    await expect(page.getByRole("heading", { name: "المشاريع والمقاولات" })).toBeVisible();
  });

  test("creating a project validates code then name, then succeeds; status can then be changed from its detail", async ({ page }) => {
    await page.getByRole("button", { name: "مشروع جديد" }).click();
    const form = page.getByRole("dialog", { name: "مشروع جديد" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("كود المشروع مطلوب");

    await form.getByLabel("كود المشروع *").fill("PRJ-TEST");
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("اسم المشروع مطلوب");

    await form.getByLabel("اسم المشروع *").fill("مشروع تجريبي");
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form).toBeHidden();

    const projectRow = row(page, "مشروع تجريبي");
    await expect(projectRow).toBeVisible();
    await expect(projectRow.getByText("PRJ-TEST")).toBeVisible();
    await expect(projectRow.getByText("مخطط", { exact: true })).toBeVisible();

    await projectRow.click();
    const detail = page.getByRole("dialog", { name: "مشروع — مشروع تجريبي" });
    await expect(detail).toBeVisible();
    await expect(detail.getByText("بدون عميل")).toBeVisible();
    await expect(detail.getByText("بدون مدير")).toBeVisible();

    await detail.getByLabel("الحالة").selectOption({ label: "نشط" });
    await detail.getByRole("button", { name: "حفظ" }).click();
    await expect(detail.getByText("نشط", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "إغلاق اللوحة" }).click();
    await expect(row(page, "مشروع تجريبي").getByText("نشط", { exact: true })).toBeVisible();
  });

  test("a duplicate project code is rejected", async ({ page }) => {
    await page.getByRole("button", { name: "مشروع جديد" }).click();
    const form = page.getByRole("dialog", { name: "مشروع جديد" });
    await form.getByLabel("كود المشروع *").fill("PRJ-TEST");
    await form.getByLabel("اسم المشروع *").fill("مشروع مكرر");
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("مستخدم بالفعل");
    await expect(form).toBeVisible();
  });
});

test.describe("Fixed Assets", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("asset categories: validates a duplicate code, then succeeds", async ({ page }) => {
    await clickSidebarItem(page, "تصنيفات الأصول");
    await expect(page.getByRole("heading", { name: "تصنيفات الأصول" })).toBeVisible();

    await page.getByRole("button", { name: "إضافة تصنيف" }).click();
    const form = page.getByRole("dialog", { name: "إضافة تصنيف" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("كود التصنيف مطلوب");

    await form.getByLabel("كود التصنيف *").fill("FA-TEST");
    await form.getByLabel("اسم التصنيف *").fill("تصنيف تجريبي");
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(row(page, "تصنيف تجريبي")).toBeVisible();
    await expect(row(page, "FA-TEST")).toBeVisible();

    await page.getByRole("button", { name: "إضافة تصنيف" }).click();
    const form2 = page.getByRole("dialog", { name: "إضافة تصنيف" });
    await form2.getByLabel("كود التصنيف *").fill("FA-TEST");
    await form2.getByLabel("اسم التصنيف *").fill("نسخة");
    await form2.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form2.getByRole("alert")).toContainText("مستخدم بالفعل");
  });

  test("asset register: registering an asset against the new category shows its book value", async ({ page }) => {
    await clickSidebarItem(page, "سجل الأصول");
    await expect(page.getByRole("heading", { name: "سجل الأصول" })).toBeVisible();

    await page.getByRole("button", { name: "تسجيل أصل" }).click();
    const form = page.getByRole("dialog", { name: "تسجيل أصل" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("كود الأصل مطلوب"); // validateDraft checks code before name

    await form.getByLabel("كود الأصل *").fill("AST-TEST");
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("الاسم بالعربية مطلوب");

    await form.getByLabel("الاسم بالعربية *").fill("أصل تجريبي");
    await form.getByLabel("التصنيف *").selectOption({ label: "FA-TEST — تصنيف تجريبي" });
    await form.getByLabel("تاريخ الاقتناء *").fill("2026-01-01");
    // Two MoneyInputs share the "0.00" placeholder (تكلفة الاقتناء * comes first, القيمة المتبقية second).
    await form.getByPlaceholder("0.00").first().fill("6000");

    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form).toBeHidden();

    const assetRow = row(page, "أصل تجريبي");
    await expect(assetRow).toBeVisible();
    await expect(assetRow.getByText("FA-TEST — تصنيف تجريبي")).toBeVisible();
    // .first() — cost and book value are both 6,000.00 (zero depreciation yet).
    await expect(assetRow.getByText("6,000.00").first()).toBeVisible();

    await assetRow.click();
    const detail = page.getByRole("dialog", { name: "أصل — أصل تجريبي" });
    await expect(detail.getByText("AST-TEST")).toBeVisible();
    await expect(detail.getByText("القسط الثابت")).toBeVisible();
  });

  test("depreciation runs: running August 2026 against the eligible asset, then posting it", async ({ page }) => {
    await clickSidebarItem(page, "الإهلاك");
    await expect(page.getByRole("heading", { name: "الإهلاك" })).toBeVisible();

    await page.getByRole("button", { name: "تشغيل إهلاك جديد" }).click();
    const form = page.getByRole("dialog", { name: "تشغيل إهلاك جديد" });
    await expect(form).toBeVisible();

    await form.getByLabel("السنة *").fill("2026");
    await form.getByLabel("الشهر *").fill("8");
    await form.getByRole("button", { name: "تشغيل", exact: true }).click();
    await expect(form).toBeHidden();

    const runRow = row(page, "2026-08");
    await expect(runRow).toBeVisible();
    await expect(runRow.getByText("مسودة", { exact: true })).toBeVisible();

    await runRow.getByRole("button", { name: "ترحيل" }).click();
    await expect(row(page, "2026-08").getByText("مرحل", { exact: true })).toBeVisible();
    await expect(row(page, "2026-08").getByRole("button", { name: "ترحيل" })).toHaveCount(0);
  });
});

test.describe("Field / Van Trips", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "رحلات المندوبين");
    await expect(page.getByRole("heading", { name: "رحلات المندوبين" })).toBeVisible();
  });

  test("the trip list starts empty", async ({ page }) => {
    await expect(page.getByText("عرض 0 من 0 رحلة")).toBeVisible();
    await expect(page.getByText("لا توجد رحلات مطابقة")).toBeVisible();
  });

  test("opening a trip is blocked: only one real warehouse exists, so الڤان and مخزن التحميل always collide", async ({ page }) => {
    await page.getByRole("button", { name: "فتح رحلة" }).click();
    const form = page.getByRole("dialog", { name: "فتح رحلة" });
    await expect(form).toBeVisible();

    // The seeded tenant has exactly one real warehouse (المستودع الرئيسي, type
    // MAIN) — no van-type warehouse, and no way anywhere in the app to create
    // a second real one — so both selects resolve to it as their only choice.
    await expect(
      form.getByLabel(/^الڤان \*/).locator("option").filter({ hasText: "المستودع الرئيسي" }),
    ).toHaveCount(1);
    await expect(
      form.getByLabel("مخزن التحميل *").locator("option").filter({ hasText: "المستودع الرئيسي" }),
    ).toHaveCount(1);

    await form.getByLabel(/^الڤان \*/).selectOption({ label: "المستودع الرئيسي" });
    await form.getByLabel("مخزن التحميل *").selectOption({ label: "المستودع الرئيسي" });
    await form.getByRole("button", { name: "فتح رحلة", exact: true }).click();

    await expect(form.getByRole("alert")).toContainText("لا يمكن أن يكون مخزن التحميل هو نفس الڤان");
    await expect(form).toBeVisible(); // stays open — the trip was never opened
  });
});
