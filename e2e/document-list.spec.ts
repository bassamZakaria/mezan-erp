import { test, expect } from "@playwright/test";

/**
 * DocumentList primitive, exercised via the Sales Invoices screen (the
 * pattern-gallery demo, apps/web/src/screens/SalesInvoicesScreen.tsx) — the
 * default screen on load. 7 demo invoices, page size 5.
 */

function invoiceNumbers(page: import("@playwright/test").Page) {
  return page.locator("table tbody tr td:first-child .mz-num");
}

test.describe("DocumentList — Sales Invoices", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  });

  test("status chips filter the rows", async ({ page }) => {
    await expect(invoiceNumbers(page)).toHaveCount(5); // page 1 of "all"

    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    // Chips' accessible name is "<label> <count>" (e.g. "مدفوع 2"), so anchor
    // on "مدفوع" followed by whitespace + a digit to avoid also matching the
    // "مدفوع جزئياً" (partial) chip.
    await tablist.getByRole("tab", { name: /^مدفوع\s+\d/ }).click();
    await expect(invoiceNumbers(page)).toHaveText(["INV-000122", "INV-000121"]);

    await tablist.getByRole("tab", { name: /^الكل\s+\d/ }).click();
    await expect(invoiceNumbers(page)).toHaveCount(5);
  });

  test("column sort toggles ascending then descending by total", async ({ page }) => {
    const totalHeader = page.getByRole("columnheader", { name: /الإجمالي/ });
    await totalHeader.click();
    await expect(totalHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(invoiceNumbers(page)).toHaveText([
      "INV-000119",
      "INV-000121",
      "INV-000118",
      "INV-000123",
      "INV-000117",
    ]);

    await totalHeader.click();
    await expect(totalHeader).toHaveAttribute("aria-sort", "descending");
    await expect(invoiceNumbers(page)).toHaveText([
      "INV-000122",
      "INV-000120",
      "INV-000117",
      "INV-000123",
      "INV-000118",
    ]);
  });

  test("search filters by invoice number and by customer name", async ({ page }) => {
    const search = page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…");

    await search.fill("000120");
    await expect(invoiceNumbers(page)).toHaveText(["INV-000120"]);

    await search.fill("");
    await search.fill("الأمل");
    await expect(invoiceNumbers(page)).toHaveText(["INV-000123", "INV-000119"]);

    await search.fill("لا يوجد شيء بهذا الاسم");
    await expect(page.getByText("لا توجد فواتير مطابقة")).toBeVisible();
  });

  test("pager advances to the second page", async ({ page }) => {
    await expect(page.getByText("عرض 1–5 من 7 فاتورة")).toBeVisible();
    await expect(invoiceNumbers(page)).toHaveCount(5);

    await page.getByRole("navigation", { name: "ترقيم الصفحات" }).getByRole("button", { name: "2", exact: true }).click();

    await expect(page.getByText("عرض 6–7 من 7 فاتورة")).toBeVisible();
    await expect(invoiceNumbers(page)).toHaveText(["INV-000118", "INV-000117"]);
  });
});
