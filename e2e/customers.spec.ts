import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * Customers screen (apps/web/src/screens/CustomersScreen.tsx). The e2e
 * backend now starts as a genuinely empty tenant (packages/backend/src/
 * seed.ts) — no customers seeded — so every test creates its own customers
 * via the real create flow first, isolated by a unique name, the same
 * pattern sales-invoices.spec.ts and purchase-chain.spec.ts use.
 *
 * The name/phone/email/credit-limit fields are filled through
 * `brokenLabelField`, a positional locator (see e2e/support/broken-label.ts):
 * these tests are about the customer flow, and the field labelling they were
 * written around is now guaranteed in journals.spec.ts instead.
 */

function row(page: Page, nameAr: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(nameAr, { exact: true }) });
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function openCustomerForm(page: Page) {
  await page.getByRole("button", { name: "إضافة عميل" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة عميل" });
  await expect(form).toBeVisible();
  return form;
}

test.describe("Customers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "العملاء");
    await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
  });

  test("adding a customer fills in required fields and appears in the list with a generated code", async ({ page }) => {
    const name = unique("عميل تجريبي جديد");
    const form = await openCustomerForm(page);

    await brokenLabelField(form, "اسم العميل *").fill(name);
    await brokenLabelField(form, "الهاتف").fill("01055500000");
    await brokenLabelField(form, "الحد الائتماني").fill("5000");
    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();

    await expect(form).toBeHidden();
    const newRow = row(page, name);
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText(/^C\d+$/)).toBeVisible();
    await expect(newRow.getByText("01055500000")).toBeVisible();
  });

  test("status chip filters an inactive customer out of, then back into, the list", async ({ page }) => {
    const name = unique("عميل حالة");
    const form = await openCustomerForm(page);
    await brokenLabelField(form, "اسم العميل *").fill(name);
    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
    await expect(form).toBeHidden();

    // Deactivate it via the edit form's ToggleField (only shown when editing).
    await row(page, name).click();
    await page.getByRole("button", { name: "تعديل" }).click();
    const editForm = page.getByRole("dialog", { name: "تعديل عميل" });
    await editForm.getByRole("switch", { name: "نشط" }).click();
    await editForm.getByRole("button", { name: "حفظ التعديلات" }).click();
    await expect(editForm).toBeHidden();

    await page.getByRole("button", { name: "رجوع لقائمة العملاء" }).click();
    await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();

    const search = page.getByPlaceholder("بحث بالاسم أو الكود أو الهاتف…");
    await search.fill(name);
    await expect(row(page, name).getByText("غير نشط", { exact: true })).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: "غير نشط" }).click();
    await expect(row(page, name)).toBeVisible();

    // A zero-count chip is not rendered at all (packages/ui/src/primitives/
    // ListViews.tsx — "a zero-count option teaches nothing"): with the search
    // scoped to our one inactive customer, "نشط" has nothing to offer.
    await expect(tablist.getByRole("tab", { name: /^نشط\s+\d/ })).toHaveCount(0);
  });

  test("search narrows the list by name and by generated code", async ({ page }) => {
    const name = unique("عميل بحث فريد");
    const form = await openCustomerForm(page);
    await brokenLabelField(form, "اسم العميل *").fill(name);
    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
    await expect(form).toBeHidden();

    const code = (await row(page, name).getByText(/^C\d+$/).innerText()).trim();

    const search = page.getByPlaceholder("بحث بالاسم أو الكود أو الهاتف…");
    await search.fill(name);
    await expect(page.locator("table tbody tr")).toHaveCount(1);

    await search.fill("");
    await search.fill(code);
    await expect(row(page, name)).toBeVisible();
  });

  test("opening a customer shows its detail overview and a real (implemented) tab, then returns to the list", async ({ page }) => {
    const name = unique("شركة تفاصيل العميل");
    const form = await openCustomerForm(page);
    await brokenLabelField(form, "اسم العميل *").fill(name);
    await brokenLabelField(form, "الهاتف").fill("01012345099");
    await brokenLabelField(form, "البريد الإلكتروني").fill("detail-customer@example.com");
    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
    await expect(form).toBeHidden();

    await row(page, name).click();
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText("01012345099")).toBeVisible();
    await expect(page.getByText("detail-customer@example.com")).toBeVisible();

    const tablist = page.getByRole("tablist");
    await tablist.getByRole("tab", { name: "الفواتير" }).click();
    await expect(page.getByRole("tabpanel").getByText(/لا توجد فواتير/)).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة العملاء" }).click();
    await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
    await expect(row(page, name)).toBeVisible();
  });

  test("editing a customer via the detail view prefills the form and updates the record", async ({ page }) => {
    const name = unique("مجموعة تعديل تجارية");
    const form = await openCustomerForm(page);
    await brokenLabelField(form, "اسم العميل *").fill(name);
    await brokenLabelField(form, "الهاتف").fill("01555512004");
    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
    await expect(form).toBeHidden();
    const code = (await row(page, name).getByText(/^C\d+$/).innerText()).trim();

    await row(page, name).click();
    await page.getByRole("button", { name: "تعديل" }).click();

    const editForm = page.getByRole("dialog", { name: "تعديل عميل" });
    await expect(editForm).toBeVisible();
    await expect(brokenLabelField(editForm, "الكود")).toBeDisabled();
    await expect(brokenLabelField(editForm, "الكود")).toHaveValue(code);
    await expect(brokenLabelField(editForm, "اسم العميل *")).toHaveValue(name);
    await expect(brokenLabelField(editForm, "الهاتف")).toHaveValue("01555512004");

    await brokenLabelField(editForm, "الهاتف").fill("01500000004");
    await editForm.getByRole("button", { name: "حفظ التعديلات" }).click();

    await expect(editForm).toBeHidden();
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText("01500000004")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة العملاء" }).click();
    await expect(row(page, name).getByText("01500000004")).toBeVisible();
  });

  test("leaving the required name empty surfaces the domain validation error and keeps the form open", async ({ page }) => {
    const form = await openCustomerForm(page);
    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();

    await expect(form.getByRole("alert")).toContainText("الاسم بالعربية مطلوب");
    await expect(form).toBeVisible();
  });
});
