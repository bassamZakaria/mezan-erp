import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Purchase chain — Purchase Order → Goods Receipt → Purchase Invoice
 * (apps/web/src/screens/PurchaseOrdersScreen.tsx,
 * GoodsReceiptsScreen.tsx, PurchaseInvoicesScreen.tsx). All three are real
 * API-backed screens on an e2e backend that starts as an empty tenant (no
 * suppliers/items/orders seeded), so this test creates its own supplier +
 * item first, then drives the real create-from-picker flow: a GRN is
 * created "from" the confirmed PO, and the Purchase Invoice is created
 * "from" the confirmed GRN — exercising the same server-side auto-fill
 * (outstanding qty → receipt lines → invoice lines) the UI previews.
 *
 * Doc numbers aren't predictable across parallel spec files sharing the
 * same backend, so each step is isolated by searching for our unique
 * supplier name and capturing the resulting doc number from that single row.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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

/** Returns the single row containing `text`, asserting it's unique. */
function uniqueRow(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({ hasText: text });
}

test.describe("Purchase chain — PO → GRN → Purchase Invoice", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("creates a PO, receives it into a GRN, invoices it from the GRN, and confirms every step", async ({ page }) => {
    const supplierName = unique("مورد سلسلة الشراء");
    const itemName = unique("صنف سلسلة الشراء");

    await createSupplier(page, supplierName);
    await createItem(page, itemName, "50");

    // --- Purchase Order: create + confirm (draft → sent) ---
    await clickSidebarItem(page, "أوامر الشراء");
    await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();
    await page.getByRole("button", { name: "أمر شراء جديد" }).click();
    let dialog = page.getByRole("dialog", { name: "أمر شراء جديد" });

    await pickEntity(dialog, "المورد *", supplierName);
    await pickEntity(dialog, "الصنف", itemName);
    await dialog.getByLabel("الكمية").fill("10");
    await dialog.getByLabel("سعر الوحدة").fill("40");
    await dialog.getByRole("button", { name: "حفظ مسودة" }).click();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder("بحث برقم الأمر أو اسم المورد…").fill(supplierName);
    let row = uniqueRow(page, supplierName);
    await expect(row).toHaveCount(1);
    const poNumber = (await row.locator("td").first().innerText()).trim();
    expect(poNumber).toMatch(/^PO-\d+$/);

    await row.click();
    await expect(page.getByRole("heading", { name: new RegExp(`أمر شراء ${poNumber}`) })).toBeVisible();
    await expect(page.getByText(/لا يؤثر أمر الشراء على المخزون/)).toBeVisible();
    await page.getByRole("button", { name: "تأكيد وإرسال" }).click();
    await expect(page.getByText("مرسل").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "تأكيد وإرسال" })).toHaveCount(0);
    await page.getByRole("button", { name: "رجوع لأوامر الشراء" }).click();

    // --- Goods Receipt: created "from" the confirmed PO, auto-filled lines ---
    await clickSidebarItem(page, "استلام البضائع");
    await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();
    await page.getByRole("button", { name: "إيصال استلام جديد" }).click();
    dialog = page.getByRole("dialog", { name: "إيصال استلام جديد" });
    await expect(dialog.getByText(/الاستلام يبدأ دائماً من أمر شراء/)).toBeVisible();

    await pickEntity(dialog, "أمر الشراء *", poNumber);
    await expect(dialog.getByText("البنود (معبأة تلقائياً من أمر الشراء)")).toBeVisible();
    await dialog.getByRole("button", { name: "حفظ مسودة" }).click();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder("بحث برقم الإيصال أو المورد…").fill(supplierName);
    row = uniqueRow(page, supplierName);
    await expect(row).toHaveCount(1);
    const grNumber = (await row.locator("td").first().innerText()).trim();
    expect(grNumber).toMatch(/^GR-\d+$/);

    await row.click();
    await expect(page.getByRole("heading", { name: new RegExp(`إيصال استلام ${grNumber}`) })).toBeVisible();
    await page.getByRole("button", { name: "تأكيد الاستلام" }).click();
    await expect(page.getByText(/تمت زيادة كمية المخزون/)).toBeVisible();
    await page.getByRole("button", { name: "رجوع لإيصالات الاستلام" }).click();

    // --- Purchase Invoice: created "from" the confirmed GRN, auto-filled lines ---
    await clickSidebarItem(page, "فواتير المشتريات");
    await expect(page.getByRole("heading", { name: "فواتير المشتريات" })).toBeVisible();
    await page.getByRole("button", { name: "فاتورة مشتريات جديدة" }).click();
    dialog = page.getByRole("dialog", { name: "فاتورة مشتريات جديدة" });

    await dialog.getByRole("button", { name: "من إيصال استلام" }).click();
    await pickEntity(dialog, "إيصال الاستلام *", grNumber);
    await expect(dialog.getByText("البنود (معبأة تلقائياً من الإيصال)")).toBeVisible();
    await dialog.getByRole("button", { name: "حفظ مسودة" }).click();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم المورد…").fill(supplierName);
    row = uniqueRow(page, supplierName);
    await expect(row).toHaveCount(1);
    const piNumber = (await row.locator("td").first().innerText()).trim();
    expect(piNumber).toMatch(/^PI-\d+$/);

    await row.click();
    await expect(page.getByRole("heading", { name: new RegExp(`فاتورة مشتريات ${piNumber}`) })).toBeVisible();
    // Also matches the (closed, off-screen) create panel's method chip and
    // description text — getByText ignores aria-hidden — so scope to the
    // first match, which is the detail view's own "المصدر" summary value.
    await expect(page.getByText("من إيصال استلام").first()).toBeVisible();
    await page.getByRole("button", { name: "تأكيد الفاتورة" }).click();
    await expect(page.getByText(/تمّت إضافة الأصناف للمخزون سابقاً/)).toBeVisible();
    await expect(page.getByText(/يزيد المستحق للمورد/)).toBeVisible();
  });
});
