import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

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
 * Create is a full sub-PAGE for all three documents (an `h1` heading, no
 * `role="dialog"`), and المورد/الصنف/أمر الشراء/إيصال الاستلام are all the
 * portaled `Select` combobox (packages/ui/src/primitives/Select.tsx), chosen
 * by clicking the combobox then its `role="option"` — not the free-text
 * EntityPicker this spec used to drive.
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
  await page.getByRole("button", { name: "إضافة مورد" }).first().click();
  const form = page.getByRole("dialog", { name: "إضافة مورد" });
  await brokenLabelField(form, "اسم المورد *").fill(name);
  await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();
  await expect(form).toBeHidden();
}

/**
 * The item's code is never typed here — packages/domain/src/items/create-item.ts
 * allocates the next free ITM-###### on the server, atomically, so several
 * copies of this test creating an item at the same moment each get their own
 * code instead of racing for one (see items.spec.ts's regression test for
 * that directly).
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
  await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
}

/** Clicks a `Select` primitive's combobox trigger, then the matching portaled option. */
async function chooseCombo(page: Page, comboLabel: string, optionName: string | RegExp): Promise<void> {
  await page.getByRole("combobox", { name: comboLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

/** Returns the single row containing `text`, asserting it's unique. */
function uniqueRow(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({ hasText: text });
}

/**
 * `clickSidebarItem` right after a breadcrumb "رجوع" navigation is a real,
 * reproducible race — the «كل الشاشات» click occasionally lands while the
 * previous view is still settling and the target screen never opens, with
 * nothing throwing (the click itself succeeds; it's just clicking too
 * early). Retrying the click — never widening the per-attempt timeout —
 * is what actually waits on the specific outcome instead of a fixed delay.
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
  // Final attempt: let it fail with Playwright's own clear error if the
  // screen genuinely never opens, rather than swallowing a real failure.
  await expect(page.getByRole("heading", { name: headingName })).toBeVisible();
}

test.describe("Purchase chain — PO → GRN → Purchase Invoice", () => {
  // Serial keeps this file's own doc-number/row assertions deterministic
  // when --repeat-each runs several copies of this test; item-code
  // allocation itself is safe under concurrency now (server-side, atomic).
  test.describe.configure({ mode: "serial" });

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
    await page.getByRole("button", { name: "أمر شراء جديد" }).first().click();
    await expect(page.getByRole("heading", { name: "أمر شراء جديد", level: 1 })).toBeVisible();

    await chooseCombo(page, "المورد *", supplierName);
    await chooseCombo(page, "الصنف", itemName);
    // "الكمية"/"سعر الوحدة" go through the same broken NumberField as the
    // customer/supplier name fields (e2e/support/broken-label.ts).
    await brokenLabelField(page, "الكمية").fill("10");
    await brokenLabelField(page, "سعر الوحدة").fill("40");
    await page.getByRole("button", { name: "حفظ مسودة" }).click();
    await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();

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
    await page.getByRole("button", { name: "رجوع إلى أوامر الشراء" }).click();
    // Wait for the list to actually settle before navigating again — firing
    // clickSidebarItem while this breadcrumb navigation is still resolving
    // is a real, reproducible race (the next screen's own heading never
    // appears and the run times out several steps later).
    await expect(page.getByRole("heading", { name: "أوامر الشراء" })).toBeVisible();

    // --- Goods Receipt: created "from" the confirmed PO, auto-filled lines ---
    await gotoScreen(page, "استلام البضائع", "إيصالات الاستلام");
    await page.getByRole("button", { name: "إيصال استلام جديد" }).first().click();
    await expect(page.getByRole("heading", { name: "إيصال استلام جديد", level: 1 })).toBeVisible();
    await expect(page.getByText(/الاستلام يبدأ دائماً من أمر شراء/)).toBeVisible();
    // "من أمر شراء" is the default (already pressed) creation-method choice.
    await page.getByRole("button", { name: "متابعة" }).click();

    await chooseCombo(page, "أمر الشراء *", new RegExp(poNumber));
    await expect(page.getByText("البنود (معبأة تلقائياً من أمر الشراء)")).toBeVisible();
    await page.getByRole("button", { name: "حفظ مسودة" }).click();
    await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();

    await page.getByPlaceholder("بحث برقم الإيصال أو المورد…").fill(supplierName);
    row = uniqueRow(page, supplierName);
    await expect(row).toHaveCount(1);
    const grNumber = (await row.locator("td").first().innerText()).trim();
    expect(grNumber).toMatch(/^GR-\d+$/);

    await row.click();
    await expect(page.getByRole("heading", { name: new RegExp(`إيصال استلام ${grNumber}`) })).toBeVisible();
    // The detail view derives its "selected" receipt from the SAME shared
    // `useGoodsReceipts` list query the confirm mutation invalidates, so
    // while that refetch is in flight the screen can transiently fall back
    // to its own list render (an empty `receipts` array briefly resolves
    // `selected` to null) — the effects banner is real but not a reliable
    // thing to wait ON. The server response is: confirm the mutation itself
    // succeeded from the network, not a transient piece of its own UI.
    const [confirmResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/purchases/receipts/") && r.url().endsWith("/confirm") && r.request().method() === "POST"),
      page.getByRole("button", { name: "تأكيد الاستلام" }).click(),
    ]);
    expect(confirmResponse.ok()).toBe(true);
    // The breadcrumb "رجوع إلى X" uses the nav item's label (استلام البضائع),
    // not the screen's own h1 heading (إيصالات الاستلام) — present whether
    // the screen is mid-flicker to its list view or settled on the detail.
    await page.getByRole("button", { name: "رجوع إلى استلام البضائع" }).click();
    // Same settling wait as above, before the next clickSidebarItem.
    await expect(page.getByRole("heading", { name: "إيصالات الاستلام" })).toBeVisible();

    // --- Purchase Invoice: created "from" the confirmed GRN, auto-filled lines ---
    await gotoScreen(page, "فواتير المشتريات", "فواتير المشتريات");
    await page.getByRole("button", { name: "فاتورة مشتريات جديدة" }).first().click();
    await expect(page.getByRole("heading", { name: "فاتورة مشتريات جديدة", level: 1 })).toBeVisible();
    // "إنشاء فاتورة جديدة" (manual) is the default-pressed method here, not
    // "من إيصال استلام" — pick it explicitly before continuing.
    await page.getByRole("button", { name: /^من إيصال استلام/ }).click();
    await page.getByRole("button", { name: "متابعة" }).click();

    await chooseCombo(page, "إيصال الاستلام *", new RegExp(grNumber));
    await expect(page.getByText("البنود (معبأة تلقائياً من الإيصال)")).toBeVisible();
    await page.getByRole("button", { name: "حفظ مسودة" }).click();
    await expect(page.getByRole("heading", { name: "فواتير المشتريات" })).toBeVisible();

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
