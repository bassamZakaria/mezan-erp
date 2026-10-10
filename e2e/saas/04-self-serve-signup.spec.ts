import { test, expect } from "@playwright/test";
import { ApiError, BillingCycle, PlanId, SAAS_API_URL, uniqueCode } from "./support/env";
import { errorOf, tenantApiLogin, tenantCall, tenantSignIn, type TenantLogin } from "./support/saas";

const CODE = uniqueCode("shop");
const COMPANY = "متجر الياسمين";
const OWNER_EMAIL = `sara@${CODE}.example`;

let verifyUrl = "";
let tenant: TenantLogin;

test.describe.configure({ mode: "serial" });

test.describe("Self-serve signup — form, verification link, first sign-in", () => {
  test("the signup request is posted to the route the server mounts", async ({ request }) => {
    const mounted = await request.post(`${SAAS_API_URL}/api/signup`, { data: {} });
    expect(mounted.status()).toBe(400);
    expect(((await mounted.json()) as { error: string }).error).toBe(ApiError.ValidationError);
  });

  test("a visitor signs up and is shown the verification link in dev mode", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "أنشئ حساب ميزان", level: 1 })).toBeVisible();
    await page.getByLabel("اسم المنشأة (عربي)").fill(COMPANY);
    await page.getByLabel("رمز المنشأة").fill(CODE);
    await page.getByLabel("رمز المنشأة").blur();
    await expect(page.getByText("الرمز متاح")).toBeVisible();
    await page.getByLabel("اسمك").fill("سارة الياسمين");
    await page.getByLabel("البريد الإلكتروني").fill(OWNER_EMAIL);
    await page.getByRole("button", { name: /الأساسية/ }).click();

    const posted = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/api/signup"));
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
      headers: { "x-mezan-tenant": CODE },
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
    await page.goto("/signup/verify?token=not-a-real-token");
    await expect(page.getByRole("alert")).toContainText(/[؀-ۿ]/);
    await expect(page.getByRole("alert")).not.toContainText(/[A-Z]{2,}_[A-Z_]{2,}/);
  });

  test("the new owner signs in for the first time, on a trial of the top plan", async ({ page, request }) => {
    await tenantSignIn(page, tenant);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("سارة");
    await expect(page.getByRole("status").filter({ hasText: "تجربتك المجانية" })).toContainText("14");

    await page.goto("/setup/settings-billing");
    await expect(page.getByRole("heading", { name: "المؤسسات", level: 2 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*تجريبي/);

    const api = await tenantApiLogin(request, tenant);
    const entitlements = await tenantCall(request, api, "GET", "/entitlements");
    expect((entitlements.body as { plan: string }).plan).toBe("enterprise");
    const hr = await tenantCall(request, api, "GET", "/hr/departments");
    expect(hr.status).toBe(200);

    await page.reload();
    await expect(page.getByRole("heading", { name: "المؤسسات", level: 2 })).toBeVisible();
  });

  test.fixme(
    "the new tenant carries the company name its owner typed [D-SAAS-02: every provisioned tenant is named «Cyag» — packages/backend/src/seed.ts:281 seeds companyName with the vendor's own name and apps/server/src/provision-tenant.ts never writes the name the tenant was created with, so the session, GET /tenant and printed documents carry «Cyag»]",
    async ({ request }) => {
      const login = await request.post(`${SAAS_API_URL}/api/auth/login`, {
        headers: { "x-mezan-tenant": CODE },
        data: { username: tenant.adminEmail, pin: tenant.adminPin },
      });
      expect(((await login.json()) as { tenantName: string }).tenantName).toBe(COMPANY);
    },
  );

  test("the request body cannot choose its own trial plan", async ({ request }) => {
    const code = uniqueCode("crafted");
    const start = await request.post(`${SAAS_API_URL}/api/signup`, {
      data: { code, nameAr: "منشأة مصنوعة", ownerEmail: `owner@${code}.example`, ownerNameAr: "مالك", planId: PlanId.Free, billingCycle: BillingCycle.Monthly },
    });
    expect(start.status()).toBe(201);
    const token = new URL(((await start.json()) as { devVerifyUrl: string }).devVerifyUrl).searchParams.get("token") ?? "";
    const verify = await request.post(`${SAAS_API_URL}/api/signup/verify`, { data: { token } });
    const body = (await verify.json()) as { tenant: { id: string }; adminEmail: string; adminPin: string };
    const api = await tenantApiLogin(request, { id: body.tenant.id, code, adminEmail: body.adminEmail, adminPin: body.adminPin });
    const entitlements = await tenantCall(request, api, "GET", "/entitlements");
    expect((entitlements.body as { plan: string; trialEndsAt: string | null }).plan).toBe("enterprise");
    expect((entitlements.body as { trialEndsAt: string | null }).trialEndsAt).not.toBeNull();
    expect(errorOf(entitlements).error).toBeUndefined();
  });
});
