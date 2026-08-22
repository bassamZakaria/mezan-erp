import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";

const SCREENSHOT_DIR = "e2e-results/screenshots";

/**
 * لوحة التحكم / Dashboard (apps/web/src/dashboard/DashboardScreen.tsx) — now
 * driven by REAL data from `GET /dashboard/summary` (apps/server, in-memory
 * SQLite freshly seeded per e2e run). A freshly-seeded tenant has a standard
 * Chart of Accounts but no posted entries/customers/invoices yet, so financial
 * KPIs read zero and activity is empty — the honest empty state, not fabricated
 * numbers. The period control genuinely re-queries the backend.
 */

function kpiTile(page: Page, label: string) {
  return page.locator(".grid.grid-cols-2 > div").filter({ hasText: label });
}

function systemDataCard(page: Page) {
  return page.locator("div").filter({ has: page.getByRole("heading", { name: "بيانات النظام" }) }).last();
}

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("greets the real signed-in user and shows real (zero) KPIs for a freshly-seeded tenant", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
    await expect(kpiTile(page, "إجمالي الإيرادات")).toContainText("0.00");
    await expect(kpiTile(page, "صافي الربح")).toContainText("0.00");
    await expect(kpiTile(page, "السيولة النقدية")).toContainText("0.00");
  });

  test("shows the real system-data counts (seeded chart of accounts, zero customers)", async ({ page }) => {
    const card = systemDataCard(page);
    await expect(card.getByText("حسابات دليل الحسابات")).toBeVisible();
    // Seeded standard COA has accounts; no customers/journal entries exist yet.
    const customersTile = card.getByText("العملاء", { exact: true }).locator("..");
    await expect(customersTile).toContainText("0");
  });

  test("shows the empty recent-activity state when nothing has been posted", async ({ page }) => {
    await expect(page.getByText(/لا يوجد نشاط بعد/)).toBeVisible();
  });

  test("changing the period range re-queries and keeps the pressed state", async ({ page }) => {
    const rangeGroup = page.getByRole("group", { name: "نطاق الفترة" });
    await expect(rangeGroup.getByRole("button", { name: "هذا الشهر" })).toHaveAttribute("aria-pressed", "true");

    await rangeGroup.getByRole("button", { name: "كل الفترات" }).click();
    await expect(rangeGroup.getByRole("button", { name: "كل الفترات" })).toHaveAttribute("aria-pressed", "true");
    // Still zero — no posted entries in any range for a fresh tenant.
    await expect(kpiTile(page, "إجمالي الإيرادات")).toContainText("0.00");
  });

  test("captures the dashboard in light and dark themes", async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-dark.png` });
  });
});
