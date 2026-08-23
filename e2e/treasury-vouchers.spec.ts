import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Treasury Vouchers (السندات النقدية) — real API-backed screen
 * (apps/web/src/screens/TreasuryVouchersScreen.tsx). Covers the voucher
 * type picker, a receipt voucher funding a cash account and a payment
 * voucher drawing on it, and the "allocate on an open invoice" UI.
 *
 * The e2e backend starts as an empty tenant — no treasury accounts,
 * customers, suppliers, items, or invoices — so tests create their own
 * prerequisites via the real screens first. `customer_collection` and
 * `supplier_payment` are used for the type coverage because their GL
 * counterparty account is fixed by the domain layer (trade
 * receivables/payables), unlike `other_income`/`other_expense` which need a
 * user-picked account from the live chart of accounts — avoided here to
 * keep the flow deterministic.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createTreasuryAccount(page: Page, name: string, code: string): Promise<void> {
  await clickSidebarItem(page, "حسابات الخزينة");
  await expect(page.getByRole("heading", { name: "حسابات الخزينة" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة حساب" }).click();
  const form = page.getByRole("dialog", { name: "إضافة حساب" });
  await form.getByLabel("اسم الحساب *").fill(name);
  await form.getByLabel("الكود *").fill(code);
  // BUG: despite the field's own hint claiming the system auto-picks a GL
  // account by type ("لا تحتاج إلى تعبئة هذا الحقل غالباً..."), leaving it
  // blank actually persists glAccountId: null server-side — and every
  // voucher drawn against that treasury account then fails create-voucher's
  // server-side validation ("treasuryGlAccountId: String must contain at
  // least 1 character(s)"), surfaced to the user only as a generic "تعذر
  // إنشاء السند." toast. Filling the standard COA's main cash-box leaf here
  // works around it (seedStandardChartOfAccounts's 1300-1 "صندوق نقدي الفرع
  // الرئيسي", the cash leaf under 1300 "النقدية").
  await form.getByLabel("حساب دفتر الأستاذ").fill("1300-1");
  await form.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(form).toBeHidden();
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

async function createItem(page: Page, name: string, salePrice: string): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).click();
  const form = page.getByRole("dialog", { name: "إضافة صنف" });
  // A freshly-created stock item has zero on-hand qty, and the real
  // sales-invoice confirm path refuses to drive stock negative — service
  // items skip inventory tracking entirely, so they stay sellable right away.
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

/** The customer/supplier picker on the voucher create screen isn't a `<label>` — matched by placeholder instead. */
async function pickParty(page: Page, placeholder: string, query: string): Promise<void> {
  const input = page.getByPlaceholder(placeholder);
  await input.click();
  await input.fill(query);
  await page.getByRole("button", { name: new RegExp(query) }).first().click();
}

async function createConfirmedSalesInvoice(page: Page, customerName: string, itemName: string): Promise<void> {
  await clickSidebarItem(page, "فواتير المبيعات");
  await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  await page.getByRole("button", { name: "فاتورة جديدة" }).click();
  const dialog = page.getByRole("dialog", { name: "فاتورة مبيعات جديدة" });
  await pickEntity(dialog, "العميل *", customerName);
  await pickEntity(dialog, "الصنف — سطر 1", itemName);
  await dialog.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(dialog).toBeHidden();
}

function uniqueRow(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({ hasText: text });
}

test.describe("Treasury Vouchers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("the type picker lists the receipt/payment/transfer voucher types", async ({ page }) => {
    await clickSidebarItem(page, "السندات النقدية");
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    await page.getByRole("button", { name: "سند جديد" }).click();
    await expect(page.getByRole("heading", { name: "اختر نوع السند" })).toBeVisible();
    await expect(page.getByText("تحصيل من عميل", { exact: true })).toBeVisible();
    await expect(page.getByText("دفع لمورد", { exact: true })).toBeVisible();
    await expect(page.getByText("تحويل بين الخزائن", { exact: true })).toBeVisible();
    await expect(page.getByText("إيراد آخر", { exact: true })).toBeVisible();
    await expect(page.getByText("مصروف آخر", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "إلغاء" }).click();
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();
  });

  test("a customer-collection voucher funds a cash account, then a supplier-payment voucher draws on it", async ({ page }) => {
    const treasuryName = unique("صندوق اختبار");
    const treasuryCode = `CASH-${Date.now() % 100000}`;
    const customerName = unique("عميل سند تحصيل");
    const supplierName = unique("مورد سند دفع");

    await createTreasuryAccount(page, treasuryName, treasuryCode);
    await createCustomer(page, customerName);
    await createSupplier(page, supplierName);

    await clickSidebarItem(page, "السندات النقدية");
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    // Receipt: تحصيل من عميل — deposits 1000 into the cash account's GL leaf.
    await page.getByRole("button", { name: "سند جديد" }).click();
    await page.getByText("تحصيل من عميل", { exact: true }).click();
    await page.getByLabel("المبلغ").fill("1000");
    await pickParty(page, "ابحث عن عميل…", customerName);
    await page.getByRole("button", { name: "إنشاء وتأكيد" }).click();
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    await page.getByPlaceholder("ابحث برقم السند، المرجع، العميل، المورد…").fill(customerName);
    const receiptRow = uniqueRow(page, customerName);
    await expect(receiptRow).toHaveCount(1);
    await expect(receiptRow.getByText(/^CV-\d+$/)).toBeVisible();
    await expect(receiptRow.getByText("مؤكد", { exact: true })).toBeVisible();

    // Payment: دفع لمورد — the cash guard now allows it (balance 1000 ≥ 500).
    await page.getByPlaceholder("ابحث برقم السند، المرجع، العميل، المورد…").fill("");
    await page.getByRole("button", { name: "سند جديد" }).click();
    await page.getByText("دفع لمورد", { exact: true }).click();
    await page.getByLabel("المبلغ").fill("500");
    await pickParty(page, "ابحث عن مورّد…", supplierName);
    await page.getByRole("button", { name: "إنشاء وتأكيد" }).click();
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    await page.getByPlaceholder("ابحث برقم السند، المرجع، العميل، المورد…").fill(supplierName);
    const paymentRow = uniqueRow(page, supplierName);
    await expect(paymentRow).toHaveCount(1);
    await expect(paymentRow.getByText(/^CV-\d+$/)).toBeVisible();
    await expect(paymentRow.getByText("مؤكد", { exact: true })).toBeVisible();
  });

  // BUG (verified against the API directly — GET /open-invoices returns []
  // for a party with a real, confirmed, unpaid sales invoice): the
  // allocation UI's "open invoices" list is backed by a standalone
  // `open_invoice` SQLite table (packages/persistence/src/voucher-store.ts's
  // SqliteInvoiceRepository) that only a row's own `.save()` call can
  // populate — and nothing in packages/backend/src ever calls it when a
  // real sales/purchase invoice is confirmed. So "allocate on an open
  // invoice" can never find a real invoice in the current build, no matter
  // how it was created — this test documents that actual, current behavior.
  test("BUG: a confirmed sales invoice never appears as an open invoice to allocate a voucher against", async ({ page }) => {
    const treasuryName = unique("صندوق تخصيص");
    const treasuryCode = `CASH-${Date.now() % 100000}`;
    const customerName = unique("عميل بلا تخصيص");
    const itemName = unique("صنف بلا تخصيص");

    await createTreasuryAccount(page, treasuryName, treasuryCode);
    await createCustomer(page, customerName);
    await createItem(page, itemName, "100");
    await createConfirmedSalesInvoice(page, customerName, itemName);

    await clickSidebarItem(page, "السندات النقدية");
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();
    await page.getByRole("button", { name: "سند جديد" }).click();
    await page.getByText("تحصيل من عميل", { exact: true }).click();
    await page.getByLabel("المبلغ").fill("100");
    await pickParty(page, "ابحث عن عميل…", customerName);
    await page.getByRole("button", { name: "إنشاء وتأكيد" }).click();
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    await page.getByPlaceholder("ابحث برقم السند، المرجع، العميل، المورد…").fill(customerName);
    const row = uniqueRow(page, customerName);
    await expect(row).toHaveCount(1);
    await row.click();

    await expect(page.getByText("تأثيرات هذا السند")).toBeVisible();
    await page.getByRole("tab", { name: /تخصيص على الفواتير/ }).click();
    await expect(page.getByText("بحاجة لتخصيص", { exact: true }).first()).toBeVisible();
    // The confirmed invoice created above has a 100 EGP outstanding balance
    // for this exact customer — it should be selectable here, but isn't.
    await expect(page.getByText("لا توجد فواتير مفتوحة لهذا الطرف.")).toBeVisible();
    await expect(page.getByLabel("الفاتورة")).toHaveCount(0);
  });
});
