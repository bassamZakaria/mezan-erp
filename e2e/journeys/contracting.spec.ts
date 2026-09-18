import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "../support/auth";

test.describe("Contracting journey", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("a progress certificate is raised on a seeded contract and its measurement approved; its preparer cannot also certify it", async ({ page }) => {
    await page.goto("/contracting/certificates");
    await expect(page.getByRole("heading", { name: "المستخلصات", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "مستخلص جديد" }).click();
    await page.getByRole("combobox", { name: "العقد" }).click();
    await page.getByRole("option", { name: /CTR-0002/ }).click();
    await page.getByRole("button", { name: "حفظ كمسودة" }).click();

    await expect(page).toHaveURL(/\/contracting\/certificates\/MST-\d+$/);
    const number = page.url().match(/MST-\d+/)![0];
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText(number);
    const main = page.locator("main");
    await expect(main).toContainText("مسودة");

    const line = main.getByRole("row").filter({ has: page.getByRole("textbox", { name: "هذا المستخلص" }) }).first();
    await line.getByRole("textbox", { name: "هذا المستخلص" }).fill("100");
    await main.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(line.getByRole("cell").last()).not.toHaveText("0.00");
    await expect(main).toContainText(/المنفذ التراكمي\s*[1-9][\d,]*\.\d\d/);

    await main.getByRole("button", { name: "اعتماد الحصر" }).click();
    await expect(main).toContainText("حصر معتمد");

    await main.getByRole("button", { name: "اعتماد الاستشاري" }).click();
    await expect(page.getByText("لا يجوز اعتماد المستخلص من نفس الشخص الذي أعدّه", { exact: false })).toBeVisible();

    await page.goto("/contracting/certificates");
    const row = page.getByRole("row").filter({ hasText: number });
    await expect(row).toContainText("حصر معتمد");
  });
});
