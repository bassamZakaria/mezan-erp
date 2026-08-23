import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Landed Costs (التكاليف الإضافية) — apps/web/src/screens/LandedCostsScreen.tsx.
 * Document-framework-backed (draft → confirmed) against an in-memory
 * client-side store seeded from local demo data (a purchase invoice picker
 * backed by a local `DEMO_PURCHASE_INVOICES` array, demo warehouses/items)
 * — no network calls, so each test's fresh browser context gets a fresh
 * store and the first doc is always LC-000001.
 */

test.describe("Landed Costs", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "التكاليف الإضافية");
    await expect(page.getByRole("heading", { name: "التكاليف الإضافية" })).toBeVisible();
    await expect(page.getByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات")).toBeVisible();
  });

  test("distributes a shipping cost by value across a purchase invoice's items and confirms it", async ({ page }) => {
    await page.getByRole("button", { name: "مستند تكلفة جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });

    await dialog.getByLabel("طريقة التوزيع *").selectOption({ label: "حسب القيمة" });
    await dialog.getByLabel("المبلغ").fill("300");
    await expect(dialog.getByText(/إجمالي التكلفة:/)).toContainText("300");

    await dialog.getByRole("button", { name: "حفظ وتأكيد التوزيع" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("LC-000001")).toBeVisible();
    const row = page.locator("table tbody tr").filter({ hasText: "LC-000001" });
    await expect(row.getByText("مؤكد", { exact: true })).toBeVisible();
    await expect(row.getByText("حسب القيمة")).toBeVisible();

    await row.click();
    await expect(page.getByText(/→ تكلفة جديدة/)).toBeVisible();
    await expect(page.getByRole("button", { name: "تأكيد التوزيع" })).toHaveCount(0);
  });

  test("saves a draft distribution by quantity, then confirms it from the detail panel", async ({ page }) => {
    await page.getByRole("button", { name: "مستند تكلفة جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });

    await dialog.getByLabel("طريقة التوزيع *").selectOption({ label: "حسب الكمية" });
    await dialog.getByLabel("المبلغ").fill("150");
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("مسودة", { exact: true }).first()).toBeVisible();
    const draftRow = page.locator("table tbody tr").filter({ hasText: "مسودة" });
    await draftRow.click();

    await page.getByRole("button", { name: "تأكيد التوزيع" }).click();
    await expect(page.getByText("LC-000001").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "تأكيد التوزيع" })).toHaveCount(0);
  });
});
