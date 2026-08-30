import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * DocumentList primitive, exercised via the Sales Invoices screen (the
 * pattern-gallery demo, apps/web/src/screens/SalesInvoicesScreen.tsx). The
 * e2e backend starts as a genuinely empty tenant — no invoices seeded — so
 * this file creates its own small, known fixture set (distinct customers,
 * amounts and dates) and scopes every assertion to that set via the search
 * box, since the backend is shared with other e2e spec files.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/**
 * The docNo cell wraps two stacked `.mz-num` values (docNo, then "customer ·
 * date") — reads the FIRST one from each row, in row order. Callers assert
 * row count first (which already waits out any pending re-render), so a
 * one-shot DOM read here is safe.
 */
async function invoiceNumberTexts(page: Page): Promise<string[]> {
  return page.locator("table tbody tr").evaluateAll((rows) =>
    rows.map((row) => row.querySelector("td:first-child .mz-num")?.textContent?.trim() ?? ""),
  );
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

async function createItem(page: Page, name: string, salePrice: string): Promise<void> {
  await clickSidebarItem(page, "الأصناف");
  await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).first().click();
  await expect(page.getByRole("heading", { name: "إضافة صنف", level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: "نوع الصنف" }).click();
  await page.getByRole("option", { name: "خدمة" }).click();
  await page.getByLabel("اسم الصنف *").fill(name);
  const price = page.getByLabel("سعر البيع");
  await price.fill(salePrice);
  await price.press("Tab");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByRole("heading", { name: "الأصناف" })).toBeVisible();
}

async function pickEntity(scope: Page | Locator, label: string, query: string): Promise<void> {
  const input = scope.getByLabel(label);
  await input.click();
  await input.fill(query);
  await scope.getByRole("button", { name: new RegExp(query) }).first().click();
}

/** Creates a confirmed invoice for `customerName` × `itemName`, returning its number. */
async function createConfirmedInvoice(page: Page, customerName: string, itemName: string): Promise<string> {
  await clickSidebarItem(page, "فواتير المبيعات");
  await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  await page.getByRole("button", { name: "فاتورة جديدة" }).first().click();
  await expect(page.getByRole("heading", { name: "فاتورة مبيعات جديدة", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "متابعة" }).click();
  await pickEntity(page, "العميل *", customerName);
  await pickEntity(page, "الصنف — سطر 1", itemName);
  await page.getByRole("button", { name: "تأكيد الفاتورة" }).click();
  await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill(customerName);
  const row = page.locator("table tbody tr").filter({ hasText: customerName });
  await expect(row).toHaveCount(1);
  const docNo = (await row.locator("td").first().locator(".mz-num").first().innerText()).trim();
  await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill("");
  return docNo;
}

test.describe("DocumentList — Sales Invoices", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("search filters by invoice number and by customer name, and an empty result shows the empty state", async ({ page }) => {
    const prefix = unique("عميل قائمة مستندات");
    const item = unique("صنف قائمة مستندات");
    await createCustomer(page, prefix);
    await createItem(page, item, "10");
    const docNo = await createConfirmedInvoice(page, prefix, item);

    await clickSidebarItem(page, "فواتير المبيعات");
    const search = page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…");

    await search.fill(docNo);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    expect(await invoiceNumberTexts(page)).toEqual([docNo]);

    await search.fill("");
    await search.fill(prefix);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    expect(await invoiceNumberTexts(page)).toEqual([docNo]);

    await search.fill(unique("لا يوجد شيء بهذا الاسم"));
    await expect(page.getByText("لا توجد فواتير مطابقة")).toBeVisible();
  });

  test("status chip narrows to a confirmed invoice, scoped by search", async ({ page }) => {
    const prefix = unique("عميل حالة قائمة");
    const item = unique("صنف حالة قائمة");
    await createCustomer(page, prefix);
    await createItem(page, item, "10");
    const docNo = await createConfirmedInvoice(page, prefix, item);

    await clickSidebarItem(page, "فواتير المبيعات");
    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill(prefix);

    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^مؤكد\s+\d/ }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    expect(await invoiceNumberTexts(page)).toEqual([docNo]);

    // A zero-count chip is not rendered at all (packages/ui/src/primitives/
    // ListViews.tsx) — with the search scoped to our one confirmed invoice,
    // مسودة/ملغي have nothing to offer.
    await expect(tablist.getByRole("tab", { name: /^مسودة/ })).toHaveCount(0);
  });

  // BUG: apps/web/src/screens/SalesInvoicesScreen.tsx marks its "رقم
  // الفاتورة" column `sortable: true` (DocumentListColumn), which draws it as
  // clickable (cursor-pointer, hover state, title="ترتيب حسب هذا العمود"),
  // but the screen never passes `sort`/`onSortChange` to <DocumentList>
  // (packages/ui/src/primitives/DocumentList.tsx's header onClick is
  // `col.sortable ? () => onSortChange?.(col.key) : undefined`, and
  // `onSortChange` is undefined here) — a click sets no `aria-sort` and
  // changes nothing. Contrast ItemsScreen.tsx, which wires `sort`/
  // `onSortChange` and sorts for real (see items.spec.ts's sort test) — the
  // same primitive, correctly used elsewhere, makes this a wiring gap.
  test("BUG: the «رقم الفاتورة» column header looks sortable but a click changes nothing", async ({ page }) => {
    test.fail();
    const prefix = unique("عميل ترتيب قائمة");
    const item = unique("صنف ترتيب قائمة");
    await createItem(page, item, "10");

    const names = ["أ", "ب"].map((s) => `${prefix} ${s}`);
    for (const name of names) await createCustomer(page, name);
    for (const name of names) await createConfirmedInvoice(page, name, item);

    await clickSidebarItem(page, "فواتير المبيعات");
    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill(prefix);
    await expect(page.locator("table tbody tr")).toHaveCount(2);

    const numberHeader = page.getByRole("columnheader", { name: /رقم الفاتورة/ });
    await numberHeader.click();
    await expect(numberHeader).toHaveAttribute("aria-sort", "ascending", { timeout: 3000 });
  });

  // BUG: with a search filter active and pageSize=10, clicking pager page
  // "2" updates the URL (`?page=2`) but the table keeps rendering the exact
  // same 10 rows page 1 showed — confirmed reproducible (re-run, and with an
  // extra 600ms settle before paging to rule out a pure debounce race).
  // apps/web/src/screens/SalesInvoicesScreen.tsx fetches the page from the
  // server via `useSalesInvoices(listFilter)` with `listFilter` including
  // both `search` and `page` (data/hooks.ts's `salesInvoiceParams` serializes
  // both), so the client-side wiring looks correct — page 2 of an
  // 11-row search result not returning the 11th row points at the
  // `/sales-invoices` server route's own search+pagination composition.
  test("BUG: paging to page 2 under an active search filter re-renders page 1's rows", async ({ page }) => {
    // 23 sequential fixture-creation flows (1 item, 11 customers, 11
    // invoices) — the fewest that still force a second page at the smallest
    // selectable page size (10).
    test.setTimeout(180_000);
    test.fail();
    const prefix = unique("عميل ترقيم قائمة");
    const item = unique("صنف ترقيم قائمة");
    await createItem(page, item, "10");
    const names = Array.from({ length: 11 }, (_, i) => `${prefix} ${i + 1}`);
    for (const name of names) await createCustomer(page, name);
    for (const name of names) await createConfirmedInvoice(page, name, item);

    await clickSidebarItem(page, "فواتير المبيعات");
    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill(prefix);

    await page.getByRole("combobox", { name: "صفوف لكل صفحة" }).click();
    await page.getByRole("option", { name: "10", exact: true }).click();

    // The summary is "عرض <shown> من <total> فاتورة" — a plain count of the
    // current page's rows, not an "1–10" range.
    await expect(page.getByText("عرض 10 من 11 فاتورة")).toBeVisible();
    const page1Numbers = await invoiceNumberTexts(page);
    await page.waitForTimeout(600);

    await page.getByRole("navigation", { name: "ترقيم الصفحات" }).getByRole("button", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2\b/);

    await expect(page.locator("table tbody tr")).toHaveCount(1, { timeout: 3000 });
    const page2Numbers = await invoiceNumberTexts(page);
    expect(page2Numbers).not.toEqual(page1Numbers);
  });
});
