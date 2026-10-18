import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";
import {
  apiGet,
  creditOn,
  debitOn,
  expectPostedEntryOf,
  journalEntriesForDocument,
  journalEntry,
  microUnits,
} from "./support/ledger";

const TRADE_RECEIVABLES = "1105";

interface ControlAccountCheck {
  readonly key: string;
  readonly difference: string;
  readonly matched: boolean;
}

/**
 * Sales Invoices (فواتير المبيعات) — real API-backed screen
 * (apps/web/src/screens/SalesInvoicesScreen.tsx), list/create/confirm +
 * the "تأثيرات هذه الفاتورة" effects panel + status.
 *
 * The e2e backend starts as a genuinely empty tenant (packages/backend/src/
 * seed.ts seeds only the chart of accounts, VAT rate, one branch/warehouse,
 * and the admin user — no customers, items, or invoices), so every test
 * creates its own customer + item first via the real Customers/Items
 * screens, then drives a real create → confirm flow against the
 * sales-invoices API. Assertions avoid absolute list counts / exact next
 * doc numbers since the backend is shared with other e2e spec files
 * running in parallel — each test isolates its own row via a unique
 * customer/item name instead.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createCustomer(page: Page, name: string): Promise<void> {
  await clickSidebarItem(page, "العملاء");
  await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
  // The header's "إضافة عميل" is always in the DOM; the empty-state region
  // renders a second button with the exact same label whenever the list
  // reads zero rows (the e2e tenant starts with none) — .first() is the
  // header's, always present.
  await page.getByRole("button", { name: "إضافة عميل" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة عميل" });
  // The name field is built through the broken `../settings/form-controls`
  // TextField (see e2e/support/broken-label.ts) — its `<label>` has no
  // `htmlFor`.
  await brokenLabelField(form, "اسم العميل *").fill(name);
  await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
  await expect(form).toBeHidden();
}

async function createTreasuryAccount(page: Page, name: string, code: string): Promise<void> {
  await clickSidebarItem(page, "حسابات الخزينة");
  await expect(page.getByRole("heading", { name: "حسابات الخزينة" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة حساب" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة حساب" });
  await brokenLabelField(form, "اسم الحساب *").fill(name);
  await brokenLabelField(form, "الكود *").fill(code);
  // The GL-account field auto-picks by type when left blank per its own
  // hint — filled explicitly here with the seeded main cash leaf rather than
  // relying on that (see treasury-vouchers.spec.ts for the documented defect
  // when it's left blank).
  await brokenLabelField(form, "حساب دفتر الأستاذ").fill("1300-1");
  await form.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(form).toBeHidden();
}

async function createItem(page: Page, name: string, salePrice: string): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).first().click();
  // Items' add/edit is a full sub-PAGE, not a dialog — and its "نوع الصنف"
  // field is a custom portaled `Select` (packages/ui/src/primitives/Select.tsx),
  // not a native `<select>`, so it is chosen by clicking the combobox then
  // its option, not `.selectOption()`.
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

/** Types into an EntityPicker combobox and clicks the matching option button. */
async function pickEntity(scope: Page | Locator, label: string, query: string): Promise<void> {
  const input = scope.getByLabel(label);
  await input.click();
  await input.fill(query);
  await scope.getByRole("button", { name: new RegExp(query) }).first().click();
}

test.describe("Sales Invoices", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("confirm and save-as-draft stay disabled until a customer and a positive line are set", async ({ page }) => {
    await clickSidebarItem(page, "فواتير المبيعات");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

    await page.getByRole("button", { name: "فاتورة جديدة" }).first().click();
    // Create is a full sub-PAGE (h1 "فاتورة مبيعات جديدة"), not a dialog, and
    // opens on a creation-method step ("إدخال بنود يدوياً" is the default,
    // already pressed) before "متابعة" reveals the actual line-item form.
    await expect(page.getByRole("heading", { name: "فاتورة مبيعات جديدة", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "متابعة", exact: true }).click();

    await expect(page.getByRole("button", { name: "تأكيد الفاتورة" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "حفظ كمسودة" })).toBeDisabled();
  });

  test("creates and confirms an invoice, shows the effects panel + GL/payments tabs, and records a partial payment", async ({ page }) => {
    const customerName = unique("عميل فاتورة");
    const itemName = unique("صنف فاتورة");
    const treasuryName = unique("صندوق تحصيل فاتورة");
    const treasuryCode = `CASH-${Date.now() % 100000}`;

    await createCustomer(page, customerName);
    await createItem(page, itemName, "100");
    await createTreasuryAccount(page, treasuryName, treasuryCode);

    await clickSidebarItem(page, "فواتير المبيعات");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

    await page.getByRole("button", { name: "فاتورة جديدة" }).first().click();
    await expect(page.getByRole("heading", { name: "فاتورة مبيعات جديدة", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "متابعة", exact: true }).click();

    await pickEntity(page, "العميل *", customerName);
    await pickEntity(page, "الصنف — سطر 1", itemName);

    const confirmButton = page.getByRole("button", { name: "تأكيد الفاتورة" });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

    // Isolate our invoice via the search box — the backend is shared with
    // other parallel specs, so total counts / exact next numbers aren't safe.
    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill(customerName);
    const row = page.locator("table tbody tr").filter({ hasText: customerName });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("مؤكد", { exact: true })).toBeVisible();

    await row.click();
    const invoiceHeading = page.getByRole("heading", { name: /^INV-\d+$/ });
    await expect(invoiceHeading).toBeVisible();
    const invoiceNo = (await invoiceHeading.innerText()).trim();

    // «مؤكد» with no entry behind it is the defect, not the proof (D2, D3): one
    // line at 100.00 plus the default 14% VAT must sit on trade receivables.
    const invoiceEntries = await journalEntriesForDocument(page, invoiceNo);
    expect(invoiceEntries, `journal entries posted for ${invoiceNo}`).toHaveLength(1);
    expectPostedEntryOf(invoiceEntries[0]!, "114");
    expect(debitOn(invoiceEntries[0]!, TRADE_RECEIVABLES)).toBe(microUnits("114"));

    await expect(page.getByText("تأثيرات هذه الفاتورة")).toBeVisible();
    await expect(page.getByText(/تم صرف الأصناف المخزنية/)).toBeVisible();
    await expect(page.getByRole("tab", { name: "بنود الفاتورة" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "القيود المحاسبية" })).toBeVisible();

    await page.getByRole("tab", { name: "المدفوعات" }).click();
    await page.getByLabel("قيمة الدفعة").fill("40");
    // "الخزينة المستلمة" is the portaled `Select` combobox, not an
    // EntityPicker — chosen by clicking it then its option.
    await page.getByRole("combobox", { name: "الخزينة المستلمة" }).click();
    await page.getByRole("option", { name: treasuryName }).click();
    const collected = page.waitForResponse((r) => r.request().method() === "POST" && /\/sales-invoices\/[^/]+\/payments$/.test(new URL(r.url()).pathname));
    await page.getByRole("button", { name: "تحصيل دفعة" }).click();
    const collectionResponse = await collected;
    expect(collectionResponse.status()).toBe(200);
    const paid = (await collectionResponse.json()) as { voucherId: string; amountPaid: string };
    expect(microUnits(paid.amountPaid)).toBe(microUnits("40"));
    const collection = await apiGet<{ status: string; journalEntryId: string | null; treasuryGlAccountId: string }>(
      page,
      `/vouchers/${paid.voucherId}`,
    );

    await expect(page.getByText("مدفوع جزئياً").first()).toBeVisible();

    // «مدفوع جزئياً» used to be a flag flipped with nothing posted (D40). The 40.00
    // has to be in the drawer's GL account and off trade receivables — and the
    // customer sub-ledger still has to tie to its control account afterwards.
    expect(collection.status).toBe("confirmed");
    expect(collection.journalEntryId, "the collection must carry its journal entry").toBeTruthy();
    const collectionEntry = await journalEntry(page, collection.journalEntryId!);
    expectPostedEntryOf(collectionEntry, "40");
    expect(debitOn(collectionEntry, collection.treasuryGlAccountId)).toBe(microUnits("40"));
    expect(creditOn(collectionEntry, TRADE_RECEIVABLES)).toBe(microUnits("40"));
    const { rows: controls } = await apiGet<{ rows: ControlAccountCheck[] }>(page, "/reconciliation");
    const receivables = controls.find((c) => c.key === "ar");
    expect(receivables, "the AR row of the reconciliation").toBeTruthy();
    expect(microUnits(receivables!.difference), "customer sub-ledger vs GL 1105").toBe(0n);

    await page.getByRole("button", { name: "رجوع" }).click();
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  });
});
