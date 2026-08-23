import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Installments — Plans (خطط الأقساط) and Collection Follow-ups
 * (متابعة التحصيل), apps/web/src/screens/InstallmentPlansScreen.tsx /
 * InstallmentFollowUpsScreen.tsx. Both are document-framework-backed against
 * an in-memory client-side store (demo invoices/customers) — no network
 * calls, so each test's fresh browser context gets a fresh store and the
 * first plan is always IP-000001.
 */

test.describe("Installment Plans", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "خطط الأقساط");
    await expect(page.getByRole("heading", { name: "خطط الأقساط" })).toBeVisible();
  });

  test("splits an invoice's outstanding balance into a schedule and auto-confirms the plan", async ({ page }) => {
    await page.getByRole("button", { name: "خطة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "خطة أقساط جديدة" });

    // The default source invoice already has a positive remaining balance,
    // so a schedule preview renders immediately.
    await expect(dialog.getByText("معاينة الجدول")).toBeVisible();
    await dialog.getByLabel("عدد الأقساط *").fill("4");
    await dialog.getByLabel("التكرار *").selectOption({ label: "شهري" });

    const saveButton = dialog.getByRole("button", { name: "حفظ", exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("IP-000001")).toBeVisible();
    const row = page.locator("table tbody tr").filter({ hasText: "IP-000001" });
    await expect(row.getByText("نشط", { exact: true })).toBeVisible();
    await expect(row.getByText("شهري")).toBeVisible();

    await row.click();
    await expect(page.getByText("#1").first()).toBeVisible();
    await expect(page.getByText("#4").first()).toBeVisible();
  });

  test("processing overdue installments reports a summary", async ({ page }) => {
    await page.getByRole("button", { name: "معالجة المتأخرات" }).first().click();
    const dialog = page.getByRole("dialog", { name: "معالجة المتأخرات" });
    await dialog.getByRole("button", { name: "معالجة المتأخرات" }).click();
    // "تم تحديث \d" (not just /تم تحديث/) — the static instructions text
    // above ("سيتم تحديث...") also contains the substring "تم تحديث".
    await expect(dialog.getByText(/تم تحديث \d/)).toBeVisible();
    await expect(dialog.getByText(/غرامات مطبّقة/)).toBeVisible();
  });
});

test.describe("Installment Collection Follow-ups", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "متابعة التحصيل");
    await expect(page.getByRole("heading", { name: "متابعة التحصيل" })).toBeVisible();
    await expect(page.getByText("لم يتم إنشاء أي متابعات بعد")).toBeVisible();
  });

  test("logs a collection follow-up against a customer and completes it with an outcome", async ({ page }) => {
    await page.getByRole("button", { name: "متابعة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "متابعة جديدة" });

    await dialog.getByLabel("نوع المتابعة *").selectOption({ label: "زيارة" });
    await dialog.getByLabel("ملاحظات").fill("متابعة اختبار E2E");
    await dialog.getByRole("button", { name: "إضافة" }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator("table tbody tr").filter({ hasText: "زيارة" });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("معلق", { exact: true })).toBeVisible();

    await row.click();
    await page.getByLabel("النتيجة").fill("تم الاتفاق على السداد غداً");
    await page.getByRole("button", { name: "إكمال المتابعة" }).click();

    await expect(page.getByText("مكتمل", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "إكمال المتابعة" })).toHaveCount(0);
  });

  test("cancels a pending follow-up", async ({ page }) => {
    await page.getByRole("button", { name: "متابعة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "متابعة جديدة" });
    await dialog.getByLabel("نوع المتابعة *").selectOption({ label: "اتصال" });
    await dialog.getByRole("button", { name: "إضافة" }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator("table tbody tr").filter({ hasText: "اتصال" });
    await row.click();
    await page.getByRole("button", { name: "إلغاء" }).click();

    await expect(page.getByText("ملغي", { exact: true }).first()).toBeVisible();
  });
});
