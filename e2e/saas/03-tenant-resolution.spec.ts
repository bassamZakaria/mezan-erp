import { test, expect, type Page } from "@playwright/test";
import {
  CodePrefix,
  FORWARDED_HOST_HEADER,
  HttpMethod,
  INVALID_CREDENTIALS_SENTENCE,
  PlanId,
  ResolveMode,
  SAAS_API_URL,
  SAAS_WEB_PORT,
  StorageKey,
  TENANT_DOMAIN,
  TENANT_HEADER,
  UNDISCLOSED_TENANT_NAME,
  uniqueCode,
} from "./support/env";
import {
  enterCredentials,
  enterTenantCode,
  fillPin,
  provisionTenant,
  storedSession,
  tenantSignIn,
  tenantSignOut,
  type TenantLogin,
} from "./support/saas";

const TENANT_NAME = "مؤسسة الواحة السرية";
const SECOND_NAME = "مؤسسة الدلتا";
const NAME_AT_SIGNUP = "شركة الاسم الأول";
const NAME_AFTER_RENAME = "الاسم التجاري بعد التعديل";
const WIZARD_LINK = "الإعداد الأولي";
const SIGNUP_LINK = "أنشئ حسابًا جديدًا";
const COMPANY_LOOKUP_PATH = "/api/platform/resolve";

let tenant: TenantLogin;
let second: TenantLogin;
let renamed: TenantLogin;

function collectApiBodies(page: Page): () => Promise<string[]> {
  const bodies: Promise<string>[] = [];
  page.on("response", (response) => {
    if (!new URL(response.url()).pathname.startsWith("/api/")) return;
    bodies.push(response.text().catch(() => ""));
  });
  return () => Promise.all(bodies);
}

test.describe("PLT-SAAS-08 — resolving a tenant reveals nothing before sign-in", () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    tenant = await provisionTenant(request, { code: uniqueCode(CodePrefix.Resolved), nameAr: TENANT_NAME, ownerNameAr: "وليد الواحة", planId: PlanId.Core, trial: true });
    second = await provisionTenant(request, { code: uniqueCode(CodePrefix.ResolvedSecond), nameAr: SECOND_NAME, ownerNameAr: "دينا الدلتا", planId: PlanId.Core, trial: true });
    renamed = await provisionTenant(request, { code: uniqueCode(CodePrefix.Renamed), nameAr: NAME_AT_SIGNUP, ownerNameAr: "رنا التعديل", planId: PlanId.Core, trial: true });
    await request.dispose();
  });

  test("the resolve endpoint answers mode and existence only, by code and by subdomain", async ({ request }) => {
    const byCode = await request.get(`${SAAS_API_URL}/api/platform/resolve`, { headers: { [TENANT_HEADER]: tenant.code } });
    expect(await byCode.json()).toEqual({ mode: ResolveMode.Code, exists: true });

    const bySubdomain = await request.get(`${SAAS_API_URL}/api/platform/resolve`, {
      headers: { [FORWARDED_HOST_HEADER]: `${tenant.code}.${TENANT_DOMAIN}` },
    });
    expect(await bySubdomain.json()).toEqual({ mode: ResolveMode.Subdomain, exists: true });

    const unknown = await request.get(`${SAAS_API_URL}/api/platform/resolve`, { headers: { [TENANT_HEADER]: "no-such-company" } });
    expect(await unknown.json()).toEqual({ mode: ResolveMode.Code, exists: false });

    const nested = await request.get(`${SAAS_API_URL}/api/platform/resolve`, {
      headers: { [FORWARDED_HOST_HEADER]: `a.${tenant.code}.${TENANT_DOMAIN}` },
    });
    expect(await nested.json()).toEqual({ mode: ResolveMode.Code, exists: false });
  });

  test("an anonymous caller is told a placeholder for the company, before and after its owner renames it [guards D-SAAS-07]", async ({ page, request }) => {
    const anonymousName = async (headers: Record<string, string>): Promise<unknown> => {
      const response = await request.get(`${SAAS_API_URL}/api/tenant`, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const byCode = { [TENANT_HEADER]: renamed.code };
    const bySubdomain = { [FORWARDED_HOST_HEADER]: `${renamed.code}.${TENANT_DOMAIN}` };
    expect(await anonymousName(byCode)).toEqual({ name: UNDISCLOSED_TENANT_NAME });

    await tenantSignIn(page, renamed);
    expect((await storedSession(page))?.tenantName).toBe(NAME_AT_SIGNUP);
    await page.goto("/setup/settings-general");
    const companyName = page.getByLabel("اسم المنشأة").first();
    await expect(companyName).toHaveValue(NAME_AT_SIGNUP);
    await companyName.fill(NAME_AFTER_RENAME);
    const saved = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/settings" && r.request().method() !== HttpMethod.Get);
    await page.getByRole("button", { name: "حفظ الإعدادات" }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByLabel("اسم المنشأة").first()).toHaveValue(NAME_AFTER_RENAME);

    for (const headers of [byCode, bySubdomain]) {
      const answer = await anonymousName(headers);
      expect(answer).toEqual({ name: UNDISCLOSED_TENANT_NAME });
      expect(JSON.stringify(answer)).not.toContain(NAME_AFTER_RENAME);
      expect(JSON.stringify(answer)).not.toContain(NAME_AT_SIGNUP);
    }

    const signedIn = await request.post(`${SAAS_API_URL}/api/auth/login`, {
      headers: byCode,
      data: { username: renamed.adminEmail, pin: renamed.adminPin },
    });
    expect(((await signedIn.json()) as { tenantName: string }).tenantName).toBe(NAME_AFTER_RENAME);
  });

  test("code mode echoes the typed code and never the company name", async ({ page }) => {
    const apiBodies = collectApiBodies(page);
    const named = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tenant");
    await page.goto("/");
    await enterTenantCode(page, tenant.code);
    await expect(page.getByText(`الرمز: ${tenant.code}`)).toBeVisible();
    expect(await (await named).json()).toEqual({ name: UNDISCLOSED_TENANT_NAME });
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toContainText(TENANT_NAME);
    expect((await apiBodies()).filter((body) => body.includes(TENANT_NAME))).toEqual([]);

    await page.getByRole("button", { name: "تغيير المنشأة" }).click();
    const field = page.getByRole("textbox", { name: "رمز المنشأة" });
    await field.fill("no-such-company");
    await field.blur();
    await expect(page.getByRole("alert")).toHaveText("المنشأة غير موجودة");

    await field.fill("Bad Code!");
    await expect(page.getByRole("alert")).toHaveText("رمز المنشأة غير صالح");
  });

  test("a failing company lookup holds nothing back: the form is there at once with an empty email field, no API request but the lookup leaves without a company, and a typed company signs in", async ({ page }) => {
    const beyondTheLookup: string[] = [];
    let lookups = 0;
    await page.route("**/api/platform/resolve", (route) => {
      lookups += 1;
      return route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" });
    });
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/") && path !== COMPANY_LOOKUP_PATH) beyondTheLookup.push(path);
    });

    await page.goto("/");
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toBeVisible();
    await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "البريد الإلكتروني" })).toHaveValue("");
    await expect.poll(() => lookups).toBeGreaterThan(1);
    expect(beyondTheLookup).toEqual([]);

    await enterTenantCode(page, tenant.code);
    await enterCredentials(page, tenant.adminEmail, tenant.adminPin);
    await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
    expect((await storedSession(page))?.tenantName).toBe(TENANT_NAME);
  });

  test("on a subdomain a failing company lookup does not stand between the owner and sign-in, the screen settles by itself when the lookup answers, and a host known to be a subdomain never asks for a company code again", async ({ page }) => {
    const origin = `http://${second.code}.${TENANT_DOMAIN}:${SAAS_WEB_PORT}`;
    let failing = true;
    await page.route("**/api/platform/resolve", (route) => (failing ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.fallback()));

    await page.goto(`${origin}/`);
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toBeVisible();
    failing = false;
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveCount(0);
    failing = true;
    await page.reload();
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveCount(0);

    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(second.adminEmail);
    await fillPin(page, second.adminPin);
    await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
    expect((await storedSession(page))?.tenantName).toBe(SECOND_NAME);
  });

  test("subdomain mode shows no company-code field and no name, and signs straight into the tenant", async ({ page }) => {
    const origin = `http://${tenant.code}.${TENANT_DOMAIN}:${SAAS_WEB_PORT}`;
    const apiBodies = collectApiBodies(page);
    const resolved = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/platform/resolve");
    await page.goto(`${origin}/`);
    expect(await (await resolved).json()).toEqual({ mode: ResolveMode.Subdomain, exists: true });
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toContainText(TENANT_NAME);
    const beforeSignIn = await apiBodies();
    expect(beforeSignIn.length).toBeGreaterThan(0);
    expect(beforeSignIn.filter((body) => body.includes(TENANT_NAME))).toEqual([]);

    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(tenant.adminEmail);
    await fillPin(page, tenant.adminPin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("وليد");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.TenantCode)).toBeNull();
    expect((await storedSession(page))?.tenantName).toBe(TENANT_NAME);

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
    await expect(page.getByRole("alert")).toHaveText(INVALID_CREDENTIALS_SENTENCE);
    expect(await storedSession(page)).toBeNull();
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
    await enterCredentials(page, second.adminEmail, second.adminPin);
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

  test("on a shared device, the cloud sign-in offers the signup page and never the first-run wizard, and a company just confirmed survives going there and back", async ({ page }) => {
    await tenantSignIn(page, tenant);
    await tenantSignOut(page);
    await page.getByRole("button", { name: "تغيير المنشأة" }).click();
    await enterTenantCode(page, second.code);
    await enterCredentials(page, second.adminEmail, second.adminPin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("دينا");
    await tenantSignOut(page);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveValue("");

    await enterTenantCode(page, tenant.code);
    await expect(page.getByRole("link", { name: SIGNUP_LINK })).toBeVisible();
    await expect(page.getByRole("button", { name: WIZARD_LINK })).toHaveCount(0);
    await page.getByRole("link", { name: SIGNUP_LINK }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "أنشئ حساب ميزان" })).toBeVisible();
    await page.goBack();

    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByText(`الرمز: ${tenant.code}`)).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.TenantCode)).toBe(tenant.code);

    await page.reload();
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toHaveValue("");
    await expect(page.getByRole("radiogroup")).toHaveCount(0);

    await enterTenantCode(page, tenant.code);
    await enterCredentials(page, tenant.adminEmail, tenant.adminPin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("وليد");
  });
});
