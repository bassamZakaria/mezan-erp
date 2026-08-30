import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Operational reports (apps/web/src/screens/reports/*ReportsScreens.tsx) —
 * each a thin apps/web/src/screens/reports/ReportScreen.tsx wrapper over
 * @mezan/ui's ReportRunner, hitting the REAL /reports/* API. None of these
 * (unlike ميزان المراجعة, already covered by e2e/trial-balance-report.spec.ts)
 * are `onDemand`, so they auto-run on mount — and since the seeded tenant
 * has zero sales/purchases/inventory/customer activity, every one of them
 * renders a genuine empty result (not a crash), which is exactly what this
 * suite checks alongside the shared param bar / export-button behaviour.
 *
 * There is no "financial statements" (income statement / balance sheet)
 * screen in this codebase yet — أرباح مراكز التكلفة (Cost Center P&L) is
 * the closest thing and already has its own spec (e2e/accounting-depth.spec.ts).
 */

test.describe("Sales by Period", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "المبيعات حسب الفترة");
    await expect(page.getByRole("heading", { name: "المبيعات حسب الفترة" })).toBeVisible();
  });

  test("auto-runs with default month-to-date params and shows a genuine empty result", async ({ page }) => {
    await expect(page.getByLabel("الفترة — من")).toHaveValue("2026-08-01");
    await expect(page.getByLabel("الفترة — إلى")).toHaveValue("2026-08-30");
    // "التجميع" is the portaled `Select` combobox now, not a native <select>.
    await expect(page.getByRole("combobox", { name: "التجميع" })).toContainText("يومي");

    await expect(page.getByText("التاريخ", { exact: true })).toBeVisible(); // column header rendered
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toBeVisible();

    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeDisabled();
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

  test("auto-runs and its export buttons stay disabled against zero rows", async ({ page }) => {
    await expect(page.getByLabel("الفترة — من")).toHaveValue("2026-08-01");
    await expect(page.getByLabel("الفترة — إلى")).toHaveValue("2026-08-30");
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toBeVisible();
    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeDisabled();
  });
});

test.describe("Inventory Valuation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "تقييم المخزون");
    await expect(page.getByRole("heading", { name: "تقييم المخزون" })).toBeVisible();
  });

  test("has free-text search/warehouse params (no dates) and renders empty against the seeded catalog", async ({ page }) => {
    // "بحث" is ambiguous with the column's own "بحث وأوامر (CtrlK)" trigger —
    // scope to the textbox role.
    const search = page.getByRole("textbox", { name: "بحث" });
    await expect(search).toHaveValue("");
    // Also ambiguous, with the shell's own "المستودع الحالي" scope switcher.
    await expect(page.getByRole("textbox", { name: "المستودع" })).toHaveValue("");

    await expect(page.getByText("لا توجد بيانات لعرضها.")).toBeVisible();

    const refetch = page.waitForResponse((r) => r.url().includes("/inventory/valuation"));
    await search.fill("لا يوجد صنف بهذا الاسم");
    await refetch;
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toBeVisible(); // still empty, still no crash
  });
});

test.describe("Aging — Customers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أعمار ديون العملاء");
    await expect(page.getByRole("heading", { name: "أعمار ديون العملاء" })).toBeVisible();
  });

  test("has a single as-of-date param, defaulting to today, and renders empty with no customer debt", async ({ page }) => {
    await expect(page.getByLabel("حتى تاريخ")).toHaveValue("2026-08-30");
    await expect(page.getByText("لا توجد بيانات لعرضها.")).toBeVisible();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeDisabled();
  });
});
