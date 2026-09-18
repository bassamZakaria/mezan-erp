import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";

const SCREENSHOT_DIR = "e2e-results/screenshots";

/**
 * لوحة التحكم / Dashboard (apps/web/src/dashboard/DashboardScreen.tsx) — now
 * driven by REAL data from `GET /dashboard/summary` (apps/server, in-memory
 * SQLite). The tenant is the fully seeded demo company
 * (packages/backend/src/demo-seed.ts), not a fresh empty one: it already
 * carries a real chart of accounts, dozens of customers/suppliers/items, and
 * thousands of posted journal entries — several dated TODAY (treasury,
 * manufacturing, contracting activity), so even "هذا الشهر" (this month) is
 * not zero. Every other e2e spec file shares this same backend and keeps
 * adding to it while this file's tests run, so exact KPI figures are not
 * just wrong for a "fresh tenant" — they are actively unstable to assert.
 * These tests instead check that the KPIs are real, well-formed, non-empty
 * numbers reflecting genuine backend data, not a specific value.
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

  /** A tile's headline money figure, e.g. "5,556,272.66" out of "5,556,272.66\nج.م\n...". */
  function moneyFigure(text: string): number {
    const match = text.match(/-?[\d,]+\.\d{2}/);
    if (!match) return NaN;
    return Number(match[0].replace(/,/g, ""));
  }

  test("greets the real signed-in user and shows real, well-formed KPIs", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
    // Not asserting exact figures: this backend is shared with every other
    // e2e spec file, all still adding posted entries while this test runs —
    // an exact KPI value here would be asserting on a moving target.
    // السيولة النقدية is a point-in-time treasury balance (not period-scoped)
    // and the seed alone funds it far past zero, so it is a stable, real
    // check — polled rather than read once, since the summary loads
    // asynchronously and a bare .innerText() can catch it mid-fetch.
    await expect
      .poll(async () => moneyFigure(await kpiTile(page, "السيولة النقدية").innerText()))
      .toBeGreaterThan(1000);
    // The other two are period-scoped and can legitimately read zero for a
    // quiet period — just prove they render a real, parseable money figure.
    await expect
      .poll(async () => Number.isNaN(moneyFigure(await kpiTile(page, "إجمالي الإيرادات").innerText())))
      .toBe(false);
    await expect
      .poll(async () => Number.isNaN(moneyFigure(await kpiTile(page, "صافي الربح").innerText())))
      .toBe(false);
  });

  test("shows real, non-zero system-data counts from the seeded tenant", async ({ page }) => {
    const card = systemDataCard(page);
    await expect(card.getByText("حسابات دليل الحسابات")).toBeVisible();
    // Not asserting exact counts — other e2e spec files sharing this backend
    // keep creating customers/items/entries while this test runs. The seeded
    // demo company is never a fresh, empty tenant, so every one of these is
    // real and non-zero, which is the fact worth proving. Polled, since the
    // summary loads asynchronously and a bare .innerText() can catch it
    // before the real counts arrive.
    for (const label of ["حسابات دليل الحسابات", "العملاء", "الموردون", "الأصناف", "القيود المحاسبية"]) {
      const tile = card.getByText(label, { exact: true }).locator("..");
      await expect
        .poll(async () => Number((await tile.innerText()).replace(/[^\d]/g, "")), {
          message: `${label} should be a real, non-zero count`,
        })
        .toBeGreaterThan(0);
    }
  });

  test("shows the recent-activity feed of real posted journal entries", async ({ page }) => {
    // The seeded tenant has posted thousands of journal entries (treasury,
    // manufacturing, contracting…), several dated today, so the honest
    // state here is a real feed — not the "لا يوجد نشاط بعد" empty state,
    // which only a truly fresh tenant would ever show.
    await expect(page.getByText("أحدث القيود المرحلة")).toBeVisible();
    await expect(page.getByText(/لا يوجد نشاط بعد/)).toHaveCount(0);
    await expect(page.getByText(/JE-\d+/).first()).toBeVisible();
  });

  test("changing the period range re-queries and keeps the checked state", async ({ page }) => {
    // The range chips are a mutually-exclusive radio group (Chip's default
    // ARIA — packages/ui/src/primitives/atoms.tsx), not plain toggle buttons.
    const rangeGroup = page.getByRole("radiogroup", { name: "نطاق الفترة" });
    await expect(rangeGroup.getByRole("radio", { name: "هذا الشهر" })).toHaveAttribute("aria-checked", "true");

    await rangeGroup.getByRole("radio", { name: "كل الفترات" }).click();
    await expect(rangeGroup.getByRole("radio", { name: "كل الفترات" })).toHaveAttribute("aria-checked", "true");
    await expect(rangeGroup.getByRole("radio", { name: "هذا الشهر" })).toHaveAttribute("aria-checked", "false");
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
