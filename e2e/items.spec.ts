import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

const SCREENSHOT_DIR = "e2e-results/screenshots";

/**
 * Items screen (apps/web/src/screens/ItemsScreen.tsx) — الأصناف. The e2e
 * backend is the fully seeded demo tenant (MEZAN_SEED_DEMO=1 — see
 * packages/backend/src/demo-seed.ts), not an empty one, so the list is
 * already past its 25-row page size before any test runs — every test
 * creates its own item via the real create flow, isolated by a unique name,
 * and searches for it rather than assuming it lands on page 1.
 *
 * Add/edit is a full sub-PAGE (FormPage/FormColumns in
 * apps/web/src/settings/form-controls.tsx), not a modal — there is no
 * `role="dialog"` here, just an `h1` heading "إضافة صنف" / "تعديل صنف" and a
 * "رجوع" back action, unlike Customers/Suppliers/Journals which are dialogs.
 * The plain text fields go through apps/web/src/screens/item-form-controls.tsx
 * (label nested INSIDE the `<label>` element), which correctly associates
 * with `getByLabel` — no broken-label workaround needed here.
 *
 * `Select` (packages/ui/src/primitives/Select.tsx) is a portaled custom
 * listbox, not a native `<select>` — every field built on it (نوع الصنف،
 * الوحدة الأساسية) is chosen by clicking its combobox trigger then its
 * `role="option"`, not `.selectOption()`.
 *
 * Generic list mechanics (sort/pager column headers) get one compact test
 * here since document-list.spec.ts already covers that surface exhaustively
 * via Sales Invoices; the tests below focus on what's specific to items —
 * the repeatable unit/barcode editors, the service-type field toggle, detail
 * tabs, and validation.
 *
 * `serial`: every test here creates an item with no explicit code (the
 * server assigns the next ITM-###### itself, atomically and retrying past a
 * concurrent-create race — see the regression test below). Serial just keeps
 * this suite's own item count/search assertions deterministic; it is no
 * longer required for code-allocation correctness.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function listRow(page: Page, nameAr: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(nameAr, { exact: true }) });
}

async function chooseCombo(page: Page, comboLabel: string, optionName: string | RegExp): Promise<void> {
  await page.getByRole("combobox", { name: comboLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

/**
 * Retries the WHOLE navigation from a known-good state rather than
 * re-clicking blind — re-clicking the add button while its own screen is
 * mid-transition (a client-side sub-page swap over an already-large
 * seeded+test-grown items table) risks Playwright's actionability wait
 * landing on a button that is itself being detached/replaced, which can
 * stall far longer than any single check (same finding as `gotoScreen` in
 * returns.spec.ts/purchase-chain.spec.ts, applied the safe way here:
 * `clickSidebarItem` always returns to a stable list render before the next
 * attempt clicks a fresh, definitely-attached button).
 */
async function openItemForm(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { name: "إضافة صنف", level: 1 });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await clickSidebarItem(page, "الأصناف");
    await page.getByRole("button", { name: "إضافة صنف" }).first().click();
    if (await heading.isVisible({ timeout: 5_000 }).catch(() => false)) return;
  }
  await expect(heading).toBeVisible();
}

/** Fills the minimum required fields (name + a sale price) and submits. */
async function createItem(page: Page, name: string, salePrice: string, options?: { service?: boolean }): Promise<void> {
  await openItemForm(page);
  if (options?.service) await chooseCombo(page, "نوع الصنف", "خدمة");
  await page.getByLabel("اسم الصنف *").fill(name);
  const price = page.getByLabel("سعر البيع");
  await price.fill(salePrice);
  await price.press("Tab");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
}

test.describe("Items", () => {
  // See the file header: serial keeps this suite's own search/count
  // assertions deterministic; it does not paper over any code-allocation
  // defect (the server allocates atomically now).
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الأصناف");
    await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
  });

  test("adding an item appears in the list with a generated code, and search finds it by name and code", async ({ page }) => {
    const name = unique("صنف تجريبي جديد");
    await createItem(page, name, "42.50");

    // The list is server-paged at 25 and the seeded tenant already holds more
    // than that, so a freshly-created row is not guaranteed to land on page 1
    // — search for it by name rather than assuming it does.
    const search = page.getByPlaceholder("بحث بالاسم أو الكود...");
    await search.fill(name);
    const row = listRow(page, name);
    await expect(row).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    const code = (await row.locator("td").first().locator(".mz-num").innerText()).trim();
    expect(code).toMatch(/^ITM-\d+$/);

    await search.fill("");
    await search.fill(code);
    await expect(listRow(page, name)).toBeVisible();
  });

  test("sorting by sale price toggles ascending then descending across a known set of prices", async ({ page }) => {
    const prefix = unique("صنف ترتيب");
    const names = ["أ", "ب", "ج"].map((s) => `${prefix} ${s}`);
    await createItem(page, names[0]!, "300");
    await createItem(page, names[1]!, "100");
    await createItem(page, names[2]!, "200");

    await page.getByPlaceholder("بحث بالاسم أو الكود...").fill(prefix);
    await expect(page.locator("table tbody tr")).toHaveCount(3);

    const priceHeader = page.getByRole("columnheader", { name: /سعر البيع/ });
    await priceHeader.click();
    await expect(priceHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("table tbody tr")).toHaveText([
      new RegExp(names[1]!),
      new RegExp(names[2]!),
      new RegExp(names[0]!),
    ]);

    await priceHeader.click();
    await expect(priceHeader).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator("table tbody tr")).toHaveText([
      new RegExp(names[0]!),
      new RegExp(names[2]!),
      new RegExp(names[1]!),
    ]);
  });

  test("status chip filters to service items only, scoped by search", async ({ page }) => {
    const prefix = unique("صنف حالة");
    await createItem(page, `${prefix} مخزون`, "10");
    await createItem(page, `${prefix} خدمة`, "20", { service: true });

    await page.getByPlaceholder("بحث بالاسم أو الكود...").fill(prefix);
    await expect(page.locator("table tbody tr")).toHaveCount(2);

    await page.getByRole("tablist", { name: "تصفية حسب الحالة" }).getByRole("tab", { name: /^خدمة\s+\d/ }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(listRow(page, `${prefix} خدمة`)).toBeVisible();
  });

  test.describe("add item", () => {
    test("fills alternate units and barcodes via the repeatable editors, then the new item appears in the list", async ({ page }) => {
      const name = unique("منتج اختبار الوحدات والباركود");
      await openItemForm(page);
      await page.getByLabel("اسم الصنف *").fill(name);

      await page.getByRole("button", { name: "+ إضافة وحدة" }).click();
      await page.getByRole("button", { name: "+ إضافة وحدة" }).click();
      await expect(page.getByLabel("كود الوحدة", { exact: true })).toHaveCount(2);

      const unitCodeInputs = page.getByLabel("كود الوحدة", { exact: true });
      const unitNameInputs = page.getByLabel("اسم الوحدة", { exact: true });
      const unitFactorInputs = page.getByLabel("عامل التحويل", { exact: true });
      await unitCodeInputs.nth(0).fill("CTN");
      await unitNameInputs.nth(0).fill("كرتونة");
      await unitFactorInputs.nth(0).fill("12");
      await unitCodeInputs.nth(1).fill("BOX");
      await unitNameInputs.nth(1).fill("صندوق");
      await unitFactorInputs.nth(1).fill("24");

      await page.getByRole("button", { name: "حذف الوحدة" }).first().click();
      await expect(page.getByLabel("كود الوحدة", { exact: true })).toHaveCount(1);
      await expect(unitCodeInputs.nth(0)).toHaveValue("BOX");

      await page.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await page.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await page.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await expect(page.getByLabel("الباركود", { exact: true })).toHaveCount(3);

      const barcodeInputs = page.getByLabel("الباركود", { exact: true });
      await barcodeInputs.nth(0).fill("1112223334441");
      await barcodeInputs.nth(1).fill("1112223334442");
      await barcodeInputs.nth(2).fill("1112223334443");

      await page.getByRole("button", { name: "حذف الباركود" }).first().click();
      await expect(page.getByLabel("الباركود", { exact: true })).toHaveCount(2);
      await expect(page.getByLabel("الباركود", { exact: true }).nth(0)).toHaveValue("1112223334442");

      await page.getByRole("button", { name: "إضافة", exact: true }).click();
      await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();

      await page.getByPlaceholder("بحث بالاسم أو الكود...").fill(name);
      await expect(listRow(page, name)).toBeVisible();
    });

    test("switching item type to service hides the inventory-policy fields", async ({ page }) => {
      await openItemForm(page);

      await expect(page.getByText("تتبع المخزون")).toBeVisible();
      await chooseCombo(page, "نوع الصنف", "خدمة");
      await expect(page.getByText("تتبع المخزون")).toBeHidden();
    });

    test("rejects a duplicate barcode and keeps the form open with an error", async ({ page }) => {
      await openItemForm(page);

      await page.getByLabel("اسم الصنف *").fill(unique("صنف باركود مكرر"));
      await page.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await page.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      const barcodeInputs = page.getByLabel("الباركود", { exact: true });
      const barcode = `111222333${Date.now() % 10000}`;
      await barcodeInputs.nth(0).fill(barcode);
      await barcodeInputs.nth(1).fill(barcode);

      await page.getByRole("button", { name: "إضافة", exact: true }).click();

      await expect(page.getByRole("alert")).toContainText("مكرر");
      await expect(page.getByRole("heading", { name: "إضافة صنف", level: 1 })).toBeVisible();
    });
  });

  test("editing an item via the row edit action updates its name in the list", async ({ page }) => {
    const name = unique("زيت عباد الشمس 1 لتر");
    await createItem(page, name, "55");
    await page.getByPlaceholder("بحث بالاسم أو الكود...").fill(name);

    // Two controls share this accessible name: a RowMenu trigger
    // (aria-haspopup="menu", for a narrower layout) and the direct edit icon
    // button used at this width — .last() is the direct one.
    await page.getByRole("button", { name: `تعديل ${name}` }).last().click();
    await expect(page.getByRole("heading", { name: "تعديل صنف", level: 1 })).toBeVisible();

    const codeInput = page.getByLabel("كود الصنف", { exact: true });
    await expect(codeInput).toBeDisabled();
    await expect(page.getByLabel("اسم الصنف *")).toHaveValue(name);

    const updatedName = `${name} مطور`;
    await page.getByLabel("اسم الصنف *").fill(updatedName);
    await page.getByRole("button", { name: "حفظ", exact: true }).click();

    await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
    // The search box resets on this navigation back to the list.
    await page.getByPlaceholder("بحث بالاسم أو الكود...").fill(updatedName);
    await expect(listRow(page, updatedName)).toBeVisible();
  });

  test("opening an item shows its detail tabs, and switching between them changes the content", async ({ page }) => {
    const name = unique("أرز أبيض مصري 5 كجم");
    await createItem(page, name, "180");
    await page.getByPlaceholder("بحث بالاسم أو الكود...").fill(name);

    await listRow(page, name).click();
    await expect(page.getByRole("heading", { name: new RegExp(`— ${name}$`) })).toBeVisible();
    await expect(page.getByText("الوحدة الأساسية", { exact: true })).toBeHidden();

    await page.getByRole("tab", { name: "الوحدات والباركود" }).click();
    await expect(page.getByText("الوحدة الأساسية", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "التسعير" }).click();
    await expect(page.getByRole("tabpanel").getByText("سعر التكلفة", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "الحسابات" }).click();
    await expect(page.getByRole("tabpanel").getByText("حساب المخزون", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "المخزون" }).click();
    await expect(page.getByRole("tabpanel").getByText("لا يوجد مخزون من هذا الصنف في أي مستودع.")).toBeVisible();

    await page.getByRole("button", { name: "رجوع للقائمة" }).click();
    await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
  });

  test("captures the list screen in light and dark themes", async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/items-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.screenshot({ path: `${SCREENSHOT_DIR}/items-dark.png` });
  });

  /**
   * Regression guard: ItemsScreen.tsx used to compute the new item's code
   * client-side from the catalogue's current size (`nextItemCode`) and post
   * it as a literal `code`. Two operators who opened the create form before
   * either had saved were offered the SAME code, and whichever saved second
   * was refused. The code field is now always disabled/blank on create and
   * the server (packages/domain/src/items/create-item.ts) allocates the next
   * free ITM-###### atomically, retrying past a race — both saves below must
   * succeed, each with its own code.
   */
  test("two operators who both open the create form each get their own generated code", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await loginAsDemoUser(pageA);
      await loginAsDemoUser(pageB);
      await clickSidebarItem(pageA, "الأصناف");
      await clickSidebarItem(pageB, "الأصناف");

      // Both forms open before either saves.
      await openItemForm(pageA);
      await openItemForm(pageB);

      const nameA = unique("صنف تزامن أ");
      const nameB = unique("صنف تزامن ب");
      await pageA.getByLabel("اسم الصنف *").fill(nameA);
      await pageB.getByLabel("اسم الصنف *").fill(nameB);
      for (const p of [pageA, pageB]) {
        const price = p.getByLabel("سعر البيع");
        await price.fill("10");
        await price.press("Tab");
      }

      await pageA.getByRole("button", { name: "إضافة", exact: true }).click();
      await expect(pageA.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();

      // B must succeed too, with its own server-allocated code.
      await pageB.getByRole("button", { name: "إضافة", exact: true }).click();
      await expect(pageB.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();

      const searchA = pageA.getByPlaceholder("بحث بالاسم أو الكود...");
      await searchA.fill(nameA);
      const codeA = (await listRow(pageA, nameA).locator("td").first().locator(".mz-num").innerText()).trim();

      const searchB = pageB.getByPlaceholder("بحث بالاسم أو الكود...");
      await searchB.fill(nameB);
      const codeB = (await listRow(pageB, nameB).locator("td").first().locator(".mz-num").innerText()).trim();

      expect(codeA).toMatch(/^ITM-\d+$/);
      expect(codeB).toMatch(/^ITM-\d+$/);
      expect(codeA).not.toBe(codeB);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
