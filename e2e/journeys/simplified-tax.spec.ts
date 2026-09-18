import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "../support/auth";

test.describe("Simplified tax regime journey", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("recording the filed election saves it and it survives a reload", async ({ page }) => {
    await page.goto("/money/tax-simplified-regime");
    await expect(page.getByRole("heading", { name: "النظام الضريبي المبسط للمشروعات الصغيرة", level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText("حجم الأعمال في الفترة");

    const status = page.getByRole("combobox", { name: "الحالة المسجَّلة" });
    await status.click();
    await page.getByRole("option", { name: "مسجَّل ونافذ", exact: true }).click();
    const reference = `110-${String(Date.now()).slice(-6)}`;
    await page.getByRole("textbox", { name: "تاريخ نموذج 1/10 المقدَّم" }).fill("2026-03-15");
    await page.getByRole("textbox", { name: "رقم نموذج 1/10" }).fill(reference);
    await page.getByRole("textbox", { name: "تاريخ الانضمام للفاتورة/الإيصال الإلكتروني" }).fill("2025-11-01");
    await page.getByRole("button", { name: "حفظ التسجيل" }).click();

    await expect(page.locator("main [role=alert]")).toHaveCount(0);
    await expect(status).toHaveText("مسجَّل ونافذ");
    await page.reload();
    await expect(page.getByRole("combobox", { name: "الحالة المسجَّلة" })).toHaveText("مسجَّل ونافذ");
    await expect(page.getByRole("textbox", { name: "رقم نموذج 1/10" })).toHaveValue(reference);
  });
});
