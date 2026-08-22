import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Accounting master-data screens, covered together in one spec:
 *  - Taxes (apps/web/src/screens/TaxesScreen.tsx) — 2 demo tax rates
 *    (accounting-treasury-sample-data.ts): VAT14 (active, default, GL
 *    2200/1400, ETA V009) and WHT1 (inactive, no GL/ETA overrides). The
 *    add/edit form has two mapping sections: "حسابات الترحيل" (GL posting
 *    accounts) and "تصنيف الفاتورة الإلكترونية (ETA)" (VAT sub-type).
 *  - Cost centers (CostCentersScreen.tsx) — 4 demo cost centers: CC-001
 *    "الإدارة العامة" (root) with children CC-002 "المبيعات" and CC-003
 *    "التسويق", plus standalone CC-004 "فرع الإسكندرية". Tree starts fully
 *    expanded.
 *  - Treasury accounts (TreasuryAccountsScreen.tsx) — 3 demo accounts. This
 *    screen has NO edit action anywhere (no "تعديل" button in the row or the
 *    detail panel) — only list/filter/add/detail-view are exercised here.
 *  - Fiscal periods (FiscalPeriodsScreen.tsx) — 12 monthly periods for 2026:
 *    Jan-Mar "locked" (مقفلة), Apr-Jul "closed" (مغلقة), Aug-Dec "open"
 *    (مفتوحة). Lifecycle is open -> closed -> locked (terminal): only "open"
 *    shows "إغلاق"; only "closed" shows "إعادة فتح" and "قفل"; "locked" shows
 *    no action buttons.
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

test.describe("Taxes", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الضرائب");
    await expect(page.getByRole("heading", { name: "الضرائب" })).toBeVisible();
  });

  test("lists demo taxes with rate, type and the default badge on VAT14", async ({ page }) => {
    await expect(page.getByText("عرض 2 من 2 ضريبة")).toBeVisible();
    const vatRow = row(page, "ضريبة القيمة المضافة 14%", false);
    await expect(vatRow).toBeVisible();
    await expect(vatRow.getByText("الافتراضي")).toBeVisible();
    await expect(vatRow.getByText("14.00%")).toBeVisible();
    await expect(vatRow.getByText("غير شاملة (تضاف على السعر)")).toBeVisible();

    const whtRow = row(page, "ضريبة خصم وإضافة 1%");
    await expect(whtRow).toBeVisible();
    await expect(whtRow.getByText("غير نشط")).toBeVisible();
  });

  test("editing VAT14 shows its prefilled GL account mapping and ETA sub-type", async ({ page }) => {
    await row(page, "ضريبة القيمة المضافة 14%", false).getByRole("button", { name: "تعديل" }).click();
    const form = page.getByRole("dialog", { name: "تعديل ضريبة" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("رمز الضريبة *")).toBeDisabled();
    await expect(form.getByLabel("رمز الضريبة *")).toHaveValue("VAT14");

    await expect(form.getByRole("heading", { name: "حسابات الترحيل" })).toBeVisible();
    await expect(form.getByLabel("حساب الضريبة المستحقة (المبيعات)")).toHaveValue("2200");
    await expect(form.getByLabel("حساب ضريبة المدخلات (المشتريات)")).toHaveValue("1400");

    await expect(form.getByRole("heading", { name: "تصنيف الفاتورة الإلكترونية (ETA)" })).toBeVisible();
    await expect(form.getByLabel("النوع الفرعي لضريبة القيمة المضافة")).toHaveValue("V009");
  });

  test("adding a tax validates a duplicate code, then succeeds with GL and ETA mapping filled", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة ضريبة" }).click();
    const form = page.getByRole("dialog", { name: "إضافة ضريبة" });
    await expect(form).toBeVisible();

    await form.getByLabel("اسم الضريبة *").fill("ضريبة اختبار");
    await form.getByLabel("رمز الضريبة *").fill("VAT14"); // already used
    await form.getByLabel("نسبة الضريبة (%) *").fill("10");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("مستخدم بالفعل");
    await expect(form).toBeVisible(); // stays open on validation error

    await form.getByLabel("رمز الضريبة *").fill("VAT-TEST");
    await form.getByLabel("حساب الضريبة المستحقة (المبيعات)").fill("2201");
    await form.getByLabel("حساب ضريبة المدخلات (المشتريات)").fill("1401");
    await form.getByLabel("النوع الفرعي لضريبة القيمة المضافة").selectOption("V001");

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 3 من 3 ضريبة")).toBeVisible();
    await expect(row(page, "ضريبة اختبار")).toBeVisible();
  });

  test("status filter narrows to the inactive tax", async ({ page }) => {
    await page.getByRole("combobox").selectOption("inactive");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "ضريبة خصم وإضافة 1%")).toBeVisible();

    await page.getByRole("combobox").selectOption("all");
    await expect(page.locator("table tbody tr")).toHaveCount(2);
  });
});

test.describe("Cost centers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مراكز التكلفة");
    await expect(page.getByRole("heading", { name: "مراكز التكلفة" })).toBeVisible();
  });

  test("tree starts fully expanded showing the parent/child hierarchy", async ({ page }) => {
    await expect(page.getByText("عرض 4 من 4 مركز تكلفة")).toBeVisible();
    await expect(row(page, "الإدارة العامة")).toBeVisible();
    await expect(row(page, "المبيعات")).toBeVisible();
    await expect(row(page, "التسويق")).toBeVisible();
    await expect(row(page, "فرع الإسكندرية")).toBeVisible();
  });

  test("adding a cost center validates a duplicate code, then succeeds under a chosen parent", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة مركز تكلفة" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مركز تكلفة" });
    await expect(form).toBeVisible();

    await form.getByLabel("الكود *").fill("CC-001"); // already used
    await form.getByLabel("الاسم *").fill("نسخة");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("مستخدم بالفعل");
    await expect(form).toBeVisible();

    await form.getByLabel("الكود *").fill("CC-099");
    await form.getByLabel("الاسم *").fill("مركز تجريبي");

    // EntityPicker has no accessible label (no id/htmlFor wiring), and its
    // dynamic placeholder (the currently-selected option's label) changes
    // once a selection is made — so target the one real <input
    // role="combobox"> in the form instead (the "النوع"/"الحالة" fields are
    // plain <select>s, which also report role=combobox but aren't <input>s).
    const parentPicker = form.locator('input[role="combobox"]');
    await parentPicker.fill("الإدارة");
    await form.getByRole("option", { name: /الإدارة العامة/ }).click();

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 5 من 5 مركز تكلفة")).toBeVisible();
    await expect(row(page, "مركز تجريبي")).toBeVisible();
  });

  test("editing rejects a circular parent, then succeeds after fixing it", async ({ page }) => {
    await page.getByRole("button", { name: "تعديل الإدارة العامة" }).click();
    const form = page.getByRole("dialog", { name: "تعديل مركز تكلفة" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("الكود *")).toBeDisabled();
    await expect(form.getByLabel("الكود *")).toHaveValue("CC-001");

    // "الإدارة العامة" is the parent of "المبيعات" — picking its own child as
    // its new parent must be rejected as a circular reference. See the note
    // above: target the <input role="combobox"> directly rather than its
    // (value-dependent) placeholder, since we reselect it below too.
    const parentPicker = form.locator('input[role="combobox"]');
    await parentPicker.fill("المبيعات");
    await form.getByRole("option", { name: /المبيعات/ }).click();
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("تسلسل دائري");
    await expect(form).toBeVisible();

    await form.getByLabel("الاسم *").fill("الإدارة العامة المحدثة");
    await parentPicker.fill("بدون");
    await form.getByRole("option", { name: "بدون مركز رئيسي" }).click();
    await form.getByRole("button", { name: "حفظ", exact: true }).click();

    await expect(form).toBeHidden();
    await expect(row(page, "الإدارة العامة المحدثة")).toBeVisible();
  });

  test("clicking a row opens the detail panel with its parent and children", async ({ page }) => {
    await page.getByText("الإدارة العامة", { exact: true }).click();
    const panel = page.getByRole("dialog", { name: /الإدارة العامة/ });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("بدون مركز رئيسي")).toBeVisible();
    await expect(panel.getByText(/المراكز الفرعية/)).toBeVisible();
    await expect(panel.getByText("CC-002 — المبيعات")).toBeVisible();
  });
});

test.describe("Treasury accounts", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "حسابات الخزينة");
    await expect(page.getByRole("heading", { name: "حسابات الخزينة" })).toBeVisible();
  });

  test("lists demo treasury accounts with type, currency and status", async ({ page }) => {
    await expect(page.getByText("عرض 3 من 3 حساب")).toBeVisible();
    const cashRow = row(page, "صندوق نقدي");
    await expect(cashRow).toBeVisible();
    // exact:true — "نقدي" is also a substring of the row's own name cell.
    await expect(cashRow.getByText("نقدي", { exact: true })).toBeVisible();
    await expect(cashRow.getByText("نشط", { exact: true })).toBeVisible();

    const bankRow = row(page, "البنك الأهلي المصري — جاري");
    await expect(bankRow).toBeVisible();
    await expect(bankRow.getByText("بنكي", { exact: true })).toBeVisible();
  });

  // NOTE: unlike Taxes/Cost Centers, TreasuryAccountsScreen renders no
  // "تعديل" action anywhere (no edit button in the row or the detail panel)
  // — confirmed against source, so only add + detail-view are covered here.
  test("adding a treasury account validates a duplicate code, then succeeds with an opening balance", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة حساب" }).click();
    const form = page.getByRole("dialog", { name: "إضافة حساب" });
    await expect(form).toBeVisible();

    await form.getByLabel("اسم الحساب *").fill("صندوق تجريبي");
    await form.getByLabel("الكود *").fill("CASH-001"); // already used
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("مستخدم بالفعل");
    await expect(form).toBeVisible();

    await form.getByLabel("الكود *").fill("CASH-099");
    // MoneyInput has no associated <label>; it's the only "0.00"-placeholder field.
    await form.getByPlaceholder("0.00").fill("500");
    await form.getByLabel("تاريخ الرصيد الافتتاحي").fill("2026-08-01");

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 4 من 4 حساب")).toBeVisible();
    await row(page, "صندوق تجريبي").click();
    const panel = page.getByRole("dialog", { name: "كشف حساب — صندوق تجريبي" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("500.00")).toBeVisible();
  });

  test("clicking a row opens the account statement panel with GL account and branch info", async ({ page }) => {
    await row(page, "صندوق نقدي الفرع الرئيسي").click();
    const panel = page.getByRole("dialog", { name: "كشف حساب — صندوق نقدي الفرع الرئيسي" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("1300-1")).toBeVisible();
    // exact:true — the dialog's own title also contains "الفرع الرئيسي".
    await expect(panel.getByText("الفرع الرئيسي", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "إغلاق اللوحة" }).click();
    await expect(panel).toBeHidden();

    // An account with no explicit GL override falls back to "auto by type".
    await row(page, "صندوق نقدي").click();
    const cashPanel = page.getByRole("dialog", { name: "كشف حساب — صندوق نقدي" });
    await expect(cashPanel.getByText("تلقائي حسب النوع")).toBeVisible();
  });
});

test.describe("Fiscal periods", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الفترات المالية");
    await expect(page.getByRole("heading", { name: "الفترات المالية" })).toBeVisible();
  });

  test("shows the 2026 grid split across all three lifecycle states", async ({ page }) => {
    await expect(page.getByText("عرض 12 من 12 فترة")).toBeVisible();
    await expect(row(page, "يناير 2026").getByText("مقفلة")).toBeVisible();
    await expect(row(page, "أبريل 2026").getByText("مغلقة")).toBeVisible();
    await expect(row(page, "أغسطس 2026").getByText("مفتوحة")).toBeVisible();

    await expect(page.getByRole("button", { name: "الكل (12)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "مفتوحة (5)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "مغلقة (4)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "مقفلة (3)" })).toBeVisible();
  });

  test("an open period only offers إغلاق; closing it swaps in إعادة فتح/قفل", async ({ page }) => {
    const period = row(page, "أكتوبر 2026"); // seeded "open"
    await expect(period.getByText("مفتوحة")).toBeVisible();
    await expect(period.getByRole("button", { name: "إغلاق" })).toBeVisible();
    await expect(period.getByRole("button", { name: "إعادة فتح" })).toHaveCount(0);
    await expect(period.getByRole("button", { name: "قفل" })).toHaveCount(0);

    await period.getByRole("button", { name: "إغلاق" }).click();

    await expect(period.getByText("مغلقة")).toBeVisible();
    await expect(period.getByRole("button", { name: "إغلاق" })).toHaveCount(0);
    await expect(period.getByRole("button", { name: "إعادة فتح" })).toBeVisible();
    await expect(period.getByRole("button", { name: "قفل" })).toBeVisible();

    await expect(page.getByRole("button", { name: "مفتوحة (4)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "مغلقة (5)" })).toBeVisible();
  });

  test("locking a closed period removes every further lifecycle action", async ({ page }) => {
    const period = row(page, "أبريل 2026"); // seeded "closed"
    await expect(period.getByText("مغلقة")).toBeVisible();
    await expect(period.getByRole("button", { name: "قفل" })).toBeVisible();

    await period.getByRole("button", { name: "قفل" }).click();

    await expect(period.getByText("مقفلة")).toBeVisible();
    await expect(period.getByRole("button")).toHaveCount(0); // locked is terminal — no actions at all

    await expect(page.getByRole("button", { name: "مغلقة (3)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "مقفلة (4)" })).toBeVisible();
  });

  test("a period seeded as locked already has no lifecycle actions", async ({ page }) => {
    const period = row(page, "فبراير 2026"); // seeded "locked"
    await expect(period.getByText("مقفلة")).toBeVisible();
    await expect(period.getByRole("button")).toHaveCount(0);
  });

  test("reopening a closed period restores it to open with only إغلاق available", async ({ page }) => {
    const period = row(page, "مايو 2026"); // seeded "closed"
    await period.getByRole("button", { name: "إعادة فتح" }).click();

    await expect(period.getByText("مفتوحة")).toBeVisible();
    await expect(period.getByRole("button", { name: "إغلاق" })).toBeVisible();
    await expect(period.getByRole("button", { name: "إعادة فتح" })).toHaveCount(0);
    await expect(period.getByRole("button", { name: "قفل" })).toHaveCount(0);
  });
});
