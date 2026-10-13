import { type APIRequestContext, type Page } from "@playwright/test";
import { test, expect, directApi } from "./support/test";
import {
  ApiError,
  CodePrefix,
  HttpMethod,
  INVALID_CREDENTIALS_SENTENCE,
  LICENSE_READ_ONLY_SENTENCE,
  Module,
  PlanId,
  SAAS_API_URL,
  SUITE_TENANT_CODE,
  StorageKey,
  SubscriptionStatus,
  TENANT_HEADER,
  tenantCodeTakenSentence,
  uniqueCode,
} from "./support/env";
import {
  addCustomer,
  createTenantInConsole,
  enterCredentials,
  errorOf,
  openTenantDetail,
  platformSignIn,
  platformToken,
  provisionTenant,
  rowsOf,
  tenantApiLogin,
  tenantCall,
  tenantSignIn,
  type TenantLogin,
} from "./support/saas";

const TENANT_CODE = uniqueCode(CodePrefix.Console);
const TENANT_NAME = "شركة سياج";
const PAYMENT_REFERENCE = `INSTAPAY-${TENANT_CODE}`;
const PAYMENT_AMOUNT = "980";
const CUSTOMER_NAME = `عميل ${TENANT_CODE}`;
const HR_REFUSAL = "وحدة الموارد البشرية ليست ضمن باقة «الأعمال». يمكنكم إضافتها بترقية الباقة من صفحة الاشتراك.";
const SCREEN_NOT_LICENSED = "هذه الشاشة ليست ضمن ترخيص منشأتك";
const READ_ONLY_BANNER = "الترخيص غير فعّال — وضع القراءة فقط";
const SUSPEND_QUESTION = "إيقاف المنشأة؟";
const RESET_OWNER_PIN = "إعادة تعيين رمز المالك";
const RESET_OWNER_PIN_QUESTION = "إعادة تعيين رمز المالك؟";
const FIRST_PERIOD_END = "2027-02-28";
const RENEWED_PERIOD_END = "2027-03-31";

interface PlatformSubscription {
  readonly status: string;
  readonly currentPeriodEnd: string;
}

interface PlatformPayment {
  readonly amount: string;
  readonly reference: string;
}

let tenant: TenantLogin;
let paying: TenantLogin;

async function periodEnd(page: Page): Promise<Date> {
  const text = await page.locator("main").innerText();
  const match = /نهاية الفترة\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  expect(match, "the subscription card shows نهاية الفترة").not.toBeNull();
  const [, day, month, year] = match as RegExpExecArray;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

async function platformGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const token = await platformToken(request);
  const response = await request.get(`${SAAS_API_URL}/api/platform${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  return (await response.json()) as T;
}

async function subscriptionOf(request: APIRequestContext, tenantId: string): Promise<PlatformSubscription> {
  return (await platformGet<{ subscription: PlatformSubscription }>(request, `/tenants/${tenantId}`)).subscription;
}

test.describe.configure({ mode: "serial" });

test.describe("PLT-SAAS-01..06 — the platform console and the tenant it creates", () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await directApi(playwright);
    paying = await provisionTenant(request, { code: uniqueCode(CodePrefix.Paying), nameAr: "شركة مدفوعة", ownerNameAr: "هالة المدفوعة", planId: PlanId.Enterprise, trial: false });
    await request.dispose();
  });

  test("PLT-SAAS-01 the platform owner signs in and sees the paying tenant and nothing this suite did not create", async ({ page }) => {
    await platformSignIn(page);
    const rail = page.getByRole("navigation", { name: "منصة Mezan" });
    for (const label of ["المنشآت", "الباقات", "المشغّلون"]) {
      await expect(rail.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(rail.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByRole("row").filter({ has: page.getByRole("cell", { name: paying.code, exact: true }) })).toHaveCount(1);
    const codes = await table.locator("tbody tr td:first-child").allInnerTexts();
    expect(codes).toContain(paying.code);
    expect(codes.filter((code) => !SUITE_TENANT_CODE.test(code))).toEqual([]);
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

  test("PLT-SAAS-02 the tenants list marks the trialing tenant as تجريبي, not as a paid licence [guards D-SAAS-09]", async ({ page }) => {
    await platformSignIn(page);
    const row = page.getByRole("row").filter({ hasText: TENANT_CODE });
    await expect(row.getByText("تجريبي", { exact: true })).toBeVisible();
    await expect(row.getByText("الترخيص نشط", { exact: true })).toHaveCount(0);
    const paid = page.getByRole("row").filter({ has: page.getByRole("cell", { name: paying.code, exact: true }) });
    await expect(paid).toHaveCount(1);
    await expect(paid.getByText("تجريبي", { exact: true })).toHaveCount(0);
  });

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
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/platform/tenants" && r.request().method() === HttpMethod.Post);
    await dialog.getByRole("button", { name: "إنشاء المنشأة" }).click();
    const response = await refused;
    expect(response.status()).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(ApiError.TenantCodeTaken);
    await expect(dialog.getByRole("alert")).toHaveText(tenantCodeTakenSentence(TENANT_CODE));

    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: TENANT_CODE })).toHaveCount(1);
    await expect(page.getByText("منشأة مكررة")).toHaveCount(0);
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
    await field.fill(paying.code);
    await field.blur();
    await expect(page.getByRole("button", { name: "تغيير المنشأة" })).toBeVisible();
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/login");
    await enterCredentials(page, tenant.adminEmail, tenant.adminPin);
    expect((await refused).status()).toBe(401);
    await expect(page.getByRole("alert")).toHaveText(INVALID_CREDENTIALS_SENTENCE);
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.Session)).toBeNull();
  });

  test("PLT-SAAS-04 a module outside the plan is refused by the server in Arabic, and its screen is not opened", async ({ page, request }) => {
    const api = await tenantApiLogin(request, tenant);
    const refusal = await tenantCall(request, api, HttpMethod.Get, "/hr/employees");
    expect(refusal.status).toBe(403);
    expect(errorOf(refusal).error).toBe(ApiError.ModuleNotLicensed);
    expect(errorOf(refusal).message).toBe(HR_REFUSAL);

    const entitlements = await tenantCall(request, api, HttpMethod.Get, "/entitlements");
    const active = (entitlements.body as { activeModules: string[] }).activeModules;
    expect(active).not.toContain(Module.Hr);
    expect(active).not.toContain(Module.Manufacturing);
    expect(active).toContain(Module.Sales);

    await tenantSignIn(page, tenant);
    const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    await expect(rail.getByRole("button", { name: "البيع والتحصيل", exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "الأشخاص", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "التصنيع", exact: true })).toHaveCount(0);

    await page.goto("/people/employees");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { level: 1, name: SCREEN_NOT_LICENSED, exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "موظف جديد" })).toHaveCount(0);
    await expect(main).not.toContainText(ApiError.ModuleNotLicensed);
    await expect(main).not.toContainText("تعذّر تحميل");
  });

  test("PLT-SAAS-05 the operator records a payment and the period extends by exactly one billing month", async ({ page, request }) => {
    const subscriptionBefore = await subscriptionOf(request, tenant.id);
    expect(subscriptionBefore.status).toBe(SubscriptionStatus.Trialing);
    expect(await platformGet<PlatformPayment[]>(request, `/tenants/${tenant.id}/payments`)).toEqual([]);

    await platformSignIn(page);
    await openTenantDetail(page, TENANT_CODE);
    expect((await periodEnd(page)).toISOString().slice(0, 10)).toBe(FIRST_PERIOD_END);

    await page.getByRole("button", { name: "تسجيل دفعة" }).click();
    const dialog = page.getByRole("dialog", { name: "تسجيل دفعة" });
    await dialog.getByLabel("المبلغ").fill(PAYMENT_AMOUNT);
    await dialog.getByLabel("المرجع").fill(PAYMENT_REFERENCE);
    const recorded = page.waitForResponse((r) => /\/api\/platform\/tenants\/[^/]+\/payments$/.test(new URL(r.url()).pathname) && r.request().method() === HttpMethod.Post);
    await dialog.getByRole("button", { name: "تسجيل الدفعة" }).click();
    expect((await recorded).status()).toBe(201);
    await expect(dialog).toBeHidden();

    const main = page.locator("main");
    await expect(main.getByText(PAYMENT_REFERENCE)).toBeVisible();
    await expect(main).toContainText(/حالة الاشتراك\s*نشط/);

    const subscriptionAfter = await subscriptionOf(request, tenant.id);
    expect(subscriptionAfter.status).toBe(SubscriptionStatus.Active);
    expect(subscriptionBefore.currentPeriodEnd.slice(0, 10)).toBe(FIRST_PERIOD_END);
    expect(subscriptionAfter.currentPeriodEnd).toBe(subscriptionBefore.currentPeriodEnd.replace(FIRST_PERIOD_END, RENEWED_PERIOD_END));
    const payments = await platformGet<PlatformPayment[]>(request, `/tenants/${tenant.id}/payments`);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.reference).toBe(PAYMENT_REFERENCE);
    expect(Number(payments[0]?.amount)).toBe(Number(PAYMENT_AMOUNT));

    expect((await periodEnd(page)).toISOString().slice(0, 10)).toBe(RENEWED_PERIOD_END);

    await page.reload();
    await expect(main.getByText(PAYMENT_REFERENCE)).toBeVisible();
    await expect(main).toContainText(/حالة الاشتراك\s*نشط/);
    expect((await periodEnd(page)).toISOString().slice(0, 10)).toBe(RENEWED_PERIOD_END);
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

  test("PLT-SAAS-06 suspending asks first, then refuses writes in Arabic, keeps reads, and resume restores [guards D-SAAS-10]", async ({ page, request, browser }) => {
    await platformSignIn(page);
    await openTenantDetail(page, TENANT_CODE);
    const main = page.locator("main");

    await page.getByRole("button", { name: "إيقاف المنشأة" }).click();
    const question = page.getByRole("dialog", { name: SUSPEND_QUESTION });
    await expect(question).toBeVisible();
    await expect(main.getByText("نشطة", { exact: true })).toBeVisible();
    await question.getByRole("button", { name: "رجوع" }).click();
    await expect(question).toBeHidden();
    const stillWritable = await tenantApiLogin(request, tenant);
    expect((await tenantCall(request, stillWritable, HttpMethod.Get, "/license/state")).body).toMatchObject({ canWrite: true });

    await page.getByRole("button", { name: "إيقاف المنشأة" }).click();
    await page.getByRole("dialog", { name: SUSPEND_QUESTION }).getByRole("button", { name: "إيقاف المنشأة" }).click();
    await expect(main.getByText("موقوفة", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "استئناف المنشأة" })).toBeVisible();

    const api = await tenantApiLogin(request, tenant);
    for (const refusedWrite of ["/customers", "/sales-invoices"]) {
      const write = await tenantCall(request, api, HttpMethod.Post, refusedWrite, { nameAr: "مرفوض" });
      expect(write.status, refusedWrite).toBe(403);
      expect(errorOf(write).error, refusedWrite).toBe(ApiError.LicenseReadOnly);
      expect(errorOf(write).message, refusedWrite).toBe(LICENSE_READ_ONLY_SENTENCE);
    }
    const read = await tenantCall(request, api, HttpMethod.Get, "/customers");
    expect(read.status).toBe(200);
    expect(rowsOf(read.body)).toEqual([]);
    expect((await tenantCall(request, api, HttpMethod.Get, "/sales-invoices")).status).toBe(200);

    const tenantContext = await browser.newContext();
    const tenantPage = await tenantContext.newPage();
    await tenantSignIn(tenantPage, tenant);
    await expect(tenantPage.getByRole("alert").filter({ hasText: READ_ONLY_BANNER })).toBeVisible();
    expect(await addCustomer(tenantPage, "عميل أثناء الإيقاف")).toBe(403);
    const dialog = tenantPage.getByRole("dialog", { name: "إضافة عميل" });
    await expect(dialog.getByText(LICENSE_READ_ONLY_SENTENCE)).toBeVisible();
    await expect(dialog).not.toContainText(ApiError.LicenseReadOnly);
    await tenantPage.reload();
    await expect(tenantPage.getByRole("heading", { name: "العملاء", level: 1 })).toBeVisible();
    await expect(tenantPage.getByText(/عرض 0 من 0 عميل/)).toBeVisible();
    await expect(tenantPage.getByText("عميل أثناء الإيقاف")).toHaveCount(0);

    await page.getByRole("button", { name: "استئناف المنشأة" }).click();
    await expect(main.getByText("نشطة", { exact: true })).toBeVisible();
    await page.reload();
    await expect(main.getByText("نشطة", { exact: true })).toBeVisible();

    expect(await addCustomer(tenantPage, CUSTOMER_NAME)).toBe(201);
    await tenantPage.reload();
    await expect(tenantPage.getByRole("cell", { name: CUSTOMER_NAME }).first()).toBeVisible();
    await expect(tenantPage.getByRole("alert").filter({ hasText: READ_ONLY_BANNER })).toHaveCount(0);
    const after = await tenantCall(request, api, HttpMethod.Get, "/customers");
    expect(rowsOf(after.body).map((row) => row["nameAr"])).toEqual([CUSTOMER_NAME]);
    await tenantContext.close();
  });

  test("the platform owner resets a tenant owner's PIN: asked first, shown once, the old PIN stops and the new one signs in", async ({ page, request }) => {
    await platformSignIn(page);
    await openTenantDetail(page, paying.code);

    await page.getByRole("button", { name: RESET_OWNER_PIN }).click();
    const question = page.getByRole("dialog", { name: RESET_OWNER_PIN_QUESTION });
    await expect(question).toContainText(paying.adminEmail);
    await question.getByRole("button", { name: "رجوع" }).click();
    await expect(question).toBeHidden();
    await tenantApiLogin(request, paying);

    await page.getByRole("button", { name: RESET_OWNER_PIN }).click();
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/platform/tenants/${paying.id}/owner-pin/reset`);
    await page.getByRole("dialog", { name: RESET_OWNER_PIN_QUESTION }).getByRole("button", { name: "إعادة التعيين" }).click();
    const response = await answered;
    expect(response.status()).toBe(200);
    const fresh = (await response.json()) as { adminEmail: string; adminPin: string };
    expect(fresh.adminEmail).toBe(paying.adminEmail);
    expect(fresh.adminPin).toMatch(/^[0-9]{6}$/);
    expect(fresh.adminPin).not.toBe(paying.adminPin);
    await expect(page.locator("main").getByText(fresh.adminPin, { exact: true })).toBeVisible();
    await expect(page.locator("main").getByText(/لن يظهر رقم التعريف الشخصي مرة أخرى/).first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: RESET_OWNER_PIN })).toBeVisible();
    await expect(page.getByText(fresh.adminPin, { exact: true })).toHaveCount(0);

    const oldPin = await request.post(`${SAAS_API_URL}/api/auth/login`, {
      headers: { [TENANT_HEADER]: paying.code },
      data: { username: paying.adminEmail, pin: paying.adminPin },
    });
    expect(oldPin.status()).toBe(401);
    paying = { ...paying, adminPin: fresh.adminPin };
    await tenantApiLogin(request, paying);
  });
});
