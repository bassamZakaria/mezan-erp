import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Customers screen (apps/web/src/screens/CustomersScreen.tsx). 6 demo
 * customers (apps/web/src/partners-sample-data.ts's demoCustomers, 5 active +
 * 1 inactive). List (DocumentList) + add/edit form (SidePanel) + detail view
 * (DocumentDetail) with a real "نظرة عامة" tab and three Phase-2 stub tabs
 * (الفواتير/كشف حساب/المرفقات).
 */

function row(page: Page, nameAr: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(nameAr, { exact: true }) });
}

test.describe("Customers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "العملاء");
    await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
  });

  test("lists demo customers, filters by status chip and narrows by search", async ({ page }) => {
    await expect(page.getByText("عرض 6 من 6 عميل")).toBeVisible();
    await expect(row(page, "شركة الأمل للتجارة")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(6);

    // "غير نشط" is unambiguous even against the "نشط" chip's substring-matching
    // accessible name (each chip's visible count makes its name e.g. "نشط 5").
    await page.getByRole("tab", { name: "غير نشط" }).click();
    await expect(page.getByText("عرض 1 من 6 عميل")).toBeVisible();
    await expect(row(page, "مصنع الوادي الأخضر")).toBeVisible();
    await expect(row(page, "شركة الأمل للتجارة")).toBeHidden();

    await page.getByRole("tab", { name: "الكل" }).click();
    await expect(page.getByText("عرض 6 من 6 عميل")).toBeVisible();

    await page.getByLabel("بحث بالاسم أو الكود أو الهاتف…").fill("النور");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "مؤسسة النور للمقاولات")).toBeVisible();

    await page.getByLabel("بحث بالاسم أو الكود أو الهاتف…").fill("C000005");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "مصنع الوادي الأخضر")).toBeVisible();
  });

  test("adding a customer fills in required fields and appears in the list", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة عميل" }).click();
    const form = page.getByRole("dialog", { name: "إضافة عميل" });
    await expect(form).toBeVisible();

    await form.getByLabel("اسم العميل *").fill("عميل تجريبي جديد");
    await form.getByLabel("الهاتف").fill("01055500000");
    await form.getByLabel("الحد الائتماني").fill("5000");
    // Scoped to the dialog — its submit button shares the exact label
    // "إضافة عميل" with the page-level action button that opened it.
    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();

    await expect(form).toBeHidden();
    await expect(page.getByText("عرض 7 من 7 عميل")).toBeVisible();
    const newRow = row(page, "عميل تجريبي جديد");
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText("C000007")).toBeVisible();
    await expect(newRow.getByText("01055500000")).toBeVisible();
  });

  test("opening a customer shows its detail with a real overview tab and stub tabs, then returns to the list", async ({ page }) => {
    await row(page, "شركة الأمل للتجارة").click();

    const heading = page.getByRole("heading", { name: /شركة الأمل للتجارة/ });
    await expect(heading).toBeVisible();
    await expect(page.getByText("Al Amal Trading Co.")).toBeVisible();

    const tablist = page.getByRole("tablist").filter({ hasText: "نظرة عامة" });
    await expect(tablist.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");

    let panel = page.getByRole("tabpanel");
    await expect(panel.getByText("01012345001")).toBeVisible();
    await expect(panel.getByText("accounts@alamal.example")).toBeVisible();
    await expect(panel.getByText("محمود فتحي")).toBeVisible();

    await tablist.getByRole("tab", { name: "الفواتير" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText('تبويب "الفواتير" يُعرض فور ربط المستندات')).toBeVisible();

    await tablist.getByRole("tab", { name: "كشف حساب" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText('تبويب "كشف حساب" يُعرض فور ربط المستندات')).toBeVisible();

    await tablist.getByRole("tab", { name: "المرفقات" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText('تبويب "المرفقات" يُعرض فور ربط المستندات')).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة العملاء" }).click();
    await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
    await expect(row(page, "شركة الأمل للتجارة")).toBeVisible();
  });

  test("editing a customer via the detail view prefills the form and updates the record", async ({ page }) => {
    await row(page, "مجموعة الفجر التجارية").click();
    await page.getByRole("button", { name: "تعديل" }).click();

    const form = page.getByRole("dialog", { name: "تعديل عميل" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("الكود")).toBeDisabled();
    await expect(form.getByLabel("الكود")).toHaveValue("C000004");
    await expect(form.getByLabel("اسم العميل *")).toHaveValue("مجموعة الفجر التجارية");
    await expect(form.getByLabel("الهاتف")).toHaveValue("01555512004");

    await form.getByLabel("الهاتف").fill("01500000004");
    await form.getByRole("button", { name: "حفظ التعديلات" }).click();

    await expect(form).toBeHidden();
    // Still on the detail view for the same customer, now with the updated phone.
    await expect(page.getByRole("heading", { name: /مجموعة الفجر التجارية/ })).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText("01500000004")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة العملاء" }).click();
    await expect(row(page, "مجموعة الفجر التجارية").getByText("01500000004")).toBeVisible();
  });

  test("leaving the required name empty surfaces the domain validation error and keeps the form open", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة عميل" }).click();
    const form = page.getByRole("dialog", { name: "إضافة عميل" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();

    await expect(form.getByRole("alert")).toContainText("nameAr is required");
    await expect(form).toBeVisible();
    await expect(page.getByText("عرض 6 من 6 عميل")).toBeVisible();
  });
});
