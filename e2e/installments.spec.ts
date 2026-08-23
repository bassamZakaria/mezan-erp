import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Installments — Plans (خطط الأقساط) and Collection Follow-ups
 * (متابعة التحصيل), apps/web/src/screens/InstallmentPlansScreen.tsx /
 * InstallmentFollowUpsScreen.tsx. Real API-backed: a plan splits a
 * confirmed sales invoice's outstanding balance, and a follow-up logs
 * against a real customer. Neither list has a search box, but
 * `page`/`pageCount` are hardcoded to 1, so every row renders — isolated
 * per test via a `table tbody tr` text filter on a unique name.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createCustomer(page: Page, name: string): Promise<void> {
  await clickSidebarItem(page, "العملاء");
  await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة عميل" }).click();
  const form = page.getByRole("dialog", { name: "إضافة عميل" });
  await form.getByLabel("اسم العميل *").fill(name);
  await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
  await expect(form).toBeHidden();
}

async function createItem(page: Page, name: string, salePrice: string): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).click();
  const form = page.getByRole("dialog", { name: "إضافة صنف" });
  // Service items skip inventory tracking, so they stay sellable without
  // needing real on-hand stock (see sales-invoices.spec.ts).
  await form.getByLabel("نوع الصنف *").selectOption({ label: "خدمة" });
  await form.getByLabel("اسم الصنف *").fill(name);
  const price = form.getByLabel("سعر البيع");
  await price.fill(salePrice);
  await price.press("Tab");
  await form.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(form).toBeHidden();
}

async function pickEntity(scope: Locator, label: string, query: string): Promise<void> {
  const input = scope.getByLabel(label);
  await input.click();
  await input.fill(query);
  await scope.getByRole("button", { name: new RegExp(query) }).first().click();
}

/** Selects a plain <select>'s option by a text substring — robust against exact-label formatting (money/date) we don't control. */
async function selectOptionContaining(select: Locator, substring: string): Promise<void> {
  const value = await select.locator("option").filter({ hasText: substring }).first().getAttribute("value");
  if (value === null) throw new Error(`No <option> containing "${substring}"`);
  await select.selectOption(value);
}

function uniqueRow(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({ hasText: text });
}

async function createConfirmedSalesInvoice(page: Page, customerName: string, itemName: string): Promise<string> {
  await clickSidebarItem(page, "فواتير المبيعات");
  await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  await page.getByRole("button", { name: "فاتورة جديدة" }).click();
  const dialog = page.getByRole("dialog", { name: "فاتورة مبيعات جديدة" });
  await pickEntity(dialog, "العميل *", customerName);
  await pickEntity(dialog, "الصنف — سطر 1", itemName);
  await dialog.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(dialog).toBeHidden();

  await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill(customerName);
  const row = uniqueRow(page, customerName);
  await expect(row).toHaveCount(1);
  // The docNo cell wraps two stacked divs (docNo, then "customer · date") —
  // scope to the .mz-num one specifically, not the outer wrapper div (whose
  // innerText would combine both lines).
  const docNo = (await row.locator("td").first().locator(".mz-num").first().innerText()).trim();
  return docNo;
}

test.describe("Installment Plans", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("splits a confirmed invoice's outstanding balance into a schedule and auto-confirms the plan", async ({ page }) => {
    const customerName = unique("عميل خطة أقساط");
    const itemName = unique("صنف خطة أقساط");
    await createCustomer(page, customerName);
    await createItem(page, itemName, "1000");
    const docNo = await createConfirmedSalesInvoice(page, customerName, itemName);

    await clickSidebarItem(page, "خطط الأقساط");
    await expect(page.getByRole("heading", { name: "خطط الأقساط" })).toBeVisible();
    await page.getByRole("button", { name: "خطة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "خطة أقساط جديدة" });

    await selectOptionContaining(dialog.getByLabel("الفاتورة *"), docNo);
    await expect(dialog.getByText("معاينة الجدول")).toBeVisible();
    await dialog.getByLabel("عدد الأقساط *").fill("4");
    await dialog.getByLabel("التكرار *").selectOption({ label: "شهري" });

    const saveButton = dialog.getByRole("button", { name: "حفظ", exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(dialog).toBeHidden();

    const row = uniqueRow(page, docNo);
    await expect(row).toHaveCount(1);
    await expect(row.getByText("نشط", { exact: true })).toBeVisible();
    await expect(row.getByText("شهري")).toBeVisible();

    await row.click();
    await expect(page.getByText("#1").first()).toBeVisible();
    await expect(page.getByText("#4").first()).toBeVisible();
  });

  test("processing overdue installments reports a summary", async ({ page }) => {
    await clickSidebarItem(page, "خطط الأقساط");
    await expect(page.getByRole("heading", { name: "خطط الأقساط" })).toBeVisible();

    await page.getByRole("button", { name: "معالجة المتأخرات" }).first().click();
    const dialog = page.getByRole("dialog", { name: "معالجة المتأخرات" });
    await dialog.getByRole("button", { name: "معالجة المتأخرات" }).click();
    // "تم تحديث \d" (not just /تم تحديث/) — the static instructions text
    // above ("سيتم تحديث...") also contains the substring "تم تحديث".
    await expect(dialog.getByText(/تم تحديث \d/)).toBeVisible();
    await expect(dialog.getByText(/غرامات مطبّقة/)).toBeVisible();
  });
});

test.describe("Installment Collection Follow-ups", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("logs a collection follow-up against a customer and completes it with an outcome", async ({ page }) => {
    const customerName = unique("عميل متابعة تحصيل");
    await createCustomer(page, customerName);

    await clickSidebarItem(page, "متابعة التحصيل");
    await expect(page.getByRole("heading", { name: "متابعة التحصيل" })).toBeVisible();
    await page.getByRole("button", { name: "متابعة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "متابعة جديدة" });

    await selectOptionContaining(dialog.getByLabel("العميل *"), customerName);
    await dialog.getByLabel("نوع المتابعة *").selectOption({ label: "زيارة" });
    await dialog.getByLabel("ملاحظات").fill("متابعة اختبار E2E");
    await dialog.getByRole("button", { name: "إضافة" }).click();
    await expect(dialog).toBeHidden();

    const row = uniqueRow(page, customerName);
    await expect(row).toHaveCount(1);
    await expect(row.getByText("معلق", { exact: true })).toBeVisible();
    await expect(row.getByText("زيارة")).toBeVisible();

    await row.click();
    await page.getByLabel("النتيجة").fill("تم الاتفاق على السداد غداً");
    await page.getByRole("button", { name: "إكمال المتابعة" }).click();

    await expect(page.getByRole("button", { name: "إكمال المتابعة" })).toHaveCount(0);
    const completedRow = uniqueRow(page, customerName);
    await expect(completedRow.getByText("مكتمل", { exact: true })).toBeVisible();
  });

  test("cancels a pending follow-up", async ({ page }) => {
    const customerName = unique("عميل متابعة ملغاة");
    await createCustomer(page, customerName);

    await clickSidebarItem(page, "متابعة التحصيل");
    await expect(page.getByRole("heading", { name: "متابعة التحصيل" })).toBeVisible();
    await page.getByRole("button", { name: "متابعة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "متابعة جديدة" });
    await selectOptionContaining(dialog.getByLabel("العميل *"), customerName);
    await dialog.getByLabel("نوع المتابعة *").selectOption({ label: "اتصال" });
    await dialog.getByRole("button", { name: "إضافة" }).click();
    await expect(dialog).toBeHidden();

    const row = uniqueRow(page, customerName);
    await row.click();
    await page.getByRole("button", { name: "إلغاء" }).click();

    const cancelledRow = uniqueRow(page, customerName);
    await expect(cancelledRow.getByText("ملغي", { exact: true })).toBeVisible();
  });
});
