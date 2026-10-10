import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";
import { creditOn, debitOn, expectPostedEntryOf, journalEntry, microUnits } from "./support/ledger";

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

const TRADE_RECEIVABLES = "1105";
const TRADE_PAYABLES = "2100";

interface ConfirmedVoucher {
  readonly id: string;
  readonly docNo: string;
  readonly status: string;
  readonly journalEntryId: string | null;
  readonly treasuryGlAccountId: string;
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createTreasuryAccount(page: Page, name: string, code: string): Promise<void> {
  await clickSidebarItem(page, "حسابات الخزينة");
  await expect(page.getByRole("heading", { name: "حسابات الخزينة" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة حساب" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة حساب" });
  await brokenLabelField(form, "اسم الحساب *").fill(name);
  await brokenLabelField(form, "الكود *").fill(code);
  // BUG: despite the field's own hint claiming the system auto-picks a GL
  // account by type ("لا تحتاج إلى تعبئة هذا الحقل غالباً..."), leaving it
  // blank actually persists glAccountId: null server-side — and every
  // voucher drawn against that treasury account then fails create-voucher's
  // server-side validation ("treasuryGlAccountId: String must contain at
  // least 1 character(s)"), surfaced to the user only as a generic "تعذر
  // إنشاء السند." toast. Filling the standard COA's main cash-box leaf here
  // works around it (seedStandardChartOfAccounts's 1300-1 "صندوق نقدي الفرع
  // الرئيسي", the cash leaf under 1300 "النقدية").
  await brokenLabelField(form, "حساب دفتر الأستاذ").fill("1300-1");
  await form.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(form).toBeHidden();
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

async function createItem(page: Page, name: string, salePrice: string): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).first().click();
  // Items' add/edit is a full sub-PAGE, not a dialog, and its "نوع الصنف"
  // field is a portaled `Select` combobox, chosen by clicking it then its
  // option, not `.selectOption()`.
  await expect(page.getByRole("heading", { name: "إضافة صنف", level: 1 })).toBeVisible();
  // A freshly-created stock item has zero on-hand qty, and the real
  // sales-invoice confirm path refuses to drive stock negative — service
  // items skip inventory tracking entirely, so they stay sellable right away.
  await page.getByRole("combobox", { name: "نوع الصنف" }).click();
  await page.getByRole("option", { name: "خدمة" }).click();
  await page.getByLabel("اسم الصنف *").fill(name);
  const price = page.getByLabel("سعر البيع");
  await price.fill(salePrice);
  await price.press("Tab");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
}

async function pickEntity(scope: Page | Locator, label: string, query: string): Promise<void> {
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
  await page.getByRole("button", { name: "فاتورة جديدة" }).first().click();
  // Create is a full sub-PAGE with a "طريقة الإنشاء" step, not a dialog —
  // see sales-invoices.spec.ts.
  await expect(page.getByRole("heading", { name: "فاتورة مبيعات جديدة", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "متابعة" }).click();
  await pickEntity(page, "العميل *", customerName);
  await pickEntity(page, "الصنف — سطر 1", itemName);
  await page.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
}

/** The voucher-type card on «اختر نوع السند» — the list behind it shows the same label in its type column (D230). */
function voucherTypeCard(page: Page, label: string): Locator {
  return page.getByRole("button").filter({ has: page.getByText(label, { exact: true }) });
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

    await page.getByRole("button", { name: "سند جديد" }).first().click();
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
    const treasuryCode = `CASH-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const customerName = unique("عميل سند تحصيل");
    const supplierName = unique("مورد سند دفع");

    await createTreasuryAccount(page, treasuryName, treasuryCode);
    await createCustomer(page, customerName);
    await createSupplier(page, supplierName);

    await clickSidebarItem(page, "السندات النقدية");
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    // Receipt: تحصيل من عميل — deposits 1000 into the cash account's GL leaf.
    await page.getByRole("button", { name: "سند جديد" }).first().click();
    await voucherTypeCard(page, "تحصيل من عميل").click();
    await page.getByLabel("المبلغ").fill("1000");
    await pickParty(page, "ابحث عن عميل…", customerName);
    // «إنشاء وتأكيد» on a customer collection is ONE atomic call now —
    // POST /vouchers/collections creates, confirms and posts in a single
    // transaction — where it used to be a create POST chained to a confirm
    // POST. Supplier payments below still take the two-step path.
    const collected = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/vouchers/collections"));
    const refetched = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname.endsWith("/vouchers"));
    await page.getByRole("button", { name: "إنشاء وتأكيد" }).click();
    const collectionResponse = await collected;
    expect(collectionResponse.status()).toBe(201);
    const receipt = ((await collectionResponse.json()) as { voucher: ConfirmedVoucher }).voucher;
    await refetched;
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    await page.getByPlaceholder("ابحث برقم السند، المرجع، العميل، المورد…").fill(customerName);
    const receiptRow = uniqueRow(page, customerName);
    await expect(receiptRow).toHaveCount(1);
    await expect(receiptRow.getByText(receipt.docNo, { exact: true })).toBeVisible();
    await expect(receiptRow.getByText("مؤكد", { exact: true })).toBeVisible();

    // «مؤكد» is a claim; the entry is the fact. Cash in, trade receivables down.
    expect(receipt.status).toBe("confirmed");
    expect(receipt.journalEntryId, "a confirmed collection must carry its journal entry").toBeTruthy();
    const receiptEntry = await journalEntry(page, receipt.journalEntryId!);
    expectPostedEntryOf(receiptEntry, "1000");
    expect(debitOn(receiptEntry, receipt.treasuryGlAccountId)).toBe(microUnits("1000"));
    expect(creditOn(receiptEntry, TRADE_RECEIVABLES)).toBe(microUnits("1000"));

    // Payment: دفع لمورد — the cash guard now allows it (balance 1000 ≥ 500).
    await page.getByPlaceholder("ابحث برقم السند، المرجع، العميل، المورد…").fill("");
    await page.getByRole("button", { name: "سند جديد" }).first().click();
    await voucherTypeCard(page, "دفع لمورد").click();
    await page.getByLabel("المبلغ").fill("500");
    await pickParty(page, "ابحث عن مورّد…", supplierName);
    const paymentConfirmed = page.waitForResponse((r) => r.request().method() === "POST" && /\/vouchers\/[^/]+\/confirm$/.test(new URL(r.url()).pathname));
    const paymentRefetched = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname.endsWith("/vouchers"));
    await page.getByRole("button", { name: "إنشاء وتأكيد" }).click();
    const paymentResponse = await paymentConfirmed;
    expect(paymentResponse.status()).toBe(200);
    const payment = (await paymentResponse.json()) as ConfirmedVoucher;
    await paymentRefetched;
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();

    await page.getByPlaceholder("ابحث برقم السند، المرجع، العميل، المورد…").fill(supplierName);
    const paymentRow = uniqueRow(page, supplierName);
    await expect(paymentRow).toHaveCount(1);
    await expect(paymentRow.getByText(payment.docNo, { exact: true })).toBeVisible();
    await expect(paymentRow.getByText("مؤكد", { exact: true })).toBeVisible();

    // Trade payables down, cash out — and by exactly what the voucher says.
    expect(payment.status).toBe("confirmed");
    expect(payment.journalEntryId, "a confirmed payment must carry its journal entry").toBeTruthy();
    const paymentEntry = await journalEntry(page, payment.journalEntryId!);
    expectPostedEntryOf(paymentEntry, "500");
    expect(debitOn(paymentEntry, TRADE_PAYABLES)).toBe(microUnits("500"));
    expect(creditOn(paymentEntry, payment.treasuryGlAccountId)).toBe(microUnits("500"));
  });

  // Previously documented as a defect (open_invoice's SqliteInvoiceRepository
  // populated by nothing) — now fixed: apps/web packages/backend/src/
  // create-backend.ts wires `allocatable: vouchers.invoices` into the sales-
  // and purchase-invoice services, so a confirm now really does save the
  // invoice as an open, allocatable one.
  test("a confirmed sales invoice appears as an open invoice, and allocating a voucher against it fully settles it", async ({ page }) => {
    const treasuryName = unique("صندوق تخصيص");
    const treasuryCode = `CASH-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const customerName = unique("عميل تخصيص فاتورة");
    const itemName = unique("صنف تخصيص فاتورة");

    await createTreasuryAccount(page, treasuryName, treasuryCode);
    await createCustomer(page, customerName);
    await createItem(page, itemName, "100");
    await createConfirmedSalesInvoice(page, customerName, itemName);

    await clickSidebarItem(page, "السندات النقدية");
    await expect(page.getByRole("heading", { name: "السندات النقدية" })).toBeVisible();
    await page.getByRole("button", { name: "سند جديد" }).first().click();
    await voucherTypeCard(page, "تحصيل من عميل").click();
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
    // for this exact customer, and is now selectable.
    await page.getByRole("combobox", { name: "الفاتورة" }).click();
    await page.getByRole("option", { name: /INV-\d+/ }).click();
    // MoneyInput (packages/ui/src/primitives/MoneyInput.tsx) only commits its
    // draft to state onBlur — the allocate button's disabled state reads that
    // committed value, so a Tab is needed before it enables.
    const allocAmount = page.getByLabel("مبلغ التخصيص");
    await allocAmount.fill("100");
    await allocAmount.press("Tab");
    await page.getByRole("button", { name: "تخصيص", exact: true }).click();

    await expect(page.getByText("مخصّص بالكامل").first()).toBeVisible();
  });
});
