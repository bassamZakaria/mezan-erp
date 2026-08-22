import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * Users & Roles (apps/web/src/pages/UsersPage.tsx, RolesPage.tsx). Demo seed
 * (apps/web/src/sample-data.ts): 5 users — 4 company admins (one inactive)
 * plus كريم عزت on the single custom role "مندوب مبيعات" (VAN_SALES, 4
 * permissions) — 1 branch (الفرع الرئيسي) and 2 warehouses. Deep
 * PermissionMatrix behaviour (role editor) lives in permission-matrix.spec.ts.
 */

function tableRow(page: Page, exactText: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(exactText, { exact: true }) });
}

/** Scopes a stat card by its exact label — StatCard's own "relative overflow-hidden" wrapper. */
function statCard(page: Page, label: string) {
  return page.locator("div.relative.overflow-hidden").filter({ has: page.getByText(label, { exact: true }) });
}

test.describe("Users", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "المستخدمون");
    await expect(page.getByRole("heading", { name: "المستخدمون" })).toBeVisible();
  });

  test("lists all demo users with correct stats and status chips", async ({ page }) => {
    await expect(page.getByText("عرض 5 من 5 مستخدم")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(5);

    await expect(statCard(page, "إجمالي المستخدمين")).toContainText("5");
    await expect(statCard(page, "مستخدمون نشطون")).toContainText("4");
    // Roles in use: the "company admin" bucket (4 users) + the VAN_SALES role (1 user) = 2 distinct.
    await expect(statCard(page, "الأدوار المستخدمة")).toContainText("2");
    await expect(statCard(page, "غير نشط")).toContainText("1");

    // Status-chip order is fixed in UsersPage.tsx (all/active/inactive); "نشط"
    // is a substring of "غير نشط" so an unscoped name match would hit both.
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await expect(tablist.getByRole("tab")).toHaveCount(3);
  });

  test("filtering by inactive status and searching both narrow the list", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab").nth(2).click(); // "غير نشط"
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(tableRow(page, "أحمد الجندي")).toBeVisible();

    await tablist.getByRole("tab").nth(0).click(); // "الكل"
    await expect(page.locator("table tbody tr")).toHaveCount(5);

    await page.getByPlaceholder("بحث بالاسم أو البريد الإلكتروني…").fill("kareem@cyag.test");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(tableRow(page, "كريم عزت")).toBeVisible();
  });

  test("shows role, branch scope, and last-login formatting per row", async ({ page }) => {
    const admin = tableRow(page, "محمد الشهابي");
    await expect(admin.getByText("مدير المنشأة", { exact: true })).toBeVisible();
    await expect(admin.locator("td").nth(2)).toHaveText("كل الفروع");
    await expect(admin.locator("td").nth(3)).toHaveText("21/08/2026");

    const vanUser = tableRow(page, "كريم عزت");
    await expect(vanUser.getByText("مندوب مبيعات", { exact: true })).toBeVisible();
    await expect(vanUser.locator("td").nth(2)).toHaveText("الفرع الرئيسي");

    const neverLoggedIn = tableRow(page, "يوسف محمد");
    await expect(neverLoggedIn.locator("td").nth(3)).toHaveText("لم يسجل بعد");
  });

  test("toggling a user's status flips its pill and the toggle button label", async ({ page }) => {
    const row = tableRow(page, "محمد الشهابي");
    await expect(row.getByText("نشط", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "تعطيل" }).click();
    await expect(row.getByText("غير نشط", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "تفعيل" })).toBeVisible();
  });

  test("validates required role/admin selection and branch scope before saving", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة مستخدم" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مستخدم" });
    await expect(form).toBeVisible();

    // A full name and email are required before saving reaches the domain layer.
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(form.getByText("الاسم الكامل مطلوب.")).toBeVisible();
    await form.getByLabel("الاسم الكامل *").fill("مستخدم اختبار التحقق");
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(form.getByText("البريد الإلكتروني مطلوب.")).toBeVisible();
    await form.getByLabel("البريد الإلكتروني *").fill("validation-test@cyag.test");

    // Neither a role nor the company-admin bypass is selected by default.
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(
      form.getByText("يجب أن يكون للمستخدم دور واحد فقط أو صلاحية مدير الشركة، وليس كليهما."),
    ).toBeVisible();
    await expect(form).toBeVisible(); // stays open on validation error

    // Bypass the role requirement via company-admin, but still no branch selected.
    await form.getByLabel("صلاحيات مدير المنشأة").check();
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(form.getByText("يجب اختيار فرع واحد على الأقل.")).toBeVisible();
  });

  test("creating a user with a role, then editing it, round-trips through the form", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة مستخدم" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مستخدم" });

    await form.getByLabel("الاسم الكامل *").fill("مستخدم اختبار");
    await form.getByLabel("البريد الإلكتروني *").fill("test.user@cyag.test");
    await form.getByLabel("كلمة مرور مؤقتة * (٨ أحرف على الأقل)").fill("Passw0rd1");

    const roleInput = form.getByLabel("الدور *");
    await roleInput.click();
    await page.getByRole("option", { name: "مندوب مبيعات" }).click();
    await expect(roleInput).toHaveAttribute("placeholder", "مندوب مبيعات");

    await form.getByLabel("الفرع الرئيسي", { exact: true }).check();
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();

    await expect(form).toBeHidden();
    await expect(page.getByText("عرض 6 من 6 مستخدم")).toBeVisible();
    await expect(tableRow(page, "مستخدم اختبار")).toBeVisible();

    // Re-open the newly created user and confirm the role picker shows the saved value.
    await tableRow(page, "مستخدم اختبار").click();
    const editForm = page.getByRole("dialog", { name: "تعديل مستخدم" });
    await expect(editForm).toBeVisible();
    await expect(editForm.getByLabel("الاسم الكامل *")).toHaveValue("مستخدم اختبار");
    const editRoleInput = editForm.getByLabel("الدور *");
    await expect(editRoleInput).toHaveAttribute("placeholder", "مندوب مبيعات");
  });
});

test.describe("Roles", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "الأدوار والصلاحيات");
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
  });

  test("lists the one demo custom role with correct stats", async ({ page }) => {
    await expect(page.getByText("عرض 1 من 1 دور")).toBeVisible();
    await expect(statCard(page, "إجمالي الأدوار")).toContainText("1");
    await expect(statCard(page, "أدوار مخصصة")).toContainText("1");
    await expect(statCard(page, "أدوار النظام")).toContainText("0");
    await expect(statCard(page, "إجمالي الصلاحيات الممنوحة")).toContainText("4");

    const row = tableRow(page, "مندوب مبيعات");
    await expect(row.locator("td").nth(1)).toHaveText("VAN_SALES");
    await expect(row.locator("td").nth(2)).toHaveText("4");
    await expect(row.getByText("مخصص", { exact: true })).toBeVisible();
  });

  test("filtering by kind narrows the list (no system roles exist in the demo tenant)", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab").nth(1).click(); // "نظام"
    await expect(page.getByText("لا توجد أدوار مطابقة")).toBeVisible();

    await tablist.getByRole("tab").nth(2).click(); // "مخصص"
    await expect(page.locator("table tbody tr")).toHaveCount(1);
  });

  test("the in-use role's delete button is disabled with an explanatory title", async ({ page }) => {
    const row = tableRow(page, "مندوب مبيعات");
    const deleteButton = row.getByRole("button", { name: "حذف" });
    await expect(deleteButton).toBeDisabled();
    await expect(deleteButton).toHaveAttribute("title", "الدور مستخدم من قبل مستخدمين");
  });

  test("'دور جديد' opens an empty role editor; 'تعديل' opens it pre-filled", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible();
    await expect(page.getByLabel("اسم الدور *")).toHaveValue("");
    await expect(page.getByLabel("رمز الدور *")).toBeEditable();
    await page.getByRole("button", { name: "إلغاء" }).click();
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();

    await tableRow(page, "مندوب مبيعات").getByRole("button", { name: "تعديل" }).click();
    await expect(page.getByRole("heading", { name: "تعديل الدور" })).toBeVisible();
    await expect(page.getByLabel("اسم الدور *")).toHaveValue("مندوب مبيعات");
    const codeField = page.getByLabel("رمز الدور *");
    await expect(codeField).toHaveValue("VAN_SALES");
    await expect(codeField).toBeDisabled(); // locked once a role exists, regardless of isSystem
    await expect(page.getByLabel("اسم الدور *")).toBeEditable(); // not a system role, so still editable
  });

  test("creating an unused custom role makes it deletable, and deleting removes it from the list", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await page.getByLabel("اسم الدور *").fill("دور بلا مستخدمين");
    await page.getByLabel("رمز الدور *").fill("EMPTY_ROLE");
    await page.getByRole("button", { name: "حفظ الدور" }).click();

    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
    await expect(page.getByText("عرض 2 من 2 دور")).toBeVisible();

    const newRow = tableRow(page, "دور بلا مستخدمين");
    const deleteButton = newRow.getByRole("button", { name: "حذف" });
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    await expect(page.getByText("عرض 1 من 1 دور")).toBeVisible();
    await expect(tableRow(page, "دور بلا مستخدمين")).toHaveCount(0);
  });
});
