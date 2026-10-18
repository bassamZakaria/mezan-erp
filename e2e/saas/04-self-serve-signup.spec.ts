import { test, expect } from "./support/test";
import { ApiError, BillingCycle, CodePrefix, HttpMethod, PlanCode, PlanId, SAAS_API_URL, SubscriptionStatus, TENANT_HEADER, FORWARDED_FOR_HEADER, browserSource, proxiedSource, uniqueCode } from "./support/env";
import { errorOf, fillPin, invoiceDrafts, provisionTenant, rowsOf, storedSession, tenantApiLogin, tenantCall, tenantSignIn, tenantSignOut, type TenantLogin } from "./support/saas";

const CODE = uniqueCode(CodePrefix.SignedUp);
const COMPANY = "متجر الياسمين";
const VENDOR_NAME = "Cyag";
const OWNER_EMAIL = `sara@${CODE}.example`;
const CUSTOMER_NAME = "عميل الياسمين";
const FORGED_LINK_REFUSAL = "رابط التفعيل غير صالح";

let verifyUrl = "";
let tenant: TenantLogin;

const SOURCES_PER_BLOCK = 250;
const THROTTLED_SOURCE = "10.44.0.1";
const SIGNUPS_PER_SOURCE_PER_HOUR = 8;
const TOO_MANY_ATTEMPTS = "محاولات كثيرة جدًا، حاول لاحقًا";
let sourcesHandedOut = 0;

function freshClient(): string {
  const n = sourcesHandedOut++;
  return `10.4.${Math.floor(n / SOURCES_PER_BLOCK)}.${1 + (n % SOURCES_PER_BLOCK)}`;
}

function freshSource(): Record<string, string> {
  return proxiedSource(freshClient());
}

test.describe.configure({ mode: "serial" });

test.describe("Self-serve signup — form, verification link, first sign-in", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(browserSource(freshClient()));
  });

  test("the signup request is posted to the route the server mounts", async ({ request }) => {
    for (const route of ["/api/signup", "/api/signup/"]) {
      const mounted = await request.post(`${SAAS_API_URL}${route}`, { headers: freshSource(), data: {} });
      expect(mounted.status(), route).toBe(400);
      expect(((await mounted.json()) as { error: string }).error, route).toBe(ApiError.ValidationError);
    }
    const code = uniqueCode(CodePrefix.Crafted);
    const withSlash = await request.post(`${SAAS_API_URL}/api/signup/`, {
      headers: freshSource(),
      data: { code, nameAr: "منشأة الشرطة", ownerEmail: `owner@${code}.example`, ownerNameAr: "مالك", planId: PlanId.Core, billingCycle: BillingCycle.Monthly },
    });
    expect(withSlash.status(), await withSlash.text()).toBe(201);
    expect(((await withSlash.json()) as { devVerifyUrl: string }).devVerifyUrl).toContain("/signup/verify?token=");
  });

  test("one address is refused its ninth signup attempt in an hour, in Arabic, whatever it writes ahead of the trusted proxies, while another address still gets through", async ({ request }) => {
    const attempt = (client: string, claimed: string) =>
      request.post(`${SAAS_API_URL}/api/signup`, { headers: proxiedSource(client, claimed), data: {} });
    for (let n = 1; n <= SIGNUPS_PER_SOURCE_PER_HOUR; n += 1) {
      expect((await attempt(THROTTLED_SOURCE, `203.0.113.${n}`)).status(), `attempt ${n}`).toBe(400);
    }

    const ninth = await attempt(THROTTLED_SOURCE, "203.0.113.200");

    expect(ninth.status()).toBe(429);
    expect(await ninth.json()).toEqual({ error: ApiError.TooManyRequests, message: TOO_MANY_ATTEMPTS });
    expect(Number(ninth.headers()["retry-after"])).toBeGreaterThan(0);
    expect(Number(ninth.headers()["retry-after"])).toBeLessThanOrEqual(3600);
    expect((await attempt(freshClient(), THROTTLED_SOURCE)).status()).toBe(400);
    const unproxied = await request.post(`${SAAS_API_URL}/api/signup`, { headers: { [FORWARDED_FOR_HEADER]: THROTTLED_SOURCE }, data: {} });
    expect(unproxied.status()).toBe(503);
    expect(await unproxied.json()).toMatchObject({ error: ApiError.SourceUnresolved });
  });

  test("a visitor signs up and is shown the verification link in dev mode", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "أنشئ حساب ميزان", level: 1 })).toBeVisible();
    await expect(page.getByLabel("اسم المنشأة (عربي)")).toHaveAttribute("maxlength", "200");
    await page.getByLabel("اسم المنشأة (عربي)").fill(COMPANY);
    await page.getByLabel("رمز المنشأة").fill(CODE);
    await page.getByLabel("رمز المنشأة").blur();
    await expect(page.getByText("الرمز متاح")).toBeVisible();
    await page.getByLabel("اسمك").fill("سارة الياسمين");
    await page.getByLabel("البريد الإلكتروني").fill(OWNER_EMAIL);
    await page.getByRole("button", { name: /الأساسية/ }).click();

    const posted = page.waitForResponse((r) => r.request().method() === HttpMethod.Post && new URL(r.url()).pathname.startsWith("/api/signup"));
    await page.getByRole("button", { name: "ابدأ التجربة المجانية" }).click();
    const response = await posted;
    expect(new URL(response.url()).pathname).toBe("/api/signup");
    expect(response.status()).toBe(201);

    await expect(page.getByRole("heading", { name: "تحقق من بريدك الإلكتروني", level: 1 })).toBeVisible();
    await expect(page.getByText(OWNER_EMAIL)).toBeVisible();
    const link = page.locator('a[href*="/signup/verify?token="]');
    await expect(link).toBeVisible();
    verifyUrl = (await link.getAttribute("href")) ?? "";
    expect(verifyUrl).toContain("/signup/verify?token=");
  });

  test("the code is not usable before the link is opened", async ({ request }) => {
    const login = await request.post(`${SAAS_API_URL}/api/auth/login`, {
      headers: { [TENANT_HEADER]: CODE },
      data: { username: OWNER_EMAIL, pin: "000000" },
    });
    expect(login.status()).toBe(404);
    expect(((await login.json()) as { error: string }).error).toBe(ApiError.TenantNotFound);
  });

  test("a taken code is refused on the form, in Arabic", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("رمز المنشأة").fill(CODE);
    await page.getByLabel("رمز المنشأة").blur();
    await expect(page.getByText("هذا الرمز مستخدم بالفعل")).toBeVisible();
  });

  test("opening the link activates the account and shows the PIN once", async ({ page }) => {
    const verified = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/signup/verify");
    await page.goto(new URL(verifyUrl).pathname + new URL(verifyUrl).search);
    const body = (await (await verified).json()) as { tenant: { id: string }; adminEmail: string; adminPin: string };
    expect(body.adminPin).toMatch(/^\d{6}$/);
    tenant = { id: body.tenant.id, code: CODE, adminEmail: body.adminEmail, adminPin: body.adminPin };

    await expect(page.getByRole("heading", { name: "تم تفعيل الحساب", level: 1 })).toBeVisible();
    await expect(page.getByText(CODE, { exact: true })).toBeVisible();
    await expect(page.getByText(body.adminPin, { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("لن يظهر مرة أخرى");

    await page.reload();
    await expect(page.getByRole("heading", { name: "تم تفعيل هذا الحساب مسبقًا", level: 1 })).toBeVisible();
    await expect(page.getByText(body.adminPin, { exact: true })).toHaveCount(0);
  });

  test("a forged verification link is refused in Arabic", async ({ page }) => {
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/signup/verify");
    await page.goto("/signup/verify?token=not-a-real-token");
    expect((await refused).status()).toBe(400);
    await expect(page.getByRole("alert")).toHaveText(FORGED_LINK_REFUSAL);
    await expect(page.getByRole("heading", { name: "تم تفعيل الحساب", level: 1 })).toHaveCount(0);
  });

  test("the new owner signs in for the first time, on a trial of the top plan", async ({ page, request }) => {
    await tenantSignIn(page, tenant);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("سارة");
    await expect(page.getByRole("status").filter({ hasText: "تجربتك المجانية" })).toContainText("14");

    await page.goto("/setup/settings-billing");
    await expect(page.getByRole("heading", { name: "المؤسسات", level: 2 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*تجريبي/);

    const api = await tenantApiLogin(request, tenant);
    const entitlements = await tenantCall(request, api, HttpMethod.Get, "/entitlements");
    expect((entitlements.body as { plan: string }).plan).toBe(PlanCode.Enterprise);
    const hr = await tenantCall(request, api, HttpMethod.Get, "/hr/departments");
    expect(hr.status).toBe(200);

    await page.reload();
    await expect(page.getByRole("heading", { name: "المؤسسات", level: 2 })).toBeVisible();
  });

  test("the new tenant carries the company name its owner typed, in the session, in settings and on a printed invoice [guards D-SAAS-02]", async ({ page, request }) => {
    const login = await request.post(`${SAAS_API_URL}/api/auth/login`, {
      headers: { [TENANT_HEADER]: CODE },
      data: { username: tenant.adminEmail, pin: tenant.adminPin },
    });
    expect(((await login.json()) as { tenantName: string }).tenantName).toBe(COMPANY);

    await tenantSignIn(page, tenant);
    expect((await storedSession(page))?.tenantName).toBe(COMPANY);
    await page.goto("/setup/settings-general");
    await expect(page.getByLabel("اسم المنشأة").first()).toHaveValue(COMPANY);

    const api = await tenantApiLogin(request, tenant);
    const today = ((await tenantCall(request, api, HttpMethod.Get, "/billing/subscription")).body as { today: string }).today;
    expect((await tenantCall(request, api, HttpMethod.Post, "/customers", { id: "CUST-NAME", code: "CN1", nameAr: CUSTOMER_NAME })).status).toBe(201);
    const drafts = await invoiceDrafts(request, api, { customerId: "CUST-NAME", customerName: CUSTOMER_NAME, itemId: "ITEM-NAME", itemName: "خدمة تسمية", today });
    const invoice = await tenantCall(request, api, HttpMethod.Post, "/sales-invoices", drafts.draft(1));
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const invoiceId = String((invoice.body as { id: string }).id);

    await page.goto(`/sell/sales-invoices/${invoiceId}/print`);
    const sheet = page.locator("main");
    await expect(sheet.getByText(CUSTOMER_NAME).first()).toBeVisible();
    await expect(sheet.getByText(COMPANY, { exact: true }).first()).toBeVisible();
    await expect(sheet).not.toContainText(VENDOR_NAME);
    expect(rowsOf((await tenantCall(request, api, HttpMethod.Get, "/sales-invoices")).body)).toHaveLength(1);
  });

  test("«الذهاب لتسجيل الدخول» opens sign-in on the company just activated, with its owner's address and no other company's face — not on the company this browser used before", async ({ page, request }) => {
    for (const prefix of [CodePrefix.SignedInBefore, CodePrefix.SignedInBeforeToo]) {
      const earlier = await provisionTenant(request, { code: uniqueCode(prefix), nameAr: "منشأة سابقة", ownerNameAr: "مدير سابق", planId: PlanId.Core, trial: true });
      await tenantSignIn(page, earlier);
      await tenantSignOut(page);
    }
    await expect(page.getByRole("radio"), "the device now remembers an earlier company's face").not.toHaveCount(0);

    const code = uniqueCode(CodePrefix.HandedOver);
    const ownerEmail = `owner@${code}.example`;
    const start = await request.post(`${SAAS_API_URL}/api/signup`, {
      headers: freshSource(),
      data: { code, nameAr: "منشأة التسليم", ownerEmail, ownerNameAr: "هالة التسليم", planId: PlanId.Core, billingCycle: BillingCycle.Monthly },
    });
    expect(start.status(), await start.text()).toBe(201);
    const verifyLink = new URL(((await start.json()) as { devVerifyUrl: string }).devVerifyUrl);

    const verified = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/signup/verify");
    await page.goto(verifyLink.pathname + verifyLink.search);
    const { adminPin } = (await (await verified).json()) as { adminPin: string };
    await page.getByRole("button", { name: "الذهاب لتسجيل الدخول" }).click();

    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveValue(code);
    await expect(page.getByRole("textbox", { name: "البريد الإلكتروني" })).toHaveValue(ownerEmail);
    await expect(page.getByRole("radio"), "no earlier company's face is offered").toHaveCount(0);

    await fillPin(page, adminPin);
    await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("هالة");
  });

  test("the request body cannot choose its own trial plan", async ({ request }) => {
    const code = uniqueCode(CodePrefix.Crafted);
    const start = await request.post(`${SAAS_API_URL}/api/signup`, {
      headers: freshSource(),
      data: { code, nameAr: "منشأة مصنوعة", ownerEmail: `owner@${code}.example`, ownerNameAr: "مالك", planId: PlanId.Free, billingCycle: BillingCycle.Monthly },
    });
    expect(start.status()).toBe(201);
    const token = new URL(((await start.json()) as { devVerifyUrl: string }).devVerifyUrl).searchParams.get("token") ?? "";
    const verify = await request.post(`${SAAS_API_URL}/api/signup/verify`, { headers: freshSource(), data: { token } });
    const body = (await verify.json()) as { tenant: { id: string }; adminEmail: string; adminPin: string };
    const api = await tenantApiLogin(request, { id: body.tenant.id, code, adminEmail: body.adminEmail, adminPin: body.adminPin });
    const entitlements = await tenantCall(request, api, HttpMethod.Get, "/entitlements");
    expect((entitlements.body as { plan: string; trialEndsAt: string | null }).plan).toBe(PlanCode.Enterprise);
    expect((entitlements.body as { trialEndsAt: string | null }).trialEndsAt).not.toBeNull();
    expect(errorOf(entitlements).error).toBeUndefined();
    const billing = await tenantCall(request, api, HttpMethod.Get, "/billing/subscription");
    expect((billing.body as { subscription: { status: string } }).subscription.status).toBe(SubscriptionStatus.Trialing);
  });
});
