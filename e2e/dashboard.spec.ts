import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";

const SCREENSHOT_DIR = "e2e-results/screenshots";

/**
 * لوحة التحكم / Dashboard (apps/web/src/dashboard/DashboardScreen.tsx,
 * dashboard-sample-data.ts) — the default post-login screen, so every test
 * here uses loginAsDemoUser and asserts directly against it.
 *
 * Section range/sort/tax-mode controls render as `role="group"` with an
 * aria-label combining the section title (e.g. "خيارات العرض · الأصناف
 * الأعلى مبيعاً"), which both disambiguates identical chip labels that
 * repeat across sections (e.g. two "غير شامل الضريبة" chips) and gives a
 * reliable anchor to the section's own <ol> result list via an
 * immediately-following-sibling xpath, instead of a broad text filter that
 * would match every ancestor wrapping the heading.
 */

// "صافي الربح" is also the TrendChart's net-profit series legend label (and
// its sr-only data-table column header), so a plain getByText(exact) anchor
// resolves to 3 elements. Scoping to a direct child of the KPI grid wrapper
// (exactly the 4 StatCard containers, no nested subtree matches) avoids that.
function kpiTile(page: Page, label: string) {
  return page.locator(".grid.grid-cols-2 > div").filter({ hasText: label });
}

function companyKpiTile(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..");
}

function itemsOptionsGroup(page: Page) {
  return page.getByRole("group", { name: "خيارات العرض · الأصناف الأعلى مبيعاً" });
}

function itemsList(page: Page) {
  return itemsOptionsGroup(page).locator("xpath=following-sibling::ol[1]");
}

function customersOptionsGroup(page: Page) {
  return page.getByRole("group", { name: "خيارات العرض · أعلى العملاء مبيعاً" });
}

function customersList(page: Page) {
  return customersOptionsGroup(page).locator("xpath=following-sibling::ol[1]");
}

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("renders real demo data across the KPI, follow-up, and aging widgets", async ({ page }) => {
    await expect(kpiTile(page, "إجمالي الإيرادات · هذا الشهر")).toContainText("86,240.00");
    await expect(kpiTile(page, "إجمالي الإيرادات · هذا الشهر")).toContainText("12.4% مقارنة بالشهر الماضي");
    await expect(kpiTile(page, "صافي الربح")).toContainText("-18,087.50");
    await expect(kpiTile(page, "السيولة النقدية")).toContainText("338.00");

    await expect(page.getByText("فاتورتان متأخرتان")).toBeVisible();
    await expect(page.getByRole("button", { name: "تحصيل الآن" })).toBeVisible();

    await expect(companyKpiTile(page, "مبالغ لدى العملاء")).toContainText("2,782.30");
    await expect(companyKpiTile(page, "قيمة المخزون")).toContainText("604,950.90");

    const agingTable = page.locator("table").filter({ hasText: "العملاء" });
    await expect(agingTable.getByRole("row").filter({ hasText: "العملاء" })).toContainText("612.30");
  });

  test("changing the أداء الفترة range changes the number of plotted months", async ({ page }) => {
    const trendTable = page.getByRole("table", { name: "أداء الفترة" });
    await expect(trendTable.locator("tbody tr")).toHaveCount(6); // default range = "6"

    const rangeGroup = page.getByRole("group", { name: "أداء الفترة" });
    await rangeGroup.getByRole("button", { name: "3 أشهر" }).click();
    await expect(trendTable.locator("tbody tr")).toHaveCount(3);

    await rangeGroup.getByRole("button", { name: "12 شهر" }).click();
    await expect(trendTable.locator("tbody tr")).toHaveCount(12);
  });

  test("sorting الأصناف الأعلى مبيعاً by quantity reorders the list, and tax mode changes the shown amounts", async ({
    page,
  }) => {
    const list = itemsList(page);
    const namesInValueOrder = await list.locator("li").allTextContents();
    // Default sort is "بالقيمة" (by value): revenueIncTax is already
    // descending in sample data, so قاطع كهرباء (14,260) precedes كابل مرن (5,420).
    expect(namesInValueOrder[1]).toContain("قاطع كهرباء");
    expect(namesInValueOrder[4]).toContain("كابل مرن");
    await expect(list.locator("li").first()).toContainText("18,900.00"); // شامل الضريبة (default)

    await itemsOptionsGroup(page).getByRole("button", { name: "بالكمية" }).click();
    const namesInQtyOrder = await list.locator("li").allTextContents();
    // By quantity, كابل مرن (260) outranks لوحة توزيع (96) and قاطع دائرة (74).
    expect(namesInQtyOrder[2]).toContain("كابل مرن");
    expect(namesInQtyOrder[3]).toContain("لوحة توزيع");

    await itemsOptionsGroup(page).getByRole("button", { name: "غير شامل الضريبة" }).click();
    await expect(list.locator("li").first()).toContainText("16,578.95"); // 18,900.00 / 1.14
  });

  test("changing range and tax mode on أعلى العملاء مبيعاً changes the shown amounts", async ({ page }) => {
    const list = customersList(page);
    await expect(list.locator("li").first()).toContainText("شركة الأمل للتجارة");
    await expect(list.locator("li").first()).toContainText("24,850.00"); // شامل الضريبة (default)

    await customersOptionsGroup(page).getByRole("button", { name: "غير شامل الضريبة" }).click();
    await expect(list.locator("li").first()).toContainText("21,798.25"); // 24,850.00 / 1.14

    await customersOptionsGroup(page).getByRole("button", { name: "3 أشهر" }).click();
    await expect(customersOptionsGroup(page).getByRole("button", { name: "3 أشهر" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("captures the dashboard in light and dark themes", async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-dark.png` });
  });
});
