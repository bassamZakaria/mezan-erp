import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "../support/auth";

test.describe("Cheques journey", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("an incoming cheque from a seeded customer is registered, then deposited", async ({ page }) => {
    const chequeNo = String(Date.now()).slice(-7);
    await page.goto("/treasury/cheques");
    await expect(page.getByRole("heading", { name: "سجل الشيكات", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "شيك جديد" }).click();
    await page.getByRole("button", { name: /^واردة/ }).click();
    await page.getByRole("combobox", { name: "اختر العميل..." }).click();
    const customer = page.getByRole("option").first();
    const customerName = ((await customer.textContent()) ?? "").trim();
    await customer.click();
    await page.getByRole("textbox", { name: "رقم الشيك *" }).fill(chequeNo);
    await page.getByRole("textbox", { name: "اسم البنك *" }).fill("بنك مصر");
    await page.getByRole("textbox", { name: "المبلغ" }).fill("1500");
    await page.getByRole("combobox", { name: "اختر الفرع..." }).click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "حفظ الشيك" }).click();

    const row = page.getByRole("row").filter({ hasText: chequeNo });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1,500.00");
    await expect(row).toContainText(customerName.split(/\s+/)[0]!);
    await expect(row).toContainText("قيد الانتظار");

    await row.getByRole("button", { name: `إجراءات ${chequeNo}` }).click();
    await page.getByRole("menuitem", { name: "إيداع في البنك" }).click();
    await expect(page.getByRole("row").filter({ hasText: chequeNo })).toContainText("تحت التحصيل بالبنك");
  });
});
