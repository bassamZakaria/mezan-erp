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
  await expect(page.getByRole("heading", { name: "الأصناف", level: 1, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "إضافة صنف" }).first().click();
  await expect(page.getByRole("heading", { name: "إضافة صنف", level: 1 })).toBeVisible();
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

  // Guards the sort that used to be decorative: the «رقم الفاتورة» header was
  // drawn sortable (cursor, hover, «ترتيب حسب هذا العمود») while the screen
  // never passed `sort`/`onSortChange`, so a click changed nothing. The list
  // is a server page, so the order must come back from `/sales-invoices`.
  test("the «رقم الفاتورة» column header sorts the invoices by number, both ways", async ({ page }) => {
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
    await expect.poll(async () => {
      const numbers = await invoiceNumberTexts(page);
      return numbers.length === 2 && numbers[0]! < numbers[1]!;
    }).toBe(true);
    const ascending = await invoiceNumberTexts(page);

    await numberHeader.click();
    await expect(numberHeader).toHaveAttribute("aria-sort", "descending", { timeout: 3000 });
    await expect.poll(() => invoiceNumberTexts(page)).toEqual([...ascending].reverse());
  });

  // Guards the pager, which was dead: every page after the first was
  // unreachable, with or without a search. Clicking «2» wrote `?page=2`, the
  // address change handed the screen a NEW `setPage` (apps/web/src/lib/
  // url-state.ts rebuilt its setters from react-router's `setSearchParams`,
  // which changes identity with the URL), and the screen's reset-the-pager
  // effect — keyed on `setPage` — ran again and wrote the page back to 1. This
  // test used to be a `test.fail()` that blamed the `/sales-invoices` route;
  // the route always answered the right page.
  //
  // The seeded history is the fixture: «INV-0000» matches INV-000001…INV-000099
  // and nothing a sibling spec creates, because those are numbered past 1,000.
  test("paging under an active search filter shows the next page's rows, and a reload stays on it", async ({ page }) => {
    const seeded = (from: number) => Array.from({ length: 10 }, (_, i) => `INV-${String(from + i).padStart(6, "0")}`);

    await clickSidebarItem(page, "فواتير المبيعات");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات", level: 1 })).toBeVisible();
    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill("INV-0000");

    await page.getByRole("combobox", { name: "صفوف لكل صفحة" }).click();
    await page.getByRole("option", { name: "10", exact: true }).click();

    // The summary is "عرض <shown> من <total> فاتورة" — a plain count of the
    // current page's rows, not an "1–10" range.
    await expect(page.getByText("عرض 10 من 99 فاتورة")).toBeVisible();
    await expect.poll(() => invoiceNumberTexts(page)).toEqual(seeded(1));

    const pager = page.getByRole("navigation", { name: "ترقيم الصفحات" });
    const secondPage = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname.endsWith("/sales-invoices") && url.searchParams.get("page") === "2" && url.searchParams.get("search") === "INV-0000";
    });
    await pager.getByRole("button", { name: "2", exact: true }).click();
    expect((await secondPage).status()).toBe(200);
    await expect(page).toHaveURL(/[?&]page=2\b/);
    await expect.poll(() => invoiceNumberTexts(page)).toEqual(seeded(11));
    await expect(page).toHaveURL(/[?&]page=2\b/);

    // The last page is the short one: 99 rows at 10 a page leaves nine.
    await pager.getByRole("button", { name: "10", exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=10\b/);
    await expect(page.getByText("عرض 9 من 99 فاتورة")).toBeVisible();
    await expect.poll(async () => (await invoiceNumberTexts(page)).at(-1)).toBe("INV-000099");

    // A page is part of the address: reloading it must not walk back to the first.
    await pager.getByRole("button", { name: "2", exact: true }).click();
    await expect.poll(() => invoiceNumberTexts(page)).toEqual(seeded(11));
    await page.reload();
    await expect(page.getByRole("heading", { name: "فواتير المبيعات", level: 1 })).toBeVisible();
    await expect.poll(() => invoiceNumberTexts(page)).toEqual(seeded(11));
    await expect(page).toHaveURL(/[?&]page=2\b/);

    // And a filter change still sends the pager home, as it always meant to.
    await page.getByPlaceholder("بحث برقم الفاتورة أو اسم العميل…").fill("INV-00000");
    await expect(page.getByText("عرض 9 من 9 فاتورة")).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]page=/);
  });
});
