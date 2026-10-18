import { rmSync } from "node:fs";
import { type APIRequestContext } from "@playwright/test";
import { test, expect, directApi } from "./support/test";
import {
  ApiError,
  BillingCycle,
  CLOCK_API_PORT,
  CLOCK_API_URL,
  CLOCK_WEB_PORT,
  CLOCK_WEB_URL,
  CodePrefix,
  DEFAULT_BROWSER_CLIENT,
  HttpMethod,
  LICENSE_READ_ONLY_SENTENCE,
  LicenseState,
  Module,
  PlanCode,
  PlanId,
  PlanKind,
  SubscriptionStatus,
  proxiedSource,
  uniqueCode,
} from "./support/env";
import {
  addCustomer,
  errorOf,
  invoiceDrafts,
  pickEntity,
  bearer,
  platformToken,
  provisionTenant,
  rowsOf,
  tenantApiLogin,
  tenantCall,
  tenantSignIn,
  type ApiAnswer,
  type TenantApi,
  type TenantLogin,
} from "./support/saas";
import { RunDir, newRunDir, startApiServer, startWebServer, type ServerHandle } from "./support/servers";

const CODE = uniqueCode(CodePrefix.Trial);
const CUSTOMER_NAME = "عميل فترة التجربة";
const DEPARTMENT_NAME = "قسم فترة التجربة";
const QUOTA_ITEM_NAME = "خدمة استشارية";
const PAID_CUSTOMER_NAME = "عميل الفترة المدفوعة";
const FREE_INVOICE_QUOTA = 100;
const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;
const POLL_MS = 250;
const SWEEP_TIMEOUT_MS = 30_000;
const HR_READ_ONLY_SENTENCE = "وحدة الموارد البشرية ليست ضمن باقة «المجانية»، فهي للقراءة فقط: بياناتها متاحة للعرض والتصدير، ولا يمكن تسجيل جديد فيها.";
const QUOTA_SENTENCE = `باقة «المجانية» تسمح بـ ${FREE_INVOICE_QUOTA} فاتورة مبيعات في الشهر، وقد وصلتم إلى ${FREE_INVOICE_QUOTA} هذا الشهر. ما سُجّل من قبل يبقى كما هو ويمكن إكماله.`;
const GRACE_BANNER = "انتهى الترخيص — أنت في فترة سماح";
const READ_ONLY_BANNER = "الترخيص غير فعّال — وضع القراءة فقط";

interface PlatformSubscription {
  readonly status: string;
  readonly currentPeriodEnd: string;
}

interface LicenceAnswer {
  readonly state: string;
  readonly canWrite: boolean;
}

let api: ServerHandle | null = null;
let web: ServerHandle | null = null;
let platformDir = "";
let tenant: TenantLogin;
let paidTenant: TenantLogin;
let trialEndsAt = "";
let paidPeriodEnd = "";

function call(request: APIRequestContext, session: TenantApi, method: HttpMethod, route: string, data?: unknown): Promise<ApiAnswer> {
  return tenantCall(request, session, method, route, data, CLOCK_API_URL);
}

function dayAfter(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

async function restartApiOn(day: string): Promise<void> {
  await api?.stop();
  api = null;
  api = await startApiServer({ port: CLOCK_API_PORT, platformDir, seedDemo: false, fakeToday: day });
}

async function paidSubscription(request: APIRequestContext): Promise<PlatformSubscription> {
  const token = await platformToken(request, CLOCK_API_URL);
  const response = await request.get(`${CLOCK_API_URL}/api/platform/tenants/${paidTenant.id}`, { headers: { ...bearer(token) } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { subscription: PlatformSubscription }).subscription;
}

async function licenceOf(request: APIRequestContext, session: TenantApi): Promise<LicenceAnswer> {
  const answer = await call(request, session, HttpMethod.Get, "/license/state");
  expect(answer.status).toBe(200);
  return answer.body as LicenceAnswer;
}

test.describe.configure({ mode: "serial" });

test.describe("The clock moves — a trial lands on Free, the Free quota holds, and an unpaid period goes past due, then read-only", () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300_000);
    platformDir = newRunDir(RunDir.Clock);
    const request = await directApi(playwright);

    api = await startApiServer({ port: CLOCK_API_PORT, platformDir, seedDemo: false });
    const start = await request.post(`${CLOCK_API_URL}/api/signup`, {
      headers: proxiedSource(DEFAULT_BROWSER_CLIENT),
      data: { code: CODE, nameAr: "شركة التجربة", ownerEmail: `owner@${CODE}.example`, ownerNameAr: "تامر التجربة", planId: PlanId.Core, billingCycle: BillingCycle.Monthly },
    });
    expect(start.status(), await start.text()).toBe(201);
    const token = new URL(((await start.json()) as { devVerifyUrl: string }).devVerifyUrl).searchParams.get("token") ?? "";
    const verify = await request.post(`${CLOCK_API_URL}/api/signup/verify`, { headers: proxiedSource(DEFAULT_BROWSER_CLIENT), data: { token } });
    expect(verify.status(), await verify.text()).toBe(200);
    const body = (await verify.json()) as { tenant: { id: string }; adminEmail: string; adminPin: string };
    tenant = { id: body.tenant.id, code: CODE, adminEmail: body.adminEmail, adminPin: body.adminPin };

    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const onTrial = await call(request, session, HttpMethod.Get, "/entitlements");
    expect((onTrial.body as { plan: string }).plan).toBe(PlanCode.Enterprise);
    trialEndsAt = (onTrial.body as { trialEndsAt: string }).trialEndsAt;
    expect((await call(request, session, HttpMethod.Post, "/customers", { id: "CUST-TRIAL", code: "CT1", nameAr: CUSTOMER_NAME })).status).toBe(201);
    const department = await call(request, session, HttpMethod.Post, "/hr/departments", { id: "DEPT-TRIAL", code: "TRL", name: "Trial department", nameAr: DEPARTMENT_NAME });
    expect(department.status, JSON.stringify(department.body)).toBe(201);

    paidTenant = await provisionTenant(
      request,
      { code: uniqueCode(CodePrefix.Lapsing), nameAr: "شركة الفترة المدفوعة", ownerNameAr: "مدحت المدفوع", planId: PlanId.Core, trial: false },
      CLOCK_API_URL,
    );
    const paid = await paidSubscription(request);
    expect(paid.status).toBe(SubscriptionStatus.Active);
    paidPeriodEnd = paid.currentPeriodEnd;
    expect(Date.parse(paidPeriodEnd)).toBeGreaterThan(Date.parse(trialEndsAt) + DAY_MS);

    await restartApiOn(dayAfter(trialEndsAt, 1));
    web = await startWebServer({ port: CLOCK_WEB_PORT, apiUrl: CLOCK_API_URL });
    await request.dispose();
  });

  test.afterAll(async () => {
    try {
      await web?.stop();
    } finally {
      try {
        await api?.stop();
      } finally {
        if (platformDir) rmSync(platformDir, { recursive: true, force: true });
      }
    }
  });

  test("the day after the trial the tenant is on Free, signed in, with its data intact", async ({ page, request }) => {
    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const entitlements = await call(request, session, HttpMethod.Get, "/entitlements");
    expect((entitlements.body as { plan: string; planKind: string }).plan).toBe(PlanCode.Free);
    expect((entitlements.body as { planKind: string }).planKind).toBe(PlanKind.Free);
    expect((entitlements.body as { readOnlyModules: string[] }).readOnlyModules).toContain(Module.Hr);
    expect(await licenceOf(request, session)).toMatchObject({ state: LicenseState.Active, canWrite: true });

    await tenantSignIn(page, tenant, CLOCK_WEB_URL);
    await expect(page.getByRole("status").filter({ hasText: "تجربتك المجانية" })).toHaveCount(0);
    await page.goto(`${CLOCK_WEB_URL}/setup/settings-billing`);
    await expect(page.getByRole("heading", { name: "المجانية", level: 2 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/فواتير المبيعات[^\d]*0\s*من\s*100/);

    await page.goto(`${CLOCK_WEB_URL}/sell/customers`);
    await expect(page.getByRole("cell", { name: CUSTOMER_NAME }).first()).toBeVisible();
    await expect(page.getByText(/عرض 1 من 1 عميل/)).toBeVisible();
  });

  test("a module that left the plan still reads and refuses writes in Arabic", async ({ page, request }) => {
    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const read = await call(request, session, HttpMethod.Get, "/hr/departments");
    expect(read.status).toBe(200);
    expect(rowsOf(read.body).map((row) => row["nameAr"])).toEqual([DEPARTMENT_NAME]);
    const write = await call(request, session, HttpMethod.Post, "/hr/departments", { id: "DEPT-AFTER", code: "AFT", name: "After", nameAr: "قسم بعد التجربة" });
    expect(write.status).toBe(403);
    expect(errorOf(write).error).toBe(ApiError.ModuleReadOnly);
    expect(errorOf(write).message).toBe(HR_READ_ONLY_SENTENCE);

    await tenantSignIn(page, tenant, CLOCK_WEB_URL);
    await page.goto(`${CLOCK_WEB_URL}/people/departments`);
    await expect(page.getByRole("heading", { name: "الأقسام", level: 1 })).toBeVisible();
    await expect(page.getByRole("cell", { name: DEPARTMENT_NAME }).first()).toBeVisible();

    await page.getByRole("button", { name: "إضافة قسم" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/الكود|كود القسم/).first().fill("UI1");
    await dialog.getByLabel(/اسم القسم|الاسم/).first().fill("قسم من الواجهة");
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/hr/departments" && r.request().method() === HttpMethod.Post);
    await dialog.getByRole("button", { name: /حفظ|إضافة/ }).last().click();
    expect((await refused).status()).toBe(403);
    await expect(page.getByText(HR_READ_ONLY_SENTENCE).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(ApiError.ModuleReadOnly);

    await page.reload();
    await expect(page.getByRole("cell", { name: DEPARTMENT_NAME }).first()).toBeVisible();
    await expect(page.getByText("قسم من الواجهة")).toHaveCount(0);
    expect(rowsOf((await call(request, session, HttpMethod.Get, "/hr/departments")).body).map((row) => row["nameAr"])).toEqual([DEPARTMENT_NAME]);
  });

  test("the Free plan accepts 100 sales invoices in the month and the invoice screen refuses the 101st in Arabic", async ({ page, request }) => {
    test.setTimeout(240_000);
    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const today = ((await call(request, session, HttpMethod.Get, "/billing/subscription")).body as { today: string }).today;
    const drafts = await invoiceDrafts(
      request,
      session,
      { customerId: "CUST-TRIAL", customerName: CUSTOMER_NAME, itemId: "ITEM-QUOTA", itemName: QUOTA_ITEM_NAME, today },
      CLOCK_API_URL,
    );
    for (let n = 1; n <= FREE_INVOICE_QUOTA; n += 1) {
      const created = await call(request, session, HttpMethod.Post, "/sales-invoices", drafts.draft(n));
      expect(created.status, `invoice ${n}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(201);
    }

    await tenantSignIn(page, tenant, CLOCK_WEB_URL);
    await page.goto(`${CLOCK_WEB_URL}/setup/settings-billing`);
    await expect(page.locator("main")).toContainText(/فواتير المبيعات[^\d]*100\s*من\s*100/);

    await page.goto(`${CLOCK_WEB_URL}/sell/sales-invoices`);
    await page.getByRole("button", { name: "فاتورة جديدة" }).first().click();
    await expect(page.getByRole("heading", { name: "فاتورة مبيعات جديدة", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "متابعة", exact: true }).click();
    await pickEntity(page, "العميل *", CUSTOMER_NAME);
    await pickEntity(page, "الصنف — سطر 1", QUOTA_ITEM_NAME);
    const save = page.getByRole("button", { name: "حفظ كمسودة" });
    await expect(save).toBeEnabled();
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sales-invoices" && r.request().method() === HttpMethod.Post);
    await save.click();
    const response = await refused;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ error: ApiError.PlanLimitReached, allowed: FREE_INVOICE_QUOTA, used: FREE_INVOICE_QUOTA, message: QUOTA_SENTENCE });
    await expect(page.getByText(QUOTA_SENTENCE).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(ApiError.PlanLimitReached);

    const firstPage = await call(request, session, HttpMethod.Get, `/sales-invoices?pageSize=${FREE_INVOICE_QUOTA}&page=1`);
    expect(firstPage.status).toBe(200);
    expect(rowsOf(firstPage.body)).toHaveLength(FREE_INVOICE_QUOTA);
    const secondPage = await call(request, session, HttpMethod.Get, `/sales-invoices?pageSize=${FREE_INVOICE_QUOTA}&page=2`);
    expect(secondPage.status).toBe(200);
    expect(rowsOf(secondPage.body)).toEqual([]);
    await page.goto(`${CLOCK_WEB_URL}/setup/settings-billing`);
    await expect(page.locator("main")).toContainText(/فواتير المبيعات[^\d]*100\s*من\s*100/);
  });

  test("a paid period that ends unpaid is marked past due, and the tenant keeps writing through its grace", async ({ page, request }) => {
    test.setTimeout(240_000);
    await restartApiOn(dayAfter(paidPeriodEnd, 1));

    await expect.poll(async () => (await paidSubscription(request)).status, { timeout: SWEEP_TIMEOUT_MS, intervals: [POLL_MS] }).toBe(SubscriptionStatus.PastDue);
    expect((await paidSubscription(request)).currentPeriodEnd).toBe(paidPeriodEnd);

    const session = await tenantApiLogin(request, paidTenant, CLOCK_API_URL);
    expect(await licenceOf(request, session)).toMatchObject({ state: LicenseState.Grace, canWrite: true });
    expect((await call(request, session, HttpMethod.Post, "/customers", { id: "CUST-GRACE", code: "CG1", nameAr: PAID_CUSTOMER_NAME })).status).toBe(201);

    await tenantSignIn(page, paidTenant, CLOCK_WEB_URL);
    await expect(page.getByRole("alert").filter({ hasText: GRACE_BANNER })).toBeVisible();
    await page.goto(`${CLOCK_WEB_URL}/sell/customers`);
    await expect(page.getByRole("cell", { name: PAID_CUSTOMER_NAME }).first()).toBeVisible();

    const freeTenant = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    expect(await licenceOf(request, freeTenant), "a Free plan is never dunned").toMatchObject({ state: LicenseState.Active, canWrite: true });
  });

  test("once the grace runs out the unpaid tenant is read-only in Arabic, and a recorded payment restores it", async ({ page, request }) => {
    test.setTimeout(240_000);
    await restartApiOn(dayAfter(paidPeriodEnd, GRACE_DAYS + 1));

    const session = await tenantApiLogin(request, paidTenant, CLOCK_API_URL);
    expect(await licenceOf(request, session)).toMatchObject({ state: LicenseState.ReadOnly, canWrite: false });
    const write = await call(request, session, HttpMethod.Post, "/customers", { id: "CUST-LAPSED", code: "CL1", nameAr: "عميل بعد السماح" });
    expect(write.status).toBe(403);
    expect(errorOf(write).error).toBe(ApiError.LicenseReadOnly);
    expect(errorOf(write).message).toBe(LICENSE_READ_ONLY_SENTENCE);
    const read = await call(request, session, HttpMethod.Get, "/customers");
    expect(rowsOf(read.body).map((row) => row["nameAr"])).toEqual([PAID_CUSTOMER_NAME]);

    await tenantSignIn(page, paidTenant, CLOCK_WEB_URL);
    await expect(page.getByRole("alert").filter({ hasText: READ_ONLY_BANNER })).toBeVisible();
    expect(await addCustomer(page, "عميل من الواجهة بعد السماح", CLOCK_WEB_URL)).toBe(403);
    await expect(page.getByRole("dialog", { name: "إضافة عميل" }).getByText(LICENSE_READ_ONLY_SENTENCE)).toBeVisible();

    const operator = await platformToken(request, CLOCK_API_URL);
    const payment = await request.post(`${CLOCK_API_URL}/api/platform/tenants/${paidTenant.id}/payments`, {
      headers: { ...bearer(operator) },
      data: { amount: "490", reference: `LAPSE-${paidTenant.code}`, paidAt: new Date().toISOString(), idempotencyKey: `LAPSE-KEY-${paidTenant.code}` },
    });
    expect(payment.status(), await payment.text()).toBe(201);
    expect((await paidSubscription(request)).status).toBe(SubscriptionStatus.Active);
    expect(await licenceOf(request, session)).toMatchObject({ state: LicenseState.Active, canWrite: true });
    expect((await call(request, session, HttpMethod.Post, "/customers", { id: "CUST-PAID", code: "CP1", nameAr: "عميل بعد السداد" })).status).toBe(201);
  });
});
