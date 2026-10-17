import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Landed Costs (التكاليف الإضافية) — apps/web/src/screens/LandedCostsScreen.tsx.
 * Real API-backed (draft → confirmed distribution across a confirmed
 * purchase invoice's inventory lines), so each test builds its own
 * supplier/item/PO→GRN→purchase-invoice chain first.
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

/**
 * Item add is a full sub-PAGE (h1 "إضافة صنف"), not a dialog (see
 * items.spec.ts's file header for the same finding).
 */
async function createItem(page: Page, name: string, salePrice: string): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).first().click();
  await expect(page.getByRole("heading", { name: "إضافة صنف", level: 1 })).toBeVisible();
  await page.getByLabel("اسم الصنف *").fill(name);
  const price = page.getByLabel("سعر البيع");
  await price.fill(salePrice);
  await price.press("Tab");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByRole("heading", { name: "إضافة صنف", level: 1 })).toBeHidden();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Clicks a `Select` primitive's combobox trigger, then the matching portaled option — it is not a native `<select>` (packages/ui/src/primitives/Select.tsx). */
async function chooseCombo(page: Page, scope: Page | Locator, comboLabel: string, optionName: string | RegExp): Promise<void> {
  await scope.getByRole("combobox", { name: comboLabel, exact: true }).click();
  await page.getByRole("option", { name: optionName }).click();
}

/** Picks a combobox option by a text substring — robust against exact-label formatting (money/date) we don't control. */
async function chooseComboContaining(page: Page, scope: Page | Locator, comboLabel: string, substring: string): Promise<void> {
  await chooseCombo(page, scope, comboLabel, new RegExp(escapeRegExp(substring)));
}

function uniqueRow(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({ hasText: text });
}

/**
 * `clickSidebarItem` right after a breadcrumb "رجوع" navigation is a real,
 * reproducible race — the «كل الشاشات» click occasionally lands while the
 * previous view is still settling and the target screen never opens, with
 * nothing throwing (the click itself succeeds; it's just clicking too
 * early). Retrying the click — never widening the per-attempt timeout — is
 * what actually waits on the specific outcome instead of a fixed delay (see
 * purchase-chain.spec.ts for the same finding).
 */
async function gotoScreen(page: Page, sidebarLabel: string, headingName: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickSidebarItem(page, sidebarLabel);
    if (
      await page
        .getByRole("heading", { name: headingName })
        .isVisible({ timeout: 5_000 })
        .catch(() => false)
    ) {
      return;
    }
  }
  await expect(page.getByRole("heading", { name: headingName })).toBeVisible();
}

/**
 * Creates + confirms a PO → GRN → Purchase Invoice chain, returning the
 * confirmed invoice's number (e.g. "PI-000042").
 *
 * Create is a full sub-PAGE for all three documents (an `h1` heading, no
 * `role="dialog"`), and المورد/الصنف/أمر الشراء/إيصال الاستلام are all the
 * portaled `Select` combobox, chosen by clicking the combobox then its
 * `role="option"` — not the free-text EntityPicker this used to drive (see
 * purchase-chain.spec.ts's file header for the same finding).
 */
async function createConfirmedPurchaseInvoice(page: Page, supplierName: string, itemName: string): Promise<string> {
  await clickSidebarItem(page, "أوامر الشراء");
  await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();
  await page.getByRole("button", { name: "أمر شراء جديد" }).first().click();
  await expect(page.getByRole("heading", { name: "أمر شراء جديد", level: 1 })).toBeVisible();

  await chooseCombo(page, page, "المورد *", supplierName);
  await chooseCombo(page, page, "الصنف", itemName);
  await page.getByLabel("الكمية").fill("20");
  await page.getByLabel("سعر الوحدة").fill("40");
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم الأمر أو اسم المورد…").fill(supplierName);
  let row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const poNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد وإرسال" }).click();
  await expect(page.getByText("مرسل").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "تأكيد وإرسال" })).toHaveCount(0);
  await page.getByRole("button", { name: "رجوع إلى أوامر الشراء" }).click();
  // Wait for the list to actually settle before navigating again — firing
  // clickSidebarItem while this breadcrumb navigation is still resolving is
  // a real, reproducible race (the next screen's own heading never appears
  // and the run times out several steps later — see purchase-chain.spec.ts).
  await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();

  await gotoScreen(page, "استلام البضائع", "إيصالات الاستلام");
  await page.getByRole("button", { name: "إيصال استلام جديد" }).first().click();
  await expect(page.getByRole("heading", { name: "إيصال استلام جديد", level: 1 })).toBeVisible();
  // "من أمر شراء" is the default (already pressed) creation-method choice.
  await page.getByRole("button", { name: "متابعة" }).click();

  await chooseCombo(page, page, "أمر الشراء *", new RegExp(poNumber));
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم الإيصال أو المورد…").fill(supplierName);
  row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const grNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  // The detail view derives its "selected" receipt from the SAME shared
  // `useGoodsReceipts` list query the confirm mutation invalidates, so
  // while that refetch is in flight the screen can transiently fall back to
  // its own list render (an empty `receipts` array briefly resolves
  // `selected` to null) — the effects banner is real but not a reliable
  // thing to wait ON. The server response is: confirm the mutation itself
  // succeeded from the network, not a transient piece of its own UI.
  const [confirmResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/purchases/receipts/") && r.url().endsWith("/confirm") && r.request().method() === "POST"),
    page.getByRole("button", { name: "تأكيد الاستلام" }).click(),
  ]);
  expect(confirmResponse.ok()).toBe(true);
  // Whether the screen is mid-flicker to its list view or settled on the
  // confirmed detail, this same-labelled back action is present in both.
  await page.getByRole("button", { name: "رجوع إلى استلام البضائع" }).click();
  // Same settling wait as above, before the next clickSidebarItem.
  await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();

  await gotoScreen(page, "فواتير المشتريات", "فواتير المشتريات");
  await page.getByRole("button", { name: "فاتورة مشتريات جديدة" }).first().click();
  await expect(page.getByRole("heading", { name: "فاتورة مشتريات جديدة", level: 1 })).toBeVisible();
  // "إنشاء فاتورة جديدة" (manual) is the default-pressed method here.
  await page.getByRole("button", { name: /^من إيصال استلام/ }).click();
  await page.getByRole("button", { name: "متابعة" }).click();

  await chooseCombo(page, page, "إيصال الاستلام *", new RegExp(grNumber));
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page.getByRole("heading", { name: "فواتير المشتريات" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم الفاتورة أو اسم المورد…").fill(supplierName);
  row = uniqueRow(page, supplierName);
  await expect(row).toHaveCount(1);
  const piNumber = (await row.locator("td").first().innerText()).trim();
  await row.click();
  await page.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(page.getByText(/تمّت إضافة الأصناف للمخزون سابقاً/)).toBeVisible();
  await page.getByRole("button", { name: "رجوع إلى فواتير المشتريات" }).click();
  // Same settling wait as above — the caller immediately navigates again.
  await expect(page.getByRole("heading", { name: "فواتير المشتريات" })).toBeVisible();

  return piNumber;
}

test.describe("Landed Costs", () => {
  // Both tests build their own supplier/item/PO→GRN→invoice chain, and item
  // creation races on a client-assigned code under concurrency (a real app
  // defect — see items.spec.ts's file header and its dedicated test.fail).
  // Serial keeps this suite off that race.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("distributes a shipping cost by value across a confirmed purchase invoice's items and confirms it", async ({ page }) => {
    const supplierName = unique("مورد تكلفة إضافية");
    const itemName = unique("صنف تكلفة إضافية");
    await createSupplier(page, supplierName);
    await createItem(page, itemName, "50");
    const piNumber = await createConfirmedPurchaseInvoice(page, supplierName, itemName);

    await gotoScreen(page, "التكاليف الإضافية", "التكاليف الإضافية");
    await page.getByRole("button", { name: "مستند تكلفة جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });

    await chooseComboContaining(page, dialog, "الفاتورة المرتبطة *", piNumber);
    await chooseCombo(page, dialog, "طريقة التوزيع *", "حسب القيمة");
    await dialog.getByLabel("المبلغ").fill("300");
    await expect(dialog.getByText(/إجمالي التكلفة:/)).toContainText("300");
    await expect(dialog.getByText("معاينة التوزيع")).toBeVisible();

    await dialog.getByRole("button", { name: "حفظ وتأكيد التوزيع" }).click();
    await expect(dialog).toBeHidden();
  });

  test("saves a draft distribution by quantity, then confirms it from the detail panel", async ({ page }) => {
    const supplierName = unique("مورد تكلفة مسودة");
    const itemName = unique("صنف تكلفة مسودة");
    await createSupplier(page, supplierName);
    await createItem(page, itemName, "50");
    const piNumber = await createConfirmedPurchaseInvoice(page, supplierName, itemName);

    await gotoScreen(page, "التكاليف الإضافية", "التكاليف الإضافية");
    await page.getByRole("button", { name: "مستند تكلفة جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });

    await chooseComboContaining(page, dialog, "الفاتورة المرتبطة *", piNumber);
    await chooseCombo(page, dialog, "طريقة التوزيع *", "حسب الكمية");
    await dialog.getByLabel("المبلغ").fill("150");
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(dialog).toBeHidden();

    // The screen's own search box matches a document's linked invoice number
    // too (LandedCostsScreen.tsx filters on `sourceInvoiceNumber`) — search
    // by OUR unique piNumber instead of assuming this draft is the list's
    // most recent row, which a list shared with other runs never guarantees.
    await page.getByPlaceholder("بحث برقم المستند أو الفاتورة…").fill(piNumber);
    // Filter on the unique piNumber itself, not the generic "مسودة" status
    // text — a status word is exactly the kind of text that can also turn up
    // in an unrelated element sharing the page, where the piNumber cannot.
    const draftRow = page.locator("table tbody tr").filter({ hasText: piNumber });
    await expect(draftRow).toHaveCount(1);
    // .first() — a draft's docNo cell shows literal "مسودة" too (no number
    // yet), so the word legitimately appears twice in this one correct row.
    await expect(draftRow.getByText("مسودة", { exact: true }).first()).toBeVisible();
    await draftRow.click();

    await page.getByRole("button", { name: "تأكيد التوزيع" }).click();
    await expect(page.getByRole("button", { name: "تأكيد التوزيع" })).toHaveCount(0);
    await expect(page.getByText("مؤكد", { exact: true }).first()).toBeVisible();
  });
});
