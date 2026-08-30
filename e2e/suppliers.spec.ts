import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * Suppliers screen (apps/web/src/screens/SuppliersScreen.tsx), the mirror of
 * CustomersScreen.tsx. The e2e backend starts as a genuinely empty tenant —
 * no suppliers seeded — so every test creates its own via the real create
 * flow, isolated by a unique name (see customers.spec.ts for the same
 * pattern, and e2e/support/broken-label.ts for why some fields are filled
 * through `brokenLabelField` rather than `getByLabel`).
 */

function row(page: Page, nameAr: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(nameAr, { exact: true }) });
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function openSupplierForm(page: Page) {
  await page.getByRole("button", { name: "إضافة مورد" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة مورد" });
  await expect(form).toBeVisible();
  return form;
}

test.describe("Suppliers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الموردون");
    await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
  });

  test("adding a supplier fills in required fields and appears in the list with a generated code", async ({ page }) => {
    const name = unique("مورد تجريبي جديد");
    const form = await openSupplierForm(page);

    await brokenLabelField(form, "اسم المورد *").fill(name);
    await brokenLabelField(form, "الهاتف").fill("01066600000");
    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();

    await expect(form).toBeHidden();
    const newRow = row(page, name);
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText(/^S\d+$/)).toBeVisible();
    await expect(newRow.getByText("01066600000")).toBeVisible();
  });

  test("status chip filters an inactive supplier out of, then back into, the list", async ({ page }) => {
    const name = unique("مورد حالة");
    const form = await openSupplierForm(page);
    await brokenLabelField(form, "اسم المورد *").fill(name);
    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();
    await expect(form).toBeHidden();

    await row(page, name).click();
    await page.getByRole("button", { name: "تعديل" }).click();
    const editForm = page.getByRole("dialog", { name: "تعديل مورد" });
    await editForm.getByRole("switch", { name: "نشط" }).click();
    await editForm.getByRole("button", { name: "حفظ التعديلات" }).click();
    await expect(editForm).toBeHidden();

    await page.getByRole("button", { name: "رجوع لقائمة الموردين" }).click();
    await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();

    const search = page.getByPlaceholder("ابحث باسم المورد أو الكود أو الهاتف…");
    await search.fill(name);
    await expect(row(page, name).getByText("غير نشط", { exact: true })).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: "غير نشط" }).click();
    await expect(row(page, name)).toBeVisible();
    await expect(tablist.getByRole("tab", { name: /^نشط\s+\d/ })).toHaveCount(0);
  });

  test("search narrows the list by name and by generated code", async ({ page }) => {
    const name = unique("مورد بحث فريد");
    const form = await openSupplierForm(page);
    await brokenLabelField(form, "اسم المورد *").fill(name);
    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();
    await expect(form).toBeHidden();

    const code = (await row(page, name).getByText(/^S\d+$/).innerText()).trim();

    const search = page.getByPlaceholder("ابحث باسم المورد أو الكود أو الهاتف…");
    await search.fill(name);
    await expect(page.locator("table tbody tr")).toHaveCount(1);

    await search.fill("");
    await search.fill(code);
    await expect(row(page, name)).toBeVisible();
  });

  test("opening a supplier shows its detail overview, then returns to the list", async ({ page }) => {
    const name = unique("شركة تفاصيل المورد");
    const form = await openSupplierForm(page);
    await brokenLabelField(form, "اسم المورد *").fill(name);
    await brokenLabelField(form, "الهاتف").fill("01098760099");
    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();
    await expect(form).toBeHidden();

    await row(page, name).click();
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText("01098760099")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة الموردين" }).click();
    await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
    await expect(row(page, name)).toBeVisible();
  });

  test("editing a supplier via the detail view prefills the form and updates the record", async ({ page }) => {
    const name = unique("مؤسسة تعديل المورد");
    const form = await openSupplierForm(page);
    await brokenLabelField(form, "اسم المورد *").fill(name);
    await brokenLabelField(form, "الهاتف").fill("01098760004");
    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();
    await expect(form).toBeHidden();
    const code = (await row(page, name).getByText(/^S\d+$/).innerText()).trim();

    await row(page, name).click();
    await page.getByRole("button", { name: "تعديل" }).click();

    const editForm = page.getByRole("dialog", { name: "تعديل مورد" });
    await expect(editForm).toBeVisible();
    await expect(brokenLabelField(editForm, "الكود")).toBeDisabled();
    await expect(brokenLabelField(editForm, "الكود")).toHaveValue(code);
    await expect(brokenLabelField(editForm, "اسم المورد *")).toHaveValue(name);
    await expect(brokenLabelField(editForm, "الهاتف")).toHaveValue("01098760004");

    await brokenLabelField(editForm, "الهاتف").fill("01000000004");
    await editForm.getByRole("button", { name: "حفظ التعديلات" }).click();

    await expect(editForm).toBeHidden();
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText("01000000004")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة الموردين" }).click();
    await expect(row(page, name).getByText("01000000004")).toBeVisible();
  });

  test("leaving the required name empty surfaces the domain validation error and keeps the form open", async ({ page }) => {
    const form = await openSupplierForm(page);
    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();

    await expect(form.getByRole("alert")).toContainText("الاسم بالعربية مطلوب");
    await expect(form).toBeVisible();
  });
});
