import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Report runner (@mezan/ui's ReportRunner, PR #15) wired end to end by
 * ميزان المراجعة (apps/web/src/screens/TrialBalanceReportScreen.tsx) over the
 * report engine's sample GL data — the one example `ReportDefinition`. It's
 * on-demand: no results until "عرض التقرير" is clicked.
 */

test.describe("Report runner — ميزان المراجعة", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "ميزان المراجعة");
    await expect(page.getByRole("heading", { name: "ميزان المراجعة" })).toBeVisible();
  });

  test("renders the param bar and gates results behind عرض التقرير", async ({ page }) => {
    await expect(page.getByLabel("حتى تاريخ")).toHaveValue("2026-08-22");
    const runButton = page.getByRole("button", { name: "عرض التقرير" });
    await expect(runButton).toBeVisible();

    await expect(page.getByText("النقدية", { exact: true })).toHaveCount(0);
    // Export buttons are present but disabled before any result exists.
    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeDisabled();
  });

  test("running the report produces grouped rows, a grand total, and a balanced reconciliation banner", async ({ page }) => {
    await page.getByRole("button", { name: "عرض التقرير" }).click();

    await expect(page.getByText("الأصول", { exact: true })).toBeVisible();
    await expect(page.getByText("النقدية", { exact: true })).toBeVisible();
    await expect(page.getByText("إيرادات المبيعات")).toBeVisible();

    await expect(page.getByText("إجمالي المدين = إجمالي الدائن")).toBeVisible();
    await expect(page.getByText("147,000.00").first()).toBeVisible();

    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeEnabled();
  });

  test("recomputes the balance for an earlier as-of date", async ({ page }) => {
    await page.getByLabel("حتى تاريخ").fill("2026-01-01");
    await page.getByRole("button", { name: "عرض التقرير" }).click();

    await expect(page.getByText("100,000.00").first()).toBeVisible();
    await expect(page.getByText("122,000.00")).toHaveCount(0);
  });

  test("shows a field validation error instead of running on an invalid date", async ({ page }) => {
    // Native <input type="date"> rejects free-text values outright, so an
    // empty value is what actually reaches the params schema's regex check
    // (its "^\d{4}-\d{2}-\d{2}$" rejects "" the same way it would "not-a-date").
    await page.getByLabel("حتى تاريخ").fill("");
    await page.getByRole("button", { name: "عرض التقرير" }).click();

    await expect(page.getByText("تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD")).toBeVisible();
    await expect(page.getByText("النقدية", { exact: true })).toHaveCount(0);
  });
});
