import { test, expect, type Page } from "@playwright/test";
import { ApiError, DEMO_TENANT_CODE, PlanId, StorageKey, uniqueCode } from "./support/env";
import {
  createTenantInConsole,
  errorOf,
  openTenantDetail,
  platformSignIn,
  rowsOf,
  tenantApiLogin,
  tenantCall,
  tenantSignIn,
  type TenantLogin,
} from "./support/saas";

const TENANT_CODE = uniqueCode("cyag");
const TENANT_NAME = "شركة سياج";
const PAYMENT_REFERENCE = `INSTAPAY-${TENANT_CODE}`;
const CUSTOMER_NAME = `عميل ${TENANT_CODE}`;
const HR_REFUSAL = /وحدة الموارد البشرية غير/;
const READ_ONLY_REFUSAL = /وضع القراءة فقط/;

let tenant: TenantLogin;

async function periodEnd(page: Page): Promise<Date> {
  const text = await page.locator("main").innerText();
  const match = /نهاية الفترة\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  expect(match, "the subscription card shows نهاية الفترة").not.toBeNull();
  const [, day, month, year] = match as RegExpExecArray;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

async function addCustomer(page: Page, name: string): Promise<void> {
  await page.goto("/sell/customers");
  await page.getByRole("button", { name: "إضافة عميل" }).first().click();
  const dialog = page.getByRole("dialog", { name: "إضافة عميل" });
  await dialog.getByLabel("اسم العميل").fill(name);
  await dialog.getByRole("button", { name: "إضافة عميل" }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("PLT-SAAS-01..06 — the platform console and the tenant it creates", () => {
  test("PLT-SAAS-01 the platform owner signs in and sees only the seeded demo tenant", async ({ page }) => {
    await platformSignIn(page);
    const rail = page.getByRole("navigation", { name: "منصة Mezan" });
    for (const label of ["المنشآت", "الباقات", "المشغّلون"]) {
      await expect(rail.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(rail.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).getByRole("cell").first()).toHaveText(DEMO_TENANT_CODE);
  });

  test("PLT-SAAS-01 a wrong password is refused in Arabic and opens nothing", async ({ page }) => {
    await page.goto("/platform/login");
    await page.getByLabel("البريد الإلكتروني").fill("owner@mezan.local");
    await page.getByLabel("كلمة المرور").fill("not-the-password-1");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page.getByRole("alert")).toHaveText("بيانات الدخول غير صحيحة");
    await expect(page).toHaveURL(/\/platform\/login$/);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.PlatformSession)).toBeNull();
  });

  test("PLT-SAAS-02 creates a tenant on the business plan with a trial and shows the PIN once", async ({ page }) => {
    await platformSignIn(page);
    tenant = await createTenantInConsole(page, {
      code: TENANT_CODE,
      nameAr: TENANT_NAME,
      ownerNameAr: "أحمد سياج",
      planId: PlanId.Business,
      trial: true,
    });
    expect(tenant.adminPin).toMatch(/^\d{6}$/);
    const dialog = page.getByRole("dialog", { name: "منشأة جديدة" });
    await expect(dialog.getByText(tenant.adminPin, { exact: true })).toBeVisible();
    await expect(dialog.getByText(tenant.adminEmail, { exact: true })).toBeVisible();
    await expect(dialog.getByText(TENANT_CODE, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/لن يظهر رقم التعريف الشخصي مرة أخرى/).first()).toBeVisible();
    await dialog.getByRole("button", { name: "إغلاق", exact: true }).click();

    const row = page.getByRole("row").filter({ hasText: TENANT_CODE });
    await expect(row.getByRole("cell", { name: "نشطة", exact: true })).toBeVisible();
    await expect(row.getByRole("cell", { name: "الأعمال", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: TENANT_CODE })).toBeVisible();
    await expect(page.getByText(tenant.adminPin, { exact: true })).toHaveCount(0);

    await openTenantDetail(page, TENANT_CODE);
    await expect(page.getByRole("heading", { name: TENANT_NAME, level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*تجريبي/);
    await expect(page.locator("main")).toContainText(/نهاية الفترة التجريبية\s*\d{2}\/\d{2}\/\d{4}/);
  });

  test.fixme(
    "PLT-SAAS-02 the tenants list marks a trialing tenant as تجريبي [D-SAAS-09: the licence column shows «الترخيص نشط» for a tenant on trial — TenantsPage.tsx renders licenseState only, so an operator cannot tell a trial from a paying tenant without opening it]",
    async ({ page }) => {
      await platformSignIn(page);
      await expect(page.getByRole("row").filter({ hasText: TENANT_CODE }).getByText("تجريبي", { exact: true })).toBeVisible();
    },
  );

  test("PLT-SAAS-02 a second tenant cannot take the same code", async ({ page }) => {
    await platformSignIn(page);
    await page.getByRole("button", { name: "منشأة جديدة" }).click();
    const dialog = page.getByRole("dialog", { name: "منشأة جديدة" });
    await dialog.getByLabel("الكود").fill(TENANT_CODE);
    await dialog.getByLabel("الاسم بالعربية").fill("منشأة مكررة");
    await dialog.getByLabel("اسم مالك الحساب").fill("مالك آخر");
    await dialog.getByLabel("البريد الإلكتروني لمالك الحساب").fill("other@dup.example");
    await dialog.getByRole("combobox", { name: "الباقة" }).click();
    await page.getByRole("option", { name: /core$/ }).click();
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/platform/tenants" && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "إنشاء المنشأة" }).click();
    expect((await refused).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toContainText(/[؀-ۿ]/);
    await expect(dialog.getByRole("alert")).not.toContainText(/[A-Z]{2,}_[A-Z_]{2,}/);
  });

  test("PLT-SAAS-03 the tenant owner signs in with company code, email and the one-time PIN", async ({ page }) => {
    await tenantSignIn(page, tenant);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("أحمد");

    await page.goto("/sell/customers");
    await expect(page.getByText("لا يوجد عملاء مطابقون")).toBeVisible();
    await expect(page.getByText(/عرض 0 من 0 عميل/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "العملاء", level: 1 })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.TenantCode)).toBe(TENANT_CODE);
  });

  test("PLT-SAAS-03 the one-time PIN of one tenant does not open another", async ({ page }) => {
    await tenantSignIn(page, tenant);
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await page.getByRole("button", { name: "تغيير المنشأة" }).click();
    const field = page.getByRole("textbox", { name: "رمز المنشأة" });
    await field.fill(DEMO_TENANT_CODE);
    await field.blur();
    await expect(page.getByRole("button", { name: "تغيير المنشأة" })).toBeVisible();
    const email = page.getByRole("textbox", { name: "البريد الإلكتروني" });
    if (!(await email.isVisible())) await page.getByRole("button", { name: "آخر", exact: true }).click();
    await email.fill(tenant.adminEmail);
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/login");
    for (const [index, digit] of [...tenant.adminPin].entries()) {
      await page.getByLabel(`رمز PIN رقم ${index + 1}`).fill(digit);
    }
    expect((await refused).status()).toBe(401);
    await expect(page.getByRole("alert")).toContainText(/[؀-ۿ]/);
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
  });

  test("PLT-SAAS-04 a module outside the plan is refused with the server's Arabic sentence", async ({ page, request }) => {
    const api = await tenantApiLogin(request, tenant);
    const refusal = await tenantCall(request, api, "GET", "/hr/employees");
    expect(refusal.status).toBe(403);
    expect(errorOf(refusal).error).toBe(ApiError.ModuleNotLicensed);
    const sentence = errorOf(refusal).message ?? "";
    expect(sentence).toMatch(HR_REFUSAL);

    const entitlements = await tenantCall(request, api, "GET", "/entitlements");
    const active = (entitlements.body as { activeModules: string[] }).activeModules;
    expect(active).not.toContain("hr");
    expect(active).not.toContain("manufacturing");
    expect(active).toContain("sales");

    await tenantSignIn(page, tenant);
    const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    await expect(rail.getByRole("button", { name: "البيع والتحصيل", exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "الأشخاص", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "التصنيع", exact: true })).toHaveCount(0);

    await page.goto("/people/employees");
    const main = page.locator("main");
    await expect(main.getByText(sentence, { exact: true })).toBeVisible();
    await expect(main).not.toContainText(ApiError.ModuleNotLicensed);
    await expect(main).not.toContainText("تعذّر تحميل");
  });

  test("PLT-SAAS-05 the operator records a payment and the period extends", async ({ page }) => {
    await platformSignIn(page);
    await openTenantDetail(page, TENANT_CODE);
    const before = await periodEnd(page);

    await page.getByRole("button", { name: "تسجيل دفعة" }).click();
    const dialog = page.getByRole("dialog", { name: "تسجيل دفعة" });
    await dialog.getByLabel("المبلغ").fill("980");
    await dialog.getByLabel("المرجع").fill(PAYMENT_REFERENCE);
    const recorded = page.waitForResponse((r) => /\/api\/platform\/tenants\/[^/]+\/payments$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "تسجيل الدفعة" }).click();
    expect((await recorded).status()).toBe(201);
    await expect(dialog).toBeHidden();

    const main = page.locator("main");
    await expect(main.getByText(PAYMENT_REFERENCE)).toBeVisible();
    await expect(main).toContainText(/حالة الاشتراك\s*نشط/);
    expect((await periodEnd(page)).getTime()).toBeGreaterThan(before.getTime());

    await page.reload();
    await expect(main.getByText(PAYMENT_REFERENCE)).toBeVisible();
    await expect(main).toContainText(/حالة الاشتراك\s*نشط/);
    expect((await periodEnd(page)).getTime()).toBeGreaterThan(before.getTime());
  });

  test("PLT-SAAS-05 a payment with no amount is refused before it reaches the server", async ({ page }) => {
    await platformSignIn(page);
    await openTenantDetail(page, TENANT_CODE);
    await page.getByRole("button", { name: "تسجيل دفعة" }).click();
    const dialog = page.getByRole("dialog", { name: "تسجيل دفعة" });
    await dialog.getByLabel("المرجع").fill("NO-AMOUNT");
    await dialog.getByRole("button", { name: "تسجيل الدفعة" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("المبلغ والمرجع مطلوبان.");
    await expect(dialog).toBeVisible();
  });

  test("PLT-SAAS-06 suspending refuses writes in Arabic, keeps reads, and resume restores", async ({ page, request, browser }) => {
    await platformSignIn(page);
    await openTenantDetail(page, TENANT_CODE);
    await page.getByRole("button", { name: "إيقاف المنشأة" }).click();
    await expect(page.locator("main").getByText("موقوفة", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "استئناف المنشأة" })).toBeVisible();

    const api = await tenantApiLogin(request, tenant);
    const write = await tenantCall(request, api, "POST", "/customers", { nameAr: "عميل مرفوض" });
    expect(write.status).toBe(403);
    expect(errorOf(write).error).toBe(ApiError.LicenseReadOnly);
    expect(errorOf(write).message ?? "").toMatch(READ_ONLY_REFUSAL);
    const read = await tenantCall(request, api, "GET", "/customers");
    expect(read.status).toBe(200);

    const tenantContext = await browser.newContext();
    const tenantPage = await tenantContext.newPage();
    await tenantSignIn(tenantPage, tenant);
    const refused = tenantPage.waitForResponse((r) => new URL(r.url()).pathname === "/api/customers" && r.request().method() === "POST");
    await addCustomer(tenantPage, "عميل أثناء الإيقاف");
    expect((await refused).status()).toBe(403);
    const dialog = tenantPage.getByRole("dialog", { name: "إضافة عميل" });
    await expect(dialog.getByText(READ_ONLY_REFUSAL)).toBeVisible();
    await expect(dialog).not.toContainText(ApiError.LicenseReadOnly);
    await tenantPage.reload();
    await expect(tenantPage.getByRole("heading", { name: "العملاء", level: 1 })).toBeVisible();
    await expect(tenantPage.getByText("عميل أثناء الإيقاف")).toHaveCount(0);

    await page.getByRole("button", { name: "استئناف المنشأة" }).click();
    await expect(page.locator("main").getByText("نشطة", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator("main").getByText("نشطة", { exact: true })).toBeVisible();

    const created = tenantPage.waitForResponse((r) => new URL(r.url()).pathname === "/api/customers" && r.request().method() === "POST");
    await addCustomer(tenantPage, CUSTOMER_NAME);
    expect((await created).status()).toBe(201);
    await tenantPage.reload();
    await expect(tenantPage.getByRole("cell", { name: CUSTOMER_NAME }).first()).toBeVisible();
    const after = await tenantCall(request, api, "GET", "/customers");
    expect(rowsOf(after.body).map((row) => row["nameAr"])).toContain(CUSTOMER_NAME);
    await tenantContext.close();
  });

  test.fixme(
    "PLT-SAAS-06 suspending a tenant asks for confirmation first [D-SAAS-10: «إيقاف المنشأة» suspends on a single click with no confirm dialog and no reason, unlike archive and subscription-suspend on the same page — TenantDetailPage.tsx]",
    async ({ page }) => {
      await platformSignIn(page);
      await openTenantDetail(page, TENANT_CODE);
      await page.getByRole("button", { name: "إيقاف المنشأة" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await expect(page.locator("main").getByText("نشطة", { exact: true })).toBeVisible();
    },
  );
});
