import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";

/**
 * «الباقة والاستخدام» — the DEC-31 billing screen (apps/web/src/billing/BillingScreen.tsx).
 *
 * The seeded demo tenant is on the enterprise plan with a live POS module
 * trial, so the plan card, the usage figures, the module list and the plan
 * offers all have real rows — including the Free plan and its 100-invoice
 * quota, which is the thing a tenant on the paid plan is being shown.
 *
 * Every figure on this screen is the server's own. The assertions below read
 * the rendered text rather than the API precisely because the failure this
 * guards against is a screen that renders its own arithmetic.
 */
test.describe("الباقة والاستخدام — plan and usage", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await page.goto("/settings/settings-billing");
    await page.locator("main").first().waitFor({ state: "visible" });
  });

  test("names the tenant's plan and whether it is free", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "الباقة والاستخدام", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "المؤسسات", level: 2 })).toBeVisible();
    await expect(page.getByText("مدفوعة", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: "e2e-results/plan-billing.png", fullPage: true });
  });

  test("shows what has been used against every seat, branch and warehouse limit", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /الاستخدام في/ })).toBeVisible();
    for (const label of ["المستخدمون النشطون", "الفروع", "المخازن"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // «١٠٠ من ١٠٠» — used of allowed, and never a bare figure.
    await expect(page.getByText(/\d+\s*من\s*\d+/).first()).toBeVisible();
    await expect(page.getByText(/الحدود تسري على إنشاء مستندات جديدة فقط/)).toBeVisible();
  });

  test("lists every module with its state, and the one on trial says so", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "الوحدات" })).toBeVisible();
    await expect(page.getByText("نقاط البيع", { exact: true })).toBeVisible();
    await expect(page.getByText("تجربة جارية", { exact: true }).first()).toBeVisible();
  });

  test("offers the plans, with the Free plan's own limits on it", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "الباقات المتاحة" })).toBeVisible();
    await expect(page.getByText("المجانية", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("باقتك الحالية", { exact: true })).toBeVisible();
    await expect(page.getByText(/فواتير المبيعات في الشهر:\s*100/).first()).toBeVisible();
  });

  test("reads right-to-left, like every other screen", async ({ page }) => {
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
