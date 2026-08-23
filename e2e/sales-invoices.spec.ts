import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

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

/** Types into an EntityPicker combobox and clicks the matching option button. */
async function pickEntity(scope: Locator, label: string, query: string): Promise<void> {
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

    await page.getByRole("button", { name: "فاتورة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "فاتورة مبيعات جديدة" });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole("button", { name: "تأكيد الفاتورة" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "حفظ كمسودة" })).toBeDisabled();
  });

  test("creates and confirms an invoice, shows the effects panel + GL/payments tabs, and records a partial payment", async ({ page }) => {
    const customerName = unique("عميل فاتورة");
    const itemName = unique("صنف فاتورة");

    await createCustomer(page, customerName);
    await createItem(page, itemName, "100");

    await clickSidebarItem(page, "فواتير المبيعات");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

    await page.getByRole("button", { name: "فاتورة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "فاتورة مبيعات جديدة" });

    await pickEntity(dialog, "العميل *", customerName);
    await pickEntity(dialog, "الصنف — سطر 1", itemName);

    const confirmButton = dialog.getByRole("button", { name: "تأكيد الفاتورة" });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(dialog).toBeHidden();

    // Isolate our invoice via the search box — the backend is shared with
    // other parallel specs, so total counts / exact next numbers aren't safe.
    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill(customerName);
    const row = page.locator("table tbody tr").filter({ hasText: customerName });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("مؤكد", { exact: true })).toBeVisible();

    await row.click();
    await expect(page.getByRole("heading", { name: /^INV-\d+$/ })).toBeVisible();

    await expect(page.getByText("تأثيرات هذه الفاتورة")).toBeVisible();
    await expect(page.getByText(/تم صرف الأصناف المخزنية/)).toBeVisible();
    await expect(page.getByRole("tab", { name: "بنود الفاتورة" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "القيود المحاسبية" })).toBeVisible();

    await page.getByRole("tab", { name: "المدفوعات" }).click();
    await page.getByLabel("قيمة الدفعة").fill("40");
    await page.getByRole("button", { name: "تحصيل دفعة" }).click();

    await expect(page.getByText("مدفوع جزئياً").first()).toBeVisible();

    await page.getByRole("button", { name: "رجوع" }).click();
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  });
});
