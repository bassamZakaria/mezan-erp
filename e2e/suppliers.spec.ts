import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Suppliers screen (apps/web/src/screens/SuppliersScreen.tsx), the mirror of
 * CustomersScreen.tsx. 5 demo suppliers (the seeded
 * demoSuppliers, 4 active + 1 inactive). List (DocumentList) + add/edit form
 * (SidePanel) + detail view (DocumentDetail) with a real "نظرة عامة" tab and
 * three Phase-2 stub tabs (فواتير المشتريات/كشف حساب المورد/المرفقات).
 */

function row(page: Page, nameAr: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(nameAr, { exact: true }) });
}

test.describe("Suppliers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الموردون");
    await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
  });

  test("lists demo suppliers, filters by status chip and narrows by search", async ({ page }) => {
    await expect(page.getByText("عرض 5 من 5 مورد")).toBeVisible();
    await expect(row(page, "جاري")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(5);

    // "غير نشط" is unambiguous even against the "نشط" chip's substring-matching
    // accessible name (each chip's visible count makes its name e.g. "نشط 4").
    await page.getByRole("tab", { name: "غير نشط" }).click();
    await expect(page.getByText("عرض 1 من 5 مورد")).toBeVisible();
    await expect(row(page, "مورد قطع الغيار الشرقي")).toBeVisible();
    await expect(row(page, "جاري")).toBeHidden();

    await page.getByRole("tab", { name: "الكل" }).click();
    await expect(page.getByText("عرض 5 من 5 مورد")).toBeVisible();

    await page.getByLabel("ابحث باسم المورد أو الكود أو الهاتف…").fill("التغليف");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "مؤسسة التغليف الحديث")).toBeVisible();

    await page.getByLabel("ابحث باسم المورد أو الكود أو الهاتف…").fill("S000003");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "شركة الخدمات المتكاملة")).toBeVisible();
  });

  test("adding a supplier fills in required fields and appears in the list", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة مورد" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مورد" });
    await expect(form).toBeVisible();

    await form.getByLabel("اسم المورد *").fill("مورد تجريبي جديد");
    await form.getByLabel("الهاتف").fill("01066600000");
    await form.getByLabel("الرصيد الافتتاحي").fill("1500");
    // Scoped to the dialog — its submit button shares the exact label
    // "إضافة مورد" with the page-level action button that opened it.
    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();

    await expect(form).toBeHidden();
    await expect(page.getByText("عرض 6 من 6 مورد")).toBeVisible();
    const newRow = row(page, "مورد تجريبي جديد");
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText("S000006")).toBeVisible();
    await expect(newRow.getByText("01066600000")).toBeVisible();
  });

  test("opening a supplier shows its detail with a real overview tab and stub tabs, then returns to the list", async ({ page }) => {
    await row(page, "جاري").click();

    const heading = page.getByRole("heading", { name: /جاري/ });
    await expect(heading).toBeVisible();
    await expect(page.getByText("Gary Supply Co.")).toBeVisible();

    const tablist = page.getByRole("tablist").filter({ hasText: "نظرة عامة" });
    await expect(tablist.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");

    let panel = page.getByRole("tabpanel");
    await expect(panel.getByText("sales@gary.example")).toBeVisible();
    await expect(panel.getByText("كريم عادل")).toBeVisible();
    await expect(panel.getByText("شارع مكرم عبيد، مدينة نصر، القاهرة")).toBeVisible();

    await tablist.getByRole("tab", { name: "فواتير المشتريات" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText('تبويب "فواتير المشتريات" يُعرض فور ربط المستندات')).toBeVisible();

    await tablist.getByRole("tab", { name: "كشف حساب المورد" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText('تبويب "كشف حساب المورد" يُعرض فور ربط المستندات')).toBeVisible();

    await tablist.getByRole("tab", { name: "المرفقات" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText('تبويب "المرفقات" يُعرض فور ربط المستندات')).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة الموردين" }).click();
    await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
    await expect(row(page, "جاري")).toBeVisible();
  });

  test("editing a supplier via the detail view prefills the form and updates the record", async ({ page }) => {
    await row(page, "مؤسسة التغليف الحديث").click();
    await page.getByRole("button", { name: "تعديل" }).click();

    const form = page.getByRole("dialog", { name: "تعديل مورد" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("الكود")).toBeDisabled();
    await expect(form.getByLabel("الكود")).toHaveValue("S000004");
    await expect(form.getByLabel("اسم المورد *")).toHaveValue("مؤسسة التغليف الحديث");
    await expect(form.getByLabel("الهاتف")).toHaveValue("01098760004");

    await form.getByLabel("الهاتف").fill("01000000004");
    await form.getByRole("button", { name: "حفظ التعديلات" }).click();

    await expect(form).toBeHidden();
    // Still on the detail view for the same supplier — its phone lives in the
    // summary strip (not the overview tabpanel) for suppliers.
    await expect(page.getByRole("heading", { name: /مؤسسة التغليف الحديث/ })).toBeVisible();
    await expect(page.getByText("01000000004")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقائمة الموردين" }).click();
    await expect(row(page, "مؤسسة التغليف الحديث").getByText("01000000004")).toBeVisible();
  });

  test("leaving the required name empty surfaces the domain validation error and keeps the form open", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة مورد" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مورد" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "إضافة مورد", exact: true }).click();

    await expect(form.getByRole("alert")).toContainText("الاسم بالعربية مطلوب");
    await expect(form).toBeVisible();
    await expect(page.getByText("عرض 5 من 5 مورد")).toBeVisible();
  });
});
