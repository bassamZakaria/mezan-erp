import { test, expect } from "@playwright/test";
import { PlanId, ResolveMode, SAAS_API_URL, SAAS_WEB_PORT, StorageKey, TENANT_DOMAIN, uniqueCode } from "./support/env";
import { enterTenantCode, fillPin, provisionTenant, tenantSignIn, tenantSignOut, type TenantLogin } from "./support/saas";

const TENANT_NAME = "مؤسسة الواحة السرية";
const SECOND_NAME = "مؤسسة الدلتا";

let tenant: TenantLogin;
let second: TenantLogin;

test.describe.configure({ mode: "serial" });

test.describe("PLT-SAAS-08 — resolving a tenant reveals nothing before sign-in", () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    tenant = await provisionTenant(request, { code: uniqueCode("oasis"), nameAr: TENANT_NAME, ownerNameAr: "وليد الواحة", planId: PlanId.Core, trial: true });
    second = await provisionTenant(request, { code: uniqueCode("delta"), nameAr: SECOND_NAME, ownerNameAr: "دينا الدلتا", planId: PlanId.Core, trial: true });
    await request.dispose();
  });

  test("the resolve endpoint answers mode and existence only, by code and by subdomain", async ({ request }) => {
    const byCode = await request.get(`${SAAS_API_URL}/api/platform/resolve`, { headers: { "x-mezan-tenant": tenant.code } });
    expect(await byCode.json()).toEqual({ mode: ResolveMode.Code, exists: true });

    const bySubdomain = await request.get(`${SAAS_API_URL}/api/platform/resolve`, {
      headers: { "x-forwarded-host": `${tenant.code}.${TENANT_DOMAIN}` },
    });
    expect(await bySubdomain.json()).toEqual({ mode: ResolveMode.Subdomain, exists: true });

    const unknown = await request.get(`${SAAS_API_URL}/api/platform/resolve`, { headers: { "x-mezan-tenant": "no-such-company" } });
    expect(await unknown.json()).toEqual({ mode: ResolveMode.Code, exists: false });

    const nested = await request.get(`${SAAS_API_URL}/api/platform/resolve`, {
      headers: { "x-forwarded-host": `a.${tenant.code}.${TENANT_DOMAIN}` },
    });
    expect(await nested.json()).toEqual({ mode: ResolveMode.Code, exists: false });
  });

  test.fixme(
    "no unauthenticated route returns a tenant's name [D-SAAS-07: GET /api/tenant answers {name} to anyone who sends a guessed x-mezan-tenant header — packages/backend/src/auth-routes.ts:338, the ROADMAP §4.3 residual]",
    async ({ request }) => {
      const response = await request.get(`${SAAS_API_URL}/api/tenant`, { headers: { "x-mezan-tenant": tenant.code } });
      expect(response.status()).toBe(401);
    },
  );

  test("code mode echoes the typed code and never the company name", async ({ page }) => {
    await page.goto("/");
    await enterTenantCode(page, tenant.code);
    await expect(page.getByText(`الرمز: ${tenant.code}`)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(TENANT_NAME);

    await page.getByRole("button", { name: "تغيير المنشأة" }).click();
    const field = page.getByRole("textbox", { name: "رمز المنشأة" });
    await field.fill("no-such-company");
    await field.blur();
    await expect(page.getByRole("alert")).toHaveText("المنشأة غير موجودة");

    await field.fill("Bad Code!");
    await expect(page.getByRole("alert")).toHaveText("رمز المنشأة غير صالح");
  });

  test("subdomain mode shows no company-code field and no name, and signs straight into the tenant", async ({ page }) => {
    const origin = `http://${tenant.code}.${TENANT_DOMAIN}:${SAAS_WEB_PORT}`;
    const resolved = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/platform/resolve");
    await page.goto(`${origin}/`);
    expect(await (await resolved).json()).toEqual({ mode: ResolveMode.Subdomain, exists: true });
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(TENANT_NAME);

    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(tenant.adminEmail);
    await fillPin(page, tenant.adminPin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("وليد");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.TenantCode)).toBeNull();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("وليد");
  });

  test("a subdomain for one tenant refuses another tenant's credentials", async ({ page }) => {
    const origin = `http://${tenant.code}.${TENANT_DOMAIN}:${SAAS_WEB_PORT}`;
    await page.goto(`${origin}/`);
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(second.adminEmail);
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/login");
    await fillPin(page, second.adminPin);
    expect((await refused).status()).toBe(401);
    await expect(page.getByRole("alert")).toContainText(/[؀-ۿ]/);
  });

  test("a device that has signed into one company keeps its code for the next visit", async ({ page }) => {
    await tenantSignIn(page, tenant);
    await tenantSignOut(page);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveValue(tenant.code);
    await expect(page.getByRole("radio", { name: /وليد الواحة/ })).toBeVisible();
  });

  test("a device shared between two companies opens neutral, on neither company", async ({ page }) => {
    await tenantSignIn(page, tenant);
    await tenantSignOut(page);
    await page.getByRole("button", { name: "تغيير المنشأة" }).click();
    await enterTenantCode(page, second.code);
    const email = page.getByRole("textbox", { name: "البريد الإلكتروني" });
    if (!(await email.isVisible())) await page.getByRole("button", { name: "آخر", exact: true }).click();
    await email.fill(second.adminEmail);
    await fillPin(page, second.adminPin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("دينا");
    await tenantSignOut(page);

    await page.reload();
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveValue("");
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("دينا الدلتا");
    await expect(page.locator("body")).not.toContainText("وليد الواحة");

    const field = page.getByRole("textbox", { name: "البريد الإلكتروني" });
    await field.fill(tenant.adminEmail);
    await field.blur();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveValue(tenant.code);
    await fillPin(page, tenant.adminPin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("وليد");
  });
});
