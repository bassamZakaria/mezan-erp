import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * Sales Returns (مرتجعات المبيعات) and Purchase Returns (مرتجعات المشتريات)
 * — apps/web/src/screens/SalesReturnsScreen.tsx / PurchaseReturnsScreen.tsx.
 * Both are real API-backed (draft → confirmed against a confirmed source
 * invoice), so tests create their own customer/supplier/item/invoice
 * prerequisites first. Neither list has a search box, but `page`/`pageCount`
 * are hardcoded to 1 (no real pagination), so every row renders — isolated
 * per test via a `table tbody tr` text filter on a unique name.
 *
 * As of the current build, Sales Invoices / Purchase Orders / Goods Receipts /
 * Purchase Invoices are all full sub-PAGES with a "طريقة الإنشاء" (creation
 * method) step and a "متابعة" continue button — see sales-invoices.spec.ts
 * and purchase-chain.spec.ts, whose helper patterns this file mirrors.
 * المورد/العميل/الصنف/أمر الشراء/إيصال الاستلام are all the portaled
 * `Select` combobox (packages/ui/src/primitives/Select.tsx, chosen via
 * click + `role="option"`), not the free-text EntityPicker.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createCustomer(page: Page, name: string): Promise<void> {
  await clickSidebarItem(page, "العملاء");
  await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة عميل" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة عميل" });
  await brokenLabelField(form, "اسم العميل *").fill(name);
  await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
  await expect(form).toBeHidden();
}

async function createSupplier(page: Page, name: string): Promise<void> {
  await clickSidebarItem(page, "الموردون");
  await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة مورد" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة مورد" });
  await brokenLabelField(form, "اسم المورد *").fill(name);
  await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();
  await expect(form).toBeHidden();
}

async function createItem(page: Page, name: string, salePrice: string, type: "stock" | "service"): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).first().click();
  await expect(page.getByRole("heading", { name: "إضافة صنف", level: 1 })).toBeVisible();
  if (type === "service") {
    await page.getByRole("combobox", { name: "نوع الصنف" }).click();
    await page.getByRole("option", { name: "خدمة" }).click();
  }
  await page.getByLabel("اسم الصنف *").fill(name);
  const price = page.getByLabel("سعر البيع");
  await price.fill(salePrice);
  await price.press("Tab");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
}

/** Clicks a `Select` primitive's combobox trigger, then the matching portaled option. */
async function chooseCombo(page: Page, comboLabel: string, optionName: string | RegExp): Promise<void> {
  await page.getByRole("combobox", { name: comboLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

function uniqueRow(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({ hasText: text });
}

/** Creates + confirms a PO → GRN → Purchase Invoice chain, returning the confirmed invoice's number (e.g. "PI-000042"). */
async function createConfirmedPurchaseInvoice(page: Page, supplierName: string, itemName: string): Promise<string> {
  await clickSidebarItem(page, "أوامر الشراء");
  await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();
  await page.getByRole("button", { name: "أمر شراء جديد" }).first().click();
  await expect(page.getByRole("heading", { name: "أمر شراء جديد", level: 1 })).toBeVisible();
  await chooseCombo(page, "المورد *", supplierName);
  await chooseCombo(page, "الصنف", itemName);
  await brokenLabelField(page, "الكمية").fill("20");
  await brokenLabelField(page, "سعر الوحدة").fill("40");
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم الأمر أو اسم المورد…").fill(supplierName);
  let row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const poNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد وإرسال" }).click();
  await expect(page.getByText("مرسل").first()).toBeVisible();
  await page.getByRole("button", { name: "رجوع إلى أوامر الشراء" }).click();

  await clickSidebarItem(page, "استلام البضائع");
  await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();
  await page.getByRole("button", { name: "إيصال استلام جديد" }).first().click();
  await expect(page.getByRole("heading", { name: "إيصال استلام جديد", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "متابعة" }).click();
  await chooseCombo(page, "أمر الشراء *", new RegExp(poNumber));
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم الإيصال أو المورد…").fill(supplierName);
  row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const grNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد الاستلام" }).click();
  await expect(page.getByText(/تمت زيادة كمية المخزون/)).toBeVisible();
  await page.getByRole("button", { name: "رجوع إلى استلام البضائع" }).click();

  await clickSidebarItem(page, "فواتير المشتريات");
  await expect(page.getByRole("heading", { name: "فواتير المشتريات" })).toBeVisible();
  await page.getByRole("button", { name: "فاتورة مشتريات جديدة" }).first().click();
  await expect(page.getByRole("heading", { name: "فاتورة مشتريات جديدة", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^من إيصال استلام/ }).click();
  await page.getByRole("button", { name: "متابعة" }).click();
  await chooseCombo(page, "إيصال الاستلام *", new RegExp(grNumber));
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page.getByRole("heading", { name: "فواتير المشتريات" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم الفاتورة أو اسم المورد…").fill(supplierName);
  row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const piNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(page.getByText(/تمّت إضافة الأصناف للمخزون سابقاً/)).toBeVisible();
  await page.getByRole("button", { name: /^رجوع إلى/ }).click();

  return piNumber;
}

async function createConfirmedSalesInvoice(page: Page, customerName: string, itemName: string): Promise<string> {
  await clickSidebarItem(page, "فواتير المبيعات");
  await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  await page.getByRole("button", { name: "فاتورة جديدة" }).first().click();
  await expect(page.getByRole("heading", { name: "فاتورة مبيعات جديدة", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "متابعة" }).click();
  await chooseCombo(page, "العميل *", customerName);
  await chooseCombo(page, "الصنف — سطر 1", itemName);
  await page.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

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
    await page.getByRole("button", { name: "مرتجع جديد" }).first().click();
    // Create is a full sub-PAGE (h1 "مرتجع مبيعات جديد"), not a dialog.
    await expect(page.getByRole("heading", { name: "مرتجع مبيعات جديد", level: 1 })).toBeVisible();

    await chooseCombo(page, "فاتورة المصدر *", new RegExp(docNo));
    await expect(page.getByText("لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة")).toBeVisible();

    await page.getByRole("button", { name: "حفظ وتأكيد" }).click();
    await expect(page.getByText("أضف بنداً واحداً على الأقل بكمية أكبر من صفر.")).toBeVisible();
  });
});

test.describe("Purchase Returns", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("confirming a return against a just-received stock item reduces on-hand stock", async ({ page }) => {
    const supplierName = unique("مورد مرتجع شراء");
    const itemName = unique("صنف مخزون مرتجع");
    await createSupplier(page, supplierName);
    await createItem(page, itemName, "50", "stock");
    const piNumber = await createConfirmedPurchaseInvoice(page, supplierName, itemName);

    await clickSidebarItem(page, "مرتجعات المشتريات");
    await expect(page.getByRole("heading", { name: "مرتجعات المشتريات" })).toBeVisible();
    await page.getByRole("button", { name: "مرتجع جديد" }).first().click();
    // Create is a full sub-PAGE (h1 "مرتجع مشتريات جديد"), not a dialog.
    await expect(page.getByRole("heading", { name: "مرتجع مشتريات جديد", level: 1 })).toBeVisible();

    await chooseCombo(page, "الفاتورة الأصلية *", new RegExp(piNumber));
    // Pre-filled from the invoice's first returnable line — a portaled
    // combobox (packages/ui/src/primitives/Select.tsx), not a native input,
    // so its chosen value shows as the trigger's own text, not a DOM value.
    await expect(page.getByRole("combobox", { name: "الصنف" })).toContainText(itemName);
    // "الكمية" here is a NumberField from the broken `../settings/form-controls`
    // wrapper (e2e/support/broken-label.ts) — unlike الصنف (a SelectField,
    // fine with getByLabel).
    await brokenLabelField(page, "الكمية").fill("3");
    await page.getByRole("button", { name: "حفظ وتأكيد" }).click();

    await expect(page.getByRole("heading", { name: "مرتجعات المشتريات" })).toBeVisible();
    await clickSidebarItem(page, "الأصناف");
    await page.getByPlaceholder("بحث بالاسم أو الكود...").fill(itemName);
    await page.locator("table tbody tr").filter({ hasText: itemName }).click();
    await page.getByRole("tab", { name: "المخزون" }).click();
    // Received 20, returned 3 — 17 should remain on hand.
    await expect(page.getByRole("tabpanel").getByText(/17/).first()).toBeVisible();
  });
});
