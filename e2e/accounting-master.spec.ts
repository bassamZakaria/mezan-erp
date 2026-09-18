import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { chooseComboboxOption } from "./support/combobox";
import { confirmRowAction, runRowAction } from "./support/row-menu";

/**
 * Accounting master-data screens, covered together in one spec:
 *  - Taxes (apps/web/src/screens/TaxesScreen.tsx) — the demo seed carries
 *    exactly TWO tax rates (packages/backend/src/seed.ts's `vat` +
 *    demo-seed.ts's `TABLE5`): VAT14 "ضريبة القيمة المضافة" (14%, exclusive,
 *    default, active, no GL override, ETA "auto") and "ضريبة الجدول" (5%,
 *    exclusive, not default, active). Neither carries a GL mapping or a
 *    non-"auto" ETA sub-type out of the box — the old fixture (a second,
 *    INACTIVE "WHT1" tax with 2200/1400 GL accounts and ETA V009 already set)
 *    does not exist in this seed, so those states are built by the tests
 *    themselves. Row actions live in a RowMenu (`aria-label="إجراءات {name}"`,
 *    `role="menuitem"` entries) rather than a bare "تعديل" button in the row.
 *  - Cost centers (CostCentersScreen.tsx) — the demo seed carries exactly TWO
 *    cost centers, both standalone (no parent/child): CC-100 "المبيعات" and
 *    CC-200 "الإدارة" (demo-seed.ts's `COST_CENTERS`). The old fixture (a
 *    4-item CC-001..CC-004 tree with an existing parent/child pair) does not
 *    exist — the hierarchy exercised below is built by the tests. Row edit is
 *    still a direct icon button (`aria-label="تعديل {name}"` —
 *    costCentres.editLabel — unlike Taxes/Fiscal periods).
 *  - Treasury accounts (TreasuryAccountsScreen.tsx) — the demo seed carries
 *    exactly TWO treasury accounts (demo-seed.ts's `TREASURY_ACCOUNTS`):
 *    "الخزينة الرئيسية" (CASH-001, cash, GL 1300-1) and "البنك الأهلي — جاري"
 *    (BANK-001, bank, GL 1310). This screen has NO edit action in the row —
 *    editing only happens from inside the detail panel — confirmed against
 *    source.
 *  - Fiscal periods (FiscalPeriodsScreen.tsx) — `generateFiscalYear` seeds 12
 *    monthly periods for the CURRENT year, ALL "مفتوحة" (open); the old
 *    fixture (a pre-mixed Jan-Mar locked / Apr-Jul closed / Aug-Dec open
 *    grid) does not exist — every lifecycle transition below is driven by the
 *    tests, each against its own untouched month so they can run serially
 *    without clobbering each other.
 *
 * Every describe block below runs `mode: "serial"` (the pattern already used
 * by e2e/crm.spec.ts and e2e/projects-assets-field.spec.ts) because the tests
 * within a block share the one demo tenant's data and later tests build on
 * rows earlier tests created — count assertions are only meaningful with a
 * fixed run order.
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

test.describe("Taxes", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الضرائب");
    await expect(page.getByRole("heading", { name: "الضرائب" })).toBeVisible();
  });

  test("lists the two seeded taxes with rate, type and the default badge on VAT14", async ({ page }) => {
    await expect(page.getByText("عرض 2 من 2 ضريبة")).toBeVisible();

    // exact:false — the name cell's own text node sits beside the "الافتراضي"
    // badge with no wrapping element around just the name, so an exact match
    // against the name alone never resolves.
    const vatRow = row(page, "ضريبة القيمة المضافة", false);
    await expect(vatRow).toBeVisible();
    await expect(vatRow.getByText("الافتراضي")).toBeVisible();
    await expect(vatRow.getByText("14.00%")).toBeVisible();
    await expect(vatRow.getByText("غير شاملة (تضاف على السعر)")).toBeVisible();
    await expect(vatRow.getByText("نشط", { exact: true })).toBeVisible();

    const tableRow = row(page, "ضريبة الجدول", false);
    await expect(tableRow).toBeVisible();
    await expect(tableRow.getByText("الافتراضي")).toHaveCount(0);
    await expect(tableRow.getByText("5.00%")).toBeVisible();
    await expect(tableRow.getByText("نشط", { exact: true })).toBeVisible();
  });

  test("editing a tax prefills its fields, and saves a GL mapping + ETA subtype that reopening shows back", async ({ page }) => {
    await runRowAction(row(page, "ضريبة الجدول"), "تعديل");
    let form = page.getByRole("dialog", { name: "تعديل ضريبة" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("رمز الضريبة *")).toBeDisabled();
    await expect(form.getByLabel("رمز الضريبة *")).toHaveValue("TABLE5");
    await expect(form.getByLabel("اسم الضريبة *")).toHaveValue("ضريبة الجدول");
    await expect(form.getByLabel("نسبة الضريبة (%) *")).toHaveValue("5");

    await expect(form.getByRole("heading", { name: "حسابات الترحيل" })).toBeVisible();
    await expect(form.getByLabel("حساب الضريبة المستحقة (المبيعات)")).toHaveValue("");
    await expect(form.getByLabel("حساب ضريبة المدخلات (المشتريات)")).toHaveValue("");
    await expect(form.getByRole("heading", { name: "تصنيف الفاتورة الإلكترونية (ETA)" })).toBeVisible();

    await form.getByLabel("حساب الضريبة المستحقة (المبيعات)").fill("2205");
    await form.getByLabel("حساب ضريبة المدخلات (المشتريات)").fill("1405");
    await chooseComboboxOption(form.getByRole("combobox", { name: "النوع الفرعي لضريبة القيمة المضافة" }), page, /^V001/);
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form).toBeHidden();

    await runRowAction(row(page, "ضريبة الجدول"), "تعديل");
    form = page.getByRole("dialog", { name: "تعديل ضريبة" });
    await expect(form.getByLabel("حساب الضريبة المستحقة (المبيعات)")).toHaveValue("2205");
    await expect(form.getByLabel("حساب ضريبة المدخلات (المشتريات)")).toHaveValue("1405");
    await expect(form.getByRole("combobox", { name: "النوع الفرعي لضريبة القيمة المضافة" })).toContainText("V001");
    await form.getByRole("button", { name: "إلغاء", exact: true }).click();
  });

  test("adding a tax validates a duplicate code, then succeeds with GL and ETA mapping filled", async ({ page }) => {
    // Wait for the real list to load first — while it's loading, DocumentList's
    // own empty-state renders a SECOND "إضافة ضريبة" button alongside the
    // toolbar's, and clicking by role/name alone is ambiguous until it's gone.
    await expect(page.getByText("عرض 2 من 2 ضريبة")).toBeVisible();
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
    await chooseComboboxOption(form.getByRole("combobox", { name: "النوع الفرعي لضريبة القيمة المضافة" }), page, /^V001/);

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 3 من 3 ضريبة")).toBeVisible();
    await expect(row(page, "ضريبة اختبار")).toBeVisible();
  });

  test("status filter narrows to a deactivated tax", async ({ page }) => {
    const testRow = row(page, "ضريبة اختبار"); // added by the previous (serial) test
    await runRowAction(testRow, "تعطيل النسبة");
    await confirmRowAction(page, "تعطيل النسبة");
    await expect(testRow.getByText("غير نشط", { exact: true })).toBeVisible();

    await chooseComboboxOption(page.getByRole("combobox").filter({ hasText: "كل الحالات" }), page, "غير نشط");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "ضريبة اختبار")).toBeVisible();

    await chooseComboboxOption(page.getByRole("combobox").filter({ hasText: "غير نشط" }), page, "كل الحالات");
    await expect(page.getByText("عرض 3 من 3 ضريبة")).toBeVisible();
  });
});

test.describe("Cost centers", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مراكز التكلفة");
    await expect(page.getByRole("heading", { name: "مراكز التكلفة" })).toBeVisible();
  });

  test("lists the seeded cost centers, including the two standalone general ones", async ({ page }) => {
    // 8 total: CC-100/CC-200 (demo-seed.ts's COST_CENTERS, both linked to the
    // main branch) plus 6 "project" type ones auto-created — one per seeded
    // project — with neither a branch nor a department, so all 8 start with
    // no parent/child relationship at all.
    await expect(page.getByText("عرض 8 من 8 مركز تكلفة")).toBeVisible();
    await expect(row(page, "المبيعات")).toBeVisible();
    await expect(row(page, "الإدارة")).toBeVisible();
    await expect(row(page, "المبيعات").getByText("بدون مركز رئيسي")).toBeVisible();
  });

  test("adding a cost center validates a duplicate code, then succeeds under a chosen parent", async ({ page }) => {
    // Wait for the real list to load first — while it's loading, the table's
    // own empty-state renders a SECOND "إضافة مركز تكلفة" button alongside the
    // toolbar's, and clicking by role/name alone is ambiguous until it's gone.
    await expect(page.getByText("عرض 8 من 8 مركز تكلفة")).toBeVisible();
    await page.getByRole("button", { name: "إضافة مركز تكلفة" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مركز تكلفة" });
    await expect(form).toBeVisible();

    await form.getByLabel("الكود *").fill("CC-100"); // already used
    await form.getByLabel("الاسم *").fill("نسخة");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("مستخدم بالفعل");
    await expect(form).toBeVisible();

    await form.getByLabel("الكود *").fill("CC-500");
    await form.getByLabel("الاسم *").fill("مركز تجريبي");

    // EntityPicker's dynamic placeholder (the currently-selected option's
    // label) changes once a selection is made, so target the one real
    // <input role="combobox"> in the form instead of getByLabel (the "النوع"
    // field is a plain Select, which also reports role=combobox but isn't an
    // <input>).
    const parentPicker = form.locator('input[role="combobox"]');
    await parentPicker.fill("الإدارة");
    await form.getByRole("option", { name: "CC-200 — الإدارة" }).click();

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 9 من 9 مركز تكلفة")).toBeVisible();
    const created = row(page, "مركز تجريبي");
    await expect(created).toBeVisible();
    await expect(created.getByText("CC-200 — الإدارة")).toBeVisible();
  });

  test("editing rejects a circular parent, then succeeds after fixing it", async ({ page }) => {
    await page.getByRole("button", { name: "تعديل الإدارة" }).click();
    const form = page.getByRole("dialog", { name: "تعديل مركز تكلفة" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("الكود *")).toBeDisabled();
    await expect(form.getByLabel("الكود *")).toHaveValue("CC-200");

    // "الإدارة" is now the parent of "مركز تجريبي" (created above) — picking
    // its own child as its new parent must be rejected as a circular
    // reference.
    const parentPicker = form.locator('input[role="combobox"]');
    await parentPicker.fill("تجريبي");
    await form.getByRole("option", { name: /مركز تجريبي/ }).click();
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("تسلسل دائري");
    await expect(form).toBeVisible();

    await form.getByLabel("الاسم *").fill("الإدارة المحدثة");
    await parentPicker.fill("بدون");
    await form.getByRole("option", { name: "بدون مركز رئيسي" }).click();
    await form.getByRole("button", { name: "حفظ", exact: true }).click();

    await expect(form).toBeHidden();
    await expect(row(page, "الإدارة المحدثة")).toBeVisible();
  });

  test("clicking a row opens the detail panel with its parent and children", async ({ page }) => {
    await page.getByText("الإدارة المحدثة", { exact: true }).click();
    const panel = page.getByRole("dialog", { name: /الإدارة المحدثة/ });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("بدون مركز رئيسي")).toBeVisible();
    await expect(panel.getByText(/المراكز الفرعية/)).toBeVisible();
    await expect(panel.getByText("CC-500 — مركز تجريبي")).toBeVisible();
  });
});

test.describe("Treasury accounts", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "حسابات الخزينة");
    await expect(page.getByRole("heading", { name: "حسابات الخزينة" })).toBeVisible();
  });

  test("lists the seeded treasury accounts with type and status", async ({ page }) => {
    // 3 total (demo-seed.ts's TREASURY_ACCOUNTS + the van cash custody account).
    await expect(page.getByText("عرض 3 من 3 حساب")).toBeVisible();
    const cashRow = row(page, "الخزينة الرئيسية");
    await expect(cashRow).toBeVisible();
    await expect(cashRow.getByText("نقدي", { exact: true })).toBeVisible();
    await expect(cashRow.getByText("نشط", { exact: true })).toBeVisible();

    const bankRow = row(page, "البنك الأهلي — جاري");
    await expect(bankRow).toBeVisible();
    await expect(bankRow.getByText("بنكي", { exact: true })).toBeVisible();
  });

  // NOTE: unlike Taxes/Cost Centers, TreasuryAccountsScreen renders no
  // "تعديل" action anywhere (no edit button in the row or the detail panel;
  // editing is reached from inside the detail panel instead) — confirmed
  // against source, so only add + detail-view are covered here.
  test("adding a treasury account validates a duplicate code, then succeeds with an opening balance", async ({ page }) => {
    // Wait for the real list to load first — while it's loading, DocumentList's
    // own empty-state renders a SECOND "إضافة حساب" button alongside the
    // toolbar's, and clicking by role/name alone is ambiguous until it's gone.
    await expect(page.getByText("عرض 3 من 3 حساب")).toBeVisible();
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
    // Two matches: the closing balance headline AND the "الرصيد الافتتاحي"
    // line both read the account's opening balance, since a fresh account
    // with no GL activity has no other movement to derive a closing figure
    // from — either is proof the entered opening balance was saved.
    await expect(panel.getByText("500.00").first()).toBeVisible();
  });

  test("clicking a row opens the account statement panel with GL account and branch info", async ({ page }) => {
    await row(page, "الخزينة الرئيسية").click();
    const panel = page.getByRole("dialog", { name: "كشف حساب — الخزينة الرئيسية" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("1300-1")).toBeVisible();
    await expect(panel.getByText("الفرع الرئيسي", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "إغلاق اللوحة" }).click();
    await expect(panel).toBeHidden();

    // An account with no explicit GL override falls back to "auto by type".
    await row(page, "صندوق تجريبي").click(); // created by the previous (serial) test
    const testPanel = page.getByRole("dialog", { name: "كشف حساب — صندوق تجريبي" });
    await expect(testPanel.getByText("تلقائي حسب النوع")).toBeVisible();
  });
});

test.describe("Fiscal periods", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الفترات المالية");
    await expect(page.getByRole("heading", { name: "الفترات المالية" })).toBeVisible();
  });

  test("shows the current fiscal year's 12 periods, all seeded open", async ({ page }) => {
    await expect(page.getByText("عرض 12 من 12 فترة")).toBeVisible();
    await expect(row(page, "يناير", false).getByText("مفتوحة")).toBeVisible();
    await expect(row(page, "ديسمبر", false).getByText("مفتوحة")).toBeVisible();

    // The filter chips render as radios inside a `role="radiogroup"`.
    await expect(page.getByRole("radio", { name: "الكل (12)" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "مفتوحة (12)" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "مغلقة (0)" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "مقفلة (0)" })).toBeVisible();
  });

  test("an open period only offers إغلاق; closing it swaps in إعادة فتح/قفل", async ({ page }) => {
    const period = row(page, "أكتوبر", false); // untouched by every other test in this block
    await expect(period.getByText("مفتوحة")).toBeVisible();
    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await expect(period.getByRole("menuitem", { name: "إغلاق" })).toBeVisible();
    await expect(period.getByRole("menuitem", { name: "إعادة فتح" })).toHaveCount(0);
    await expect(period.getByRole("menuitem", { name: "قفل" })).toHaveCount(0);
    await period.getByRole("menuitem", { name: "إغلاق" }).click();

    await expect(period.getByText("مغلقة")).toBeVisible();
    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await expect(period.getByRole("menuitem", { name: "إغلاق" })).toHaveCount(0);
    await expect(period.getByRole("menuitem", { name: "إعادة فتح" })).toBeVisible();
    await expect(period.getByRole("menuitem", { name: "قفل" })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("radio", { name: "مفتوحة (11)" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "مغلقة (1)" })).toBeVisible();
  });

  test("locking a closed period removes every further lifecycle action", async ({ page }) => {
    const period = row(page, "أبريل", false); // untouched by every other test in this block
    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await period.getByRole("menuitem", { name: "إغلاق" }).click();
    await expect(period.getByText("مغلقة")).toBeVisible();

    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await period.getByRole("menuitem", { name: "قفل" }).click();

    await expect(period.getByText("مقفلة")).toBeVisible();
    await expect(period.getByRole("button", { name: /^إجراءات/ })).toHaveCount(0); // locked is terminal — no actions at all
  });

  test("a period that has been locked has no lifecycle actions after a reload", async ({ page }) => {
    const period = row(page, "نوفمبر", false); // untouched by every other test in this block
    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await period.getByRole("menuitem", { name: "إغلاق" }).click();
    await expect(period.getByText("مغلقة")).toBeVisible();
    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await period.getByRole("menuitem", { name: "قفل" }).click();
    await expect(period.getByText("مقفلة")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "الفترات المالية" })).toBeVisible();
    const reloaded = row(page, "نوفمبر", false);
    await expect(reloaded.getByText("مقفلة")).toBeVisible();
    await expect(reloaded.getByRole("button")).toHaveCount(0);
  });

  test("reopening a closed period restores it to open with only إغلاق available", async ({ page }) => {
    const period = row(page, "مايو", false); // untouched by every other test in this block
    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await period.getByRole("menuitem", { name: "إغلاق" }).click();
    await expect(period.getByText("مغلقة")).toBeVisible();

    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await period.getByRole("menuitem", { name: "إعادة فتح" }).click();

    await expect(period.getByText("مفتوحة")).toBeVisible();
    await period.getByRole("button", { name: /^إجراءات/ }).click();
    await expect(period.getByRole("menuitem", { name: "إغلاق" })).toBeVisible();
    await expect(period.getByRole("menuitem", { name: "إعادة فتح" })).toHaveCount(0);
    await expect(period.getByRole("menuitem", { name: "قفل" })).toHaveCount(0);
  });
});
