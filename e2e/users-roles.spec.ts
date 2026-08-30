import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * Users & Roles (apps/web/src/pages/UsersPage.tsx, RolesPage.tsx). The e2e
 * backend now seeds exactly ONE user (the admin, محمد الشهابي) and ZERO
 * custom roles — no more أحمد الجندي / يوسف محمد / كريم عزت or a seeded
 * "مندوب مبيعات" (VAN_SALES) role — so every test creates its own fixtures,
 * isolated by a unique name. "Roles" runs FIRST in this file (before any
 * test creates one) so its "lists no custom roles" check has a clean count.
 *
 * The add/edit user form is a dialog (SidePanel); its fields are a LOCAL
 * `TextField` inside UsersPage.tsx that properly nests the `<input>` inside
 * the `<label>` — `getByLabel` works correctly here, unlike the customer/
 * supplier/treasury forms built on `../settings/form-controls` (see
 * e2e/support/broken-label.ts). The role editor is a full sub-page.
 * Deep PermissionMatrix behaviour lives in permission-matrix.spec.ts.
 */

function tableRow(page: Page, exactText: string) {
  return page.locator("table tbody tr").filter({ has: page.getByText(exactText, { exact: true }) });
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createRole(page: Page, name: string, code: string): Promise<void> {
  await expandSidebarGroup(page, "الإعدادات");
  await clickSidebarItem(page, "الأدوار والصلاحيات");
  await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
  await page.getByRole("button", { name: "دور جديد" }).click();
  await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible();
  await page.getByLabel("اسم الدور *").fill(name);
  await page.getByLabel("رمز الدور *").fill(code);
  // sales.invoice.view_own is a real permission code (verified against
  // packages/domain/src/permissions/catalog.ts) — its module (المبيعات)
  // needs expanding first.
  await page.getByRole("button", { name: /^المبيعات\s+\d/ }).click();
  await page.locator('[data-permission-code="sales.invoice.view_own"] input[type="checkbox"]').check();
  await page.getByRole("button", { name: "حفظ الدور" }).click();
  await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
}

// Both baseline counts must be checked BEFORE anything below creates a user
// or a role — every other describe block mutates one or both, and since
// specs in this file share the backend and run in declaration order, this
// block has to come first.
test.describe("Users & Roles — clean-seed baseline", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
  });

  test("lists no custom roles in the freshly-seeded tenant — only the built-in مدير النظام", async ({ page }) => {
    await clickSidebarItem(page, "الأدوار والصلاحيات");
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
    // "مدير النظام" (SYSTEM_ADMIN) is a seeded system role now — the custom
    // count is what starts at zero.
    await expect(tableRow(page, "مدير النظام")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
  });

  test("lists the seeded admin as the sole active user", async ({ page }) => {
    await clickSidebarItem(page, "المستخدمون");
    await expect(page.getByRole("heading", { name: "المستخدمون" })).toBeVisible();
    await expect(page.getByText("عرض 1 من 1 مستخدم")).toBeVisible();
    const row = tableRow(page, "محمد الشهابي");
    await expect(row.getByText("نشط", { exact: true })).toBeVisible();
    await expect(row.getByText("مدير المنشأة", { exact: true })).toBeVisible();
  });
});

test.describe("Roles", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "الأدوار والصلاحيات");
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
  });

  test("'دور جديد' opens an empty role editor; creating an unused role makes it deletable, and deleting removes it", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible();
    await expect(page.getByLabel("اسم الدور *")).toHaveValue("");
    await expect(page.getByLabel("رمز الدور *")).toBeEditable();
    await page.getByRole("button", { name: "إلغاء" }).click();
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();

    const roleName = unique("دور بلا مستخدمين");
    await page.getByRole("button", { name: "دور جديد" }).click();
    await page.getByLabel("اسم الدور *").fill(roleName);
    await page.getByLabel("رمز الدور *").fill(`EMPTY${Date.now() % 100000}`);
    await page.getByRole("button", { name: "حفظ الدور" }).click();
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();

    const newRow = tableRow(page, roleName);
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText("مخصص", { exact: true })).toBeVisible();
    const deleteButton = newRow.getByRole("button", { name: "حذف" });
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    await expect(tableRow(page, roleName)).toHaveCount(0);
  });

  test("a role used by a real user has its delete button disabled with an explanatory title", async ({ page }) => {
    const roleName = unique("دور مستخدم فعلياً");
    const roleCode = `USED${Date.now() % 100000}`;
    await createRole(page, roleName, roleCode);

    await clickSidebarItem(page, "المستخدمون");
    await expect(page.getByRole("heading", { name: "المستخدمون" })).toBeVisible();
    await page.getByRole("button", { name: "إضافة مستخدم" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مستخدم" });
    await form.getByLabel("الاسم بالعربية").fill(unique("مستخدم لدور مستخدم"));
    await form.getByLabel("البريد الإلكتروني *").fill(`${Date.now()}-${Math.floor(Math.random() * 100000)}@cyag.test`);
    await form.getByLabel(/كلمة مرور مؤقتة/).fill("Passw0rd1");
    const roleInput = form.getByLabel("الدور *");
    await roleInput.click();
    await page.getByRole("option", { name: roleName }).click();
    await form.getByLabel("الفرع الرئيسي", { exact: true }).check();
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(form).toBeHidden();

    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "الأدوار والصلاحيات");
    const row = tableRow(page, roleName);
    const deleteButton = row.getByRole("button", { name: "حذف" });
    await expect(deleteButton).toBeDisabled();
    await expect(deleteButton).toHaveAttribute("title", "الدور مستخدم من قبل مستخدمين");
  });
});

test.describe("Users", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "المستخدمون");
    await expect(page.getByRole("heading", { name: "المستخدمون" })).toBeVisible();
  });

  test("leaving the required name or email empty surfaces the domain validation error and keeps the form open", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة مستخدم" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مستخدم" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(form.getByText("الاسم الكامل مطلوب.")).toBeVisible();

    await form.getByLabel("الاسم بالعربية").fill(unique("مستخدم اختبار التحقق"));
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(form.getByText("البريد الإلكتروني مطلوب.")).toBeVisible();
    await expect(form).toBeVisible();
  });

  test("creating a user with a role, then editing it, round-trips through the form", async ({ page }) => {
    const roleName = unique("مندوب اختبار");
    const roleCode = `ROLE${Date.now() % 100000}`;
    await createRole(page, roleName, roleCode);

    await clickSidebarItem(page, "المستخدمون");
    await expect(page.getByRole("heading", { name: "المستخدمون" })).toBeVisible();

    const userName = unique("مستخدم اختبار");
    const email = `${Date.now()}-${Math.floor(Math.random() * 100000)}@cyag.test`;
    await page.getByRole("button", { name: "إضافة مستخدم" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مستخدم" });

    await form.getByLabel("الاسم بالعربية").fill(userName);
    await form.getByLabel("البريد الإلكتروني *").fill(email);
    await form.getByLabel(/كلمة مرور مؤقتة/).fill("Passw0rd1");

    const roleInput = form.getByLabel("الدور *");
    await roleInput.click();
    await page.getByRole("option", { name: roleName }).click();
    await expect(roleInput).toHaveValue(roleName);

    await form.getByLabel("الفرع الرئيسي", { exact: true }).check();
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();

    await expect(form).toBeHidden();
    await expect(tableRow(page, userName)).toBeVisible();
    await expect(tableRow(page, userName).getByText(roleName, { exact: true })).toBeVisible();

    // Re-open the newly created user and confirm the role picker shows the saved value.
    await tableRow(page, userName).click();
    const editForm = page.getByRole("dialog", { name: "تعديل مستخدم" });
    await expect(editForm).toBeVisible();
    await expect(editForm.getByLabel("الاسم بالعربية")).toHaveValue(userName);
    const editRoleInput = editForm.getByLabel("الدور *");
    await expect(editRoleInput).toHaveValue(roleName);
  });

  test("toggling a user's status flips its pill and the toggle button label", async ({ page }) => {
    const userName = unique("مستخدم تعطيل");
    const email = `${Date.now()}-${Math.floor(Math.random() * 100000)}@cyag.test`;
    await page.getByRole("button", { name: "إضافة مستخدم" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مستخدم" });
    await form.getByLabel("الاسم بالعربية").fill(userName);
    await form.getByLabel("البريد الإلكتروني *").fill(email);
    await form.getByLabel(/كلمة مرور مؤقتة/).fill("Passw0rd1");
    await form.getByLabel(/صلاحيات مدير المنشأة/).check();
    await form.getByLabel("الفرع الرئيسي", { exact: true }).check();
    await form.getByRole("button", { name: "حفظ المستخدم" }).click();
    await expect(form).toBeHidden();

    const row = tableRow(page, userName);
    await expect(row.getByText("نشط", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "تعطيل" }).click();
    await expect(row.getByText("غير نشط", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "تفعيل" })).toBeVisible();
  });
});
