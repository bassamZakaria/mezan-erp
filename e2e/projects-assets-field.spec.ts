import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Projects (apps/web/src/screens/ProjectsScreen.tsx), Fixed Assets
 * (AssetCategoriesScreen/AssetRegisterScreen/DepreciationRunsScreen) and
 * Field/Van Trips (VanTripsScreen) — all real API-backed. Projects and Fixed
 * Assets create their own uniquely-named records against the seeded tenant
 * (fine either way — nothing else in the seed touches projects or assets).
 * Van Trips is a fully-seeded workspace (packages/backend/src/demo-seed/
 * treasury.ts's `seedFieldSales`): a van registry entry (مركبة التوزيع
 * الأولى, its own WH-VAN warehouse) and two trips, one settled
 * (TRIP-DEMO-1) and one open (TRIP-DEMO-2) — so its tests read the seed
 * rather than assuming an empty list, and any new trip they open is their
 * own, identified relatively rather than by an assumed total.
 *
 * Each mutating describe runs `serial` so a later test can build on a
 * record an earlier test in the same file created, and so its mutation
 * never races a read-only assertion elsewhere in the same describe
 * (playwright.config.ts runs fullyParallel).
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

/** Clicks a `Select` primitive's combobox trigger, then the matching portaled option — it is not a native `<select>` (packages/ui/src/primitives/Select.tsx). */
async function chooseCombo(scope: Page | Locator, comboLabel: string, optionName: string | RegExp): Promise<void> {
  await scope.getByRole("combobox", { name: comboLabel, exact: true }).click();
  await scope.page().getByRole("option", { name: optionName }).click();
}

test.describe("Projects", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "المقاولات");
    await expect(page.getByRole("heading", { name: "المقاولات" })).toBeVisible();
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

    await chooseCombo(detail, "الحالة", "نشط");
    await detail.getByRole("button", { name: "حفظ" }).click();
    await expect(detail.getByText("نشط", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "إغلاق اللوحة" }).click();
    await expect(row(page, "مشروع تجريبي").getByText("نشط", { exact: true })).toBeVisible();
  });

  test("a duplicate project code is rejected", async ({ page }) => {
    await page.getByRole("button", { name: "مشروع جديد" }).first().click();
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
    await chooseCombo(form, "التصنيف *", "FA-TEST — تصنيف تجريبي");
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

    // .first() — the header's button is always present; an empty-state
    // region renders a second one with the exact same label whenever the
    // list reads zero rows.
    await page.getByRole("button", { name: "تشغيل إهلاك جديد" }).first().click();
    const form = page.getByRole("dialog", { name: "تشغيل إهلاك جديد" });
    await expect(form).toBeVisible();

    await form.getByLabel("السنة *").fill("2026");
    await form.getByLabel("الشهر *").fill("8");
    await form.getByRole("button", { name: "تشغيل", exact: true }).click();
    await expect(form).toBeHidden();

    const runRow = row(page, "2026-08");
    await expect(runRow).toBeVisible();
    await expect(runRow.getByText("مسودة", { exact: true })).toBeVisible();

    // «ترحيل» lives inside the row's «…» actions menu (RowMenu), not as its own button.
    await runRow.getByRole("button", { name: "إجراءات 2026-08" }).click();
    await page.getByRole("menuitem", { name: "ترحيل" }).click();
    await expect(row(page, "2026-08").getByText("مرحل", { exact: true })).toBeVisible();

    await row(page, "2026-08").getByRole("button", { name: "إجراءات 2026-08" }).click();
    await expect(page.getByRole("menuitem", { name: "ترحيل" })).toHaveCount(0);
  });
});


test.describe("Field / Van Trips", () => {
  // The second test opens (mutates) a real trip — keep it from racing the
  // read-only list assertion above (playwright.config.ts runs fullyParallel).
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "رحلات المندوبين");
    await expect(page.getByRole("heading", { name: "رحلات المندوبين" })).toBeVisible();
  });

  test("lists the 2 seeded trips — one settled, one open", async ({ page }) => {
    await expect(page.getByText("عرض 2 من 2 رحلة")).toBeVisible();

    const settled = row(page, "TRIP-DEMO-1");
    await expect(settled).toBeVisible();
    await expect(settled.getByText("مسواة", { exact: true })).toBeVisible();

    const open = row(page, "TRIP-DEMO-2");
    await expect(open).toBeVisible();
    await expect(open.getByText("جارية", { exact: true })).toBeVisible();
  });

  /**
   * Regression guard: openVanTrip used to store `cmd.tripNo ?? null` with no
   * fallback, so a trip opened through the real UI (which never sends a
   * `tripNo`) showed the client's raw `crypto.randomUUID()` as its "رقم
   * الرحلة". Fixed by allocating from the new VAN_TRIP numbering sequence
   * (`TRIP-####`) when the command omits one.
   */
  test("opening a new trip for the seeded van gets a real trip number", async ({ page }) => {
    await page.getByRole("button", { name: "فتح رحلة" }).first().click();
    const form = page.getByRole("dialog", { name: "فتح رحلة" });
    await expect(form).toBeVisible();

    await chooseCombo(form, "الڤان *", /^مركبة التوزيع الأولى/);
    // مستودع المركبة / خزينة الڤان / الفرع are read-only, cascaded from the van.
    await chooseCombo(form, "مستودع التحميل *", "المستودع الرئيسي");
    await chooseCombo(form, "خزينة المصدر *", /الرئيسية/);
    await chooseCombo(form, "اختر موظفاً", /^كريم عادل/);
    await form.getByRole("button", { name: "إضافة" }).first().click();

    await form.getByRole("button", { name: "فتح رحلة", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 3 من 3 رحلة")).toBeVisible();
    // The only OPEN (جارية) trip carrying كريم عادل is the one just opened —
    // TRIP-DEMO-1 (settled) also has him, TRIP-DEMO-2 (open) does not.
    const newRow = page.locator("table tbody tr").filter({ hasText: "جارية" }).filter({ hasText: "كريم عادل" });
    await expect(newRow).toBeVisible();
    // The first cell carries the trip number AND the date on two lines
    // (VanTripsScreen.tsx's tripNo column, `.mz-num.font-semibold` then a
    // second `.mz-num` for the date) — target the number's own line, not the
    // cell's whole text, which would run the two together with no separator.
    await expect(newRow.locator("td").first().locator(".font-semibold")).toHaveText(/^TRIP-\d+$/);
  });
});
