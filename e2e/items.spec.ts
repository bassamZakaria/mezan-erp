import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

const SCREENSHOT_DIR = "e2e-results/screenshots";

/**
 * Items screen (apps/web/src/screens/ItemsScreen.tsx) — الأصناف. 8 demo items
 * (apps/web/src/items-sample-data.ts), page size 5 (2 pages). List
 * (DocumentList: status chips, search, category/unit selects, sortable
 * table, pager) → detail (DocumentDetail with 5 tabs) → add/edit form
 * (SidePanel) with repeatable alternate-unit and barcode editors.
 */

function listRow(page: Page, nameAr: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(nameAr, { exact: true }) });
}

function itemCodes(page: Page) {
  return page.locator("table tbody tr td:first-child .mz-num");
}

test.describe("Items", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الأصناف");
    await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
  });

  test.describe("list", () => {
    test("lists the demo catalog across two pages", async ({ page }) => {
      await expect(page.getByText("عرض 1–5 من 8 صنف")).toBeVisible();
      await expect(page.locator("table tbody tr")).toHaveCount(5);

      await page.getByRole("navigation", { name: "ترقيم الصفحات" }).getByRole("button", { name: "2", exact: true }).click();

      await expect(page.getByText("عرض 6–8 من 8 صنف")).toBeVisible();
      await expect(itemCodes(page)).toHaveText(["ITM-000006", "ITM-000007", "ITM-000008"]);
    });

    test("category filter narrows the list to matching items", async ({ page }) => {
      await page.getByLabel("تصفية حسب التصنيف").selectOption({ label: "مواد غذائية" });

      await expect(page.getByText("عرض 1–3 من 3 صنف")).toBeVisible();
      await expect(itemCodes(page)).toHaveText(["ITM-000001", "ITM-000002", "ITM-000008"]);
    });

    test("unit filter narrows the list to items on that base unit", async ({ page }) => {
      await page.getByLabel("تصفية حسب الوحدة").selectOption({ label: "قطعة" });

      await expect(page.getByText("عرض 1–4 من 4 صنف")).toBeVisible();
      await expect(itemCodes(page)).toHaveText(["ITM-000001", "ITM-000002", "ITM-000003", "ITM-000004"]);
    });

    test("search narrows the list by Arabic name", async ({ page }) => {
      await page.getByPlaceholder("بحث بالاسم أو الكود...").fill("زيت");

      await expect(page.getByText("عرض 1–1 من 1 صنف")).toBeVisible();
      await expect(itemCodes(page)).toHaveText(["ITM-000002"]);
    });

    test("status chip filters to the service items only", async ({ page }) => {
      await page.getByRole("tablist", { name: "تصفية حسب الحالة" }).getByRole("tab", { name: /^خدمة\s+\d/ }).click();

      await expect(page.locator("table tbody tr")).toHaveCount(2);
      await expect(listRow(page, "خدمة صيانة معدات")).toBeVisible();
      await expect(listRow(page, "خدمة تركيب وتوصيل")).toBeVisible();

      await page.getByRole("tablist", { name: "تصفية حسب الحالة" }).getByRole("tab", { name: /^الكل\s+\d/ }).click();
      await expect(page.locator("table tbody tr")).toHaveCount(5);
    });

    test("sorting by sale price toggles ascending then descending", async ({ page }) => {
      const priceHeader = page.getByRole("columnheader", { name: /سعر البيع/ });
      await priceHeader.click();
      await expect(priceHeader).toHaveAttribute("aria-sort", "ascending");
      await expect(itemCodes(page)).toHaveText(["ITM-000008", "ITM-000002", "ITM-000003", "ITM-000007", "ITM-000001"]);

      await priceHeader.click();
      await expect(priceHeader).toHaveAttribute("aria-sort", "descending");
      await expect(itemCodes(page)).toHaveText(["ITM-000005", "ITM-000006", "ITM-000004", "ITM-000001", "ITM-000007"]);
    });
  });

  test.describe("add item", () => {
    test("fills alternate units and barcodes via the repeatable editors, then the new item appears in the list", async ({ page }) => {
      await page.getByRole("button", { name: "إضافة صنف" }).click();
      const form = page.getByRole("dialog", { name: "إضافة صنف" });
      await expect(form).toBeVisible();

      await form.getByLabel("اسم الصنف *").fill("منتج اختبار الوحدات والباركود");

      // Alternate units: add two rows and fill each one.
      await form.getByRole("button", { name: "+ إضافة وحدة" }).click();
      await form.getByRole("button", { name: "+ إضافة وحدة" }).click();
      await expect(form.getByLabel("كود الوحدة", { exact: true })).toHaveCount(2);

      const unitCodeInputs = form.getByLabel("كود الوحدة", { exact: true });
      const unitNameInputs = form.getByLabel("اسم الوحدة", { exact: true });
      const unitFactorInputs = form.getByLabel("عامل التحويل", { exact: true });
      await unitCodeInputs.nth(0).fill("CTN");
      await unitNameInputs.nth(0).fill("كرتونة");
      await unitFactorInputs.nth(0).fill("12");
      await unitCodeInputs.nth(1).fill("BOX");
      await unitNameInputs.nth(1).fill("صندوق");
      await unitFactorInputs.nth(1).fill("24");

      // Remove the first alternate-unit row and confirm only the second (BOX) remains.
      await form.getByRole("button", { name: "حذف الوحدة" }).first().click();
      await expect(form.getByLabel("كود الوحدة", { exact: true })).toHaveCount(1);
      await expect(unitCodeInputs.nth(0)).toHaveValue("BOX");

      // Barcodes: add three rows, fill them, then remove one and confirm the count drops.
      // getByLabel is exact here — otherwise it also picks up the "حذف
      // الباركود" remove buttons, whose accessible name contains "الباركود"
      // as a substring.
      await form.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await form.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await form.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await expect(form.getByLabel("الباركود", { exact: true })).toHaveCount(3);

      const barcodeInputs = form.getByLabel("الباركود", { exact: true });
      await barcodeInputs.nth(0).fill("1112223334441");
      await barcodeInputs.nth(1).fill("1112223334442");
      await barcodeInputs.nth(2).fill("1112223334443");

      await form.getByRole("button", { name: "حذف الباركود" }).first().click();
      await expect(form.getByLabel("الباركود", { exact: true })).toHaveCount(2);
      await expect(form.getByLabel("الباركود", { exact: true }).nth(0)).toHaveValue("1112223334442");

      await form.getByRole("button", { name: "إضافة", exact: true }).click();
      await expect(form).toBeHidden();

      await expect(page.getByText("عرض 1–5 من 9 صنف")).toBeVisible();
      await page.getByPlaceholder("بحث بالاسم أو الكود...").fill("منتج اختبار الوحدات والباركود");
      await expect(listRow(page, "منتج اختبار الوحدات والباركود")).toBeVisible();
    });

    test("switching item type to service hides the inventory-policy fields", async ({ page }) => {
      await page.getByRole("button", { name: "إضافة صنف" }).click();
      const form = page.getByRole("dialog", { name: "إضافة صنف" });

      await expect(form.getByText("تتبع المخزون")).toBeVisible();
      await form.getByLabel("نوع الصنف *").selectOption("service");
      await expect(form.getByText("تتبع المخزون")).toBeHidden();
    });

    test("rejects a duplicate barcode and keeps the form open with an error", async ({ page }) => {
      await page.getByRole("button", { name: "إضافة صنف" }).click();
      const form = page.getByRole("dialog", { name: "إضافة صنف" });

      await form.getByLabel("اسم الصنف *").fill("صنف باركود مكرر");
      await form.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      await form.getByRole("button", { name: "+ إضافة باركود آخر" }).click();
      const barcodeInputs = form.getByLabel("الباركود", { exact: true });
      await barcodeInputs.nth(0).fill("1112223334445");
      await barcodeInputs.nth(1).fill("1112223334445");

      await form.getByRole("button", { name: "إضافة", exact: true }).click();

      await expect(form.getByRole("alert")).toContainText("مكرر");
      await expect(form).toBeVisible();
    });
  });

  test("editing an item via the row edit action updates its name in the list", async ({ page }) => {
    await page.getByRole("button", { name: "تعديل زيت عباد الشمس 1 لتر" }).click();
    const form = page.getByRole("dialog", { name: "تعديل صنف" });
    await expect(form).toBeVisible();

    const codeInput = form.getByLabel("كود الصنف", { exact: true });
    await expect(codeInput).toBeDisabled();
    await expect(codeInput).toHaveValue("ITM-000002");
    await expect(form.getByLabel("اسم الصنف *")).toHaveValue("زيت عباد الشمس 1 لتر");
    await expect(form.getByLabel("الماركة")).toHaveValue("الملكة");

    await form.getByLabel("اسم الصنف *").fill("زيت عباد الشمس 1 لتر مطور");
    await form.getByRole("button", { name: "حفظ", exact: true }).click();

    await expect(form).toBeHidden();
    await expect(listRow(page, "زيت عباد الشمس 1 لتر مطور")).toBeVisible();
  });

  test("opening an item shows its detail tabs, and switching between them changes the content", async ({ page }) => {
    await listRow(page, "أرز أبيض مصري 5 كجم").click();

    await expect(page.getByRole("heading", { name: "ITM-000001 — أرز أبيض مصري 5 كجم" })).toBeVisible();
    // "الوحدة الأساسية" (exact) is the units-tab card label — distinct from
    // the closed add/edit form's "الوحدة الأساسية *" select label, which
    // stays mounted (hidden) behind the detail view.
    await expect(page.getByText("الوحدة الأساسية", { exact: true })).toBeHidden();

    await page.getByRole("tab", { name: "الوحدات والباركود" }).click();
    await expect(page.getByText("الوحدة الأساسية", { exact: true })).toBeVisible();
    await expect(page.getByText("1 CTN = 12 PCS")).toBeVisible();
    await expect(page.getByText("6221031200015")).toBeVisible();

    await page.getByRole("tab", { name: "التسعير" }).click();
    // Unique to the pricing tab's cost-price hint — the stock tab has its own
    // "(المرحلة الثانية)" note, but only this one mentions "دفتر التكاليف".
    await expect(page.getByText(/دفتر التكاليف/)).toBeVisible();

    await page.getByRole("tab", { name: "الحسابات" }).click();
    await expect(page.getByText("1200 — المخزون")).toBeVisible();
    await expect(page.getByText("10000051")).toBeVisible();

    await page.getByRole("tab", { name: "المخزون" }).click();
    await expect(page.getByText(/المرحلة الثانية/)).toBeVisible();

    await page.getByRole("button", { name: "رجوع للقائمة" }).click();
    await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
  });

  test("captures the list screen in light and dark themes", async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/items-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.screenshot({ path: `${SCREENSHOT_DIR}/items-dark.png` });
  });
});
