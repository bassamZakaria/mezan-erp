import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Sales Returns (مرتجعات المبيعات) and Purchase Returns (مرتجعات المشتريات)
 * — apps/web/src/screens/SalesReturnsScreen.tsx / PurchaseReturnsScreen.tsx.
 * Both are real API-backed (draft → confirmed against a confirmed source
 * invoice), so tests create their own customer/supplier/item/invoice
 * prerequisites first. Neither list has a search box, but `page`/`pageCount`
 * are hardcoded to 1 (no real pagination), so every row renders — isolated
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

async function createSupplier(page: Page, name: string): Promise<void> {
  await clickSidebarItem(page, "الموردون");
  await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة مورد" }).click();
  const form = page.getByRole("dialog", { name: "إضافة مورد" });
  await form.getByLabel("اسم المورد *").fill(name);
  await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();
  await expect(form).toBeHidden();
}

async function createItem(page: Page, name: string, salePrice: string, type: "stock" | "service"): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).click();
  const form = page.getByRole("dialog", { name: "إضافة صنف" });
  if (type === "service") await form.getByLabel("نوع الصنف *").selectOption({ label: "خدمة" });
  await form.getByLabel("اسم الصنف *").fill(name);
  const price = form.getByLabel("سعر البيع");
  await price.fill(salePrice);
  await price.press("Tab");
  await form.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(form).toBeHidden();
}

/** Types into an EntityPicker combobox and clicks the matching option button. */
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

/** Creates + confirms a PO → GRN → Purchase Invoice chain, returning the confirmed invoice's number (e.g. "PI-000042"). */
async function createConfirmedPurchaseInvoice(page: Page, supplierName: string, itemName: string): Promise<string> {
  await clickSidebarItem(page, "أوامر الشراء");
  await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();
  await page.getByRole("button", { name: "أمر شراء جديد" }).click();
  let dialog = page.getByRole("dialog", { name: "أمر شراء جديد" });
  await pickEntity(dialog, "المورد *", supplierName);
  await pickEntity(dialog, "الصنف", itemName);
  await dialog.getByLabel("الكمية").fill("20");
  await dialog.getByLabel("سعر الوحدة").fill("40");
  await dialog.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(dialog).toBeHidden();

  await page.getByPlaceholder("بحث برقم الأمر أو اسم المورد…").fill(supplierName);
  let row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const poNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد وإرسال" }).click();
  await expect(page.getByText("مرسل").first()).toBeVisible();
  await page.getByRole("button", { name: "رجوع لأوامر الشراء" }).click();

  await clickSidebarItem(page, "استلام البضائع");
  await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();
  await page.getByRole("button", { name: "إيصال استلام جديد" }).click();
  dialog = page.getByRole("dialog", { name: "إيصال استلام جديد" });
  await pickEntity(dialog, "أمر الشراء *", poNumber);
  await dialog.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(dialog).toBeHidden();

  await page.getByPlaceholder("بحث برقم الإيصال أو المورد…").fill(supplierName);
  row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const grNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد الاستلام" }).click();
  await expect(page.getByText(/تمت زيادة كمية المخزون/)).toBeVisible();
  await page.getByRole("button", { name: "رجوع لإيصالات الاستلام" }).click();

  await clickSidebarItem(page, "فواتير المشتريات");
  await expect(page.getByRole("heading", { name: "فواتير المشتريات" })).toBeVisible();
  await page.getByRole("button", { name: "فاتورة مشتريات جديدة" }).click();
  dialog = page.getByRole("dialog", { name: "فاتورة مشتريات جديدة" });
  await dialog.getByRole("button", { name: "من إيصال استلام" }).click();
  await pickEntity(dialog, "إيصال الاستلام *", grNumber);
  await dialog.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(dialog).toBeHidden();

  await page.getByPlaceholder("بحث برقم الفاتورة أو اسم المورد…").fill(supplierName);
  row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const piNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(page.getByText(/تمّت إضافة الأصناف للمخزون سابقاً/)).toBeVisible();
  await page.getByRole("button", { name: "رجوع لفواتير المشتريات" }).click();

  return piNumber;
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

test.describe("Sales Returns", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  // A stock-item return needs real on-hand qty in the exact warehouse the
  // sales invoice draws from — service items sidestep that dependency (see
  // sales-invoices.spec.ts) and, being non-stock, correctly have nothing
  // returnable, which this test verifies directly.
  test("a confirmed invoice with only a service line has no returnable stock lines", async ({ page }) => {
    const customerName = unique("عميل مرتجع مبيعات");
    const itemName = unique("صنف خدمي مرتجع");
    await createCustomer(page, customerName);
    await createItem(page, itemName, "80", "service");
    const docNo = await createConfirmedSalesInvoice(page, customerName, itemName);

    await clickSidebarItem(page, "مرتجعات المبيعات");
    await expect(page.getByRole("heading", { name: "مرتجعات المبيعات" })).toBeVisible();
    await page.getByRole("button", { name: "مرتجع جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مرتجع مبيعات جديد" });

    await selectOptionContaining(dialog.getByLabel("فاتورة المصدر *"), docNo);
    await expect(dialog.getByText("لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة")).toBeVisible();

    await dialog.getByRole("button", { name: "حفظ وتأكيد" }).click();
    await expect(dialog.getByText("أضف بنداً واحداً على الأقل بكمية أكبر من صفر.")).toBeVisible();
  });
});

test.describe("Purchase Returns", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  // BUG (verified against the real API): PurchaseOrdersScreen.tsx and
  // PurchaseInvoicesScreen.tsx hardcode `warehouseId: "MAIN-WH"` when
  // creating orders/invoices, but the seeded tenant's real warehouse id is
  // "WH-MAIN" (packages/backend/src/seed.ts's SEED_MAIN_WAREHOUSE_ID) — a
  // transposed typo. So a GRN's stock increase lands under the wrong,
  // non-existent "MAIN-WH" id, and anything that correctly reads/decreases
  // stock in the real "WH-MAIN" (this return's own default warehouse picker
  // included) always sees zero on-hand — confirming any purchase return of
  // a stock item fails with a false negative-stock rejection, no matter how
  // much was actually received. This test documents that real, current
  // behavior rather than a fictitious success.
  test("BUG: confirming a return against a just-received stock item falsely reports zero on-hand (warehouse id mismatch)", async ({ page }) => {
    const supplierName = unique("مورد مرتجع شراء");
    const itemName = unique("صنف مخزون مرتجع");
    await createSupplier(page, supplierName);
    await createItem(page, itemName, "50", "stock");
    const piNumber = await createConfirmedPurchaseInvoice(page, supplierName, itemName);

    await clickSidebarItem(page, "مرتجعات المشتريات");
    await expect(page.getByRole("heading", { name: "مرتجعات المشتريات" })).toBeVisible();
    await page.getByRole("button", { name: "مرتجع جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مرتجع مشتريات جديد" });

    await selectOptionContaining(dialog.getByLabel("الفاتورة الأصلية *"), piNumber);
    await expect(dialog.getByLabel("الصنف")).toHaveValue(/.+/);
    await dialog.getByLabel("الكمية").fill("3");
    await dialog.getByRole("button", { name: "حفظ وتأكيد" }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/would drive on-hand \(0\.000000\) below zero/)).toBeVisible();
  });
});
