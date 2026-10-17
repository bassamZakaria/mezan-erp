import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { localTodayIso } from "./support/dates";

/**
 * Operational reports (apps/web/src/screens/reports/*ReportsScreens.tsx) —
 * each a thin apps/web/src/screens/reports/ReportScreen.tsx wrapper over
 * @mezan/ui's ReportRunner, hitting the REAL /reports/* API. None of these
 * (unlike ميزان المراجعة, already covered by e2e/trial-balance-report.spec.ts)
 * are `onDemand`, so they auto-run on mount.
 *
 * The old fixture assumed a genuinely empty tenant, so every one of these
 * reports rendered a genuine empty result. The demo seed
 * (packages/backend/src/demo-seed*) carries real, non-trivial sales,
 * purchases, inventory and customer-debt data — and its own dates are
 * generated RELATIVE to whenever the seed actually runs (see
 * `today()`/`addDays()` in demo-seed/treasury.ts), so hardcoding a literal
 * date the old spec captured on one particular day breaks the moment the
 * suite runs on another. Every date default below is computed the same way
 * the report screens themselves compute it (SalesReportsScreens.tsx /
 * PurchasesReportsScreens.tsx / AgingReportsScreens.tsx: month-to-date /
 * as-of-today), and the "has real data" assertions check for the ABSENCE of
 * the empty state and a non-zero row count rather than a specific figure
 * that would drift with the same clock.
 *
 * There is no "financial statements" (income statement / balance sheet)
 * screen in this codebase yet — أرباح مراكز التكلفة (Cost Center P&L) is
 * the closest thing and already has its own spec (e2e/accounting-depth.spec.ts).
 */

function isoToday(): string {
  return localTodayIso();
}

function isoMonthStart(): string {
  const today = isoToday();
  return `${today.slice(0, 7)}-01`;
}

test.describe("Sales by Period", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "المبيعات حسب الفترة");
    await expect(page.getByRole("heading", { name: "المبيعات حسب الفترة" })).toBeVisible();
  });

  test("auto-runs with default month-to-date params and shows the seeded sales activity", async ({ page }) => {
    await expect(page.getByLabel("الفترة — من")).toHaveValue(isoMonthStart());
    await expect(page.getByLabel("الفترة — إلى")).toHaveValue(isoToday());
    // "التجميع" is the portaled `Select` combobox now, not a native <select>.
    await expect(page.getByRole("combobox", { name: "التجميع" })).toContainText("يومي");

    await expect(page.getByText("التاريخ", { exact: true })).toBeVisible(); // column header rendered
    // The demo seed carries real month-to-date sales activity now — not the
    // empty tenant the old fixture assumed.
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toHaveCount(0);
    await expect(page.locator("table tbody tr").first()).toBeVisible();

    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeEnabled();
  });

  test("an invalid (emptied) date silently fails — no field-level or page-level error is shown", async ({ page }) => {
    // apps/web/src/screens/reports/ReportScreen.tsx keys a 400's fieldErrors
    // under "_root", but ReportRunner's ParamField looks it up under the
    // field's OWN key ("dateFrom") — so the message it holds never renders.
    const refetch = page.waitForResponse((r) => r.url().includes("/sales/by-period"));
    await page.getByLabel("الفترة — من").fill("");
    await refetch;

    await expect(page.getByRole("heading", { name: "المبيعات حسب الفترة" })).toBeVisible(); // no crash
    await expect(page.getByText(/تاريخ غير صالح/)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("Purchases by Supplier", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "المشتريات حسب المورد");
    await expect(page.getByRole("heading", { name: "المشتريات حسب المورد" })).toBeVisible();
  });

  test("auto-runs and its export buttons are enabled against the seeded purchase activity", async ({ page }) => {
    await expect(page.getByLabel("الفترة — من")).toHaveValue(isoMonthStart());
    await expect(page.getByLabel("الفترة — إلى")).toHaveValue(isoToday());

    // The seeded purchase history is dated, not relative: it ends on
    // demo-seed/history.ts's HISTORY_END (2026-08-15). The default
    // month-to-date window only held purchases while that month was current,
    // or when purchase-chain.spec.ts happened to post one first.
    const seededWindow = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        url.pathname.endsWith("/reports/purchases/by-supplier") &&
        url.searchParams.get("dateFrom") === "2026-08-01" &&
        url.searchParams.get("dateTo") === "2026-08-15"
      );
    });
    await page.getByLabel("الفترة — من").fill("2026-08-01");
    await page.getByLabel("الفترة — إلى").fill("2026-08-15");
    const report = (await (await seededWindow).json()) as { rows: unknown[]; grandTotals: { count: number } };
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.grandTotals.count).toBeGreaterThan(0);

    await expect(page.getByText("لا توجد بيانات لعرضها.")).toHaveCount(0);
    const totalsRow = page.locator("table tbody tr").filter({ hasText: "الإجمالي" });
    await expect(totalsRow).toHaveCount(1);
    await expect(page.locator("table tbody tr")).toHaveCount(report.rows.length + 1);
    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeEnabled();
  });
});

test.describe("Inventory Valuation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "تقييم المخزون");
    await expect(page.getByRole("heading", { name: "تقييم المخزون" })).toBeVisible();
  });

  test("has free-text search/warehouse params (no dates) and renders the seeded catalog's real valuation", async ({ page }) => {
    // "بحث" is ambiguous with the column's own "بحث وأوامر (CtrlK)" trigger —
    // scope to the textbox role.
    const search = page.getByRole("textbox", { name: "بحث" });
    await expect(search).toHaveValue("");
    // Also ambiguous, with the shell's own "المستودع الحالي" scope switcher.
    await expect(page.getByRole("textbox", { name: "المستودع" })).toHaveValue("");

    // The seeded catalog carries real on-hand stock and WAC valuation now —
    // not the empty tenant the old fixture assumed.
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toHaveCount(0);
    await expect(page.locator("table tbody tr").first()).toBeVisible();

    const refetch = page.waitForResponse((r) => r.url().includes("/inventory/valuation"));
    await search.fill("لا يوجد صنف بهذا الاسم");
    await refetch;
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toBeVisible(); // a real, no-match search IS genuinely empty
  });
});

test.describe("Aging — Customers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أعمار ديون العملاء");
    await expect(page.getByRole("heading", { name: "أعمار ديون العملاء" })).toBeVisible();
  });

  test("has a single as-of-date param, defaulting to today, and renders the seeded customer debt ladder", async ({ page }) => {
    await expect(page.getByLabel("حتى تاريخ")).toHaveValue(isoToday());
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toHaveCount(0);
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeEnabled();
  });

  // Guards D192: CUST-DEMO-1's bounced cheque CHQ-DEMO-3 left the ladder
  // 1,750.00 above 1105 until a bounce reversed the payment onto AR.
  test("the aging report's own reconciliation banner agrees with the AR control account", async ({ page }) => {
    await expect(page.getByText("إجمالي أعمار الديون مقابل حساب العملاء في دفتر الأستاذ")).toBeVisible();
    await expect(page.getByText(/^\(فرق/)).toHaveCount(0);
  });
});
