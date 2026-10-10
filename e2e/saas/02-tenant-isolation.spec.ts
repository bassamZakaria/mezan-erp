import { test, expect, type Page } from "@playwright/test";
import { ApiError, PlanId, SAAS_API_URL, StorageKey, uniqueCode } from "./support/env";
import {
  enterTenantCode,
  errorOf,
  fillPin,
  platformToken,
  provisionTenant,
  rowsOf,
  tenantApiLogin,
  tenantCall,
  tenantSignIn,
  tenantSignOut,
  type TenantLogin,
} from "./support/saas";

const CUSTOMER_OF_A = `عميل النيل ${uniqueCode("a")}`;

let tenantA: TenantLogin;
let tenantB: TenantLogin;

async function addCustomer(page: Page, name: string): Promise<void> {
  await page.goto("/sell/customers");
  await page.getByRole("button", { name: "إضافة عميل" }).first().click();
  const dialog = page.getByRole("dialog", { name: "إضافة عميل" });
  await dialog.getByLabel("اسم العميل").fill(name);
  const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/customers" && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "إضافة عميل" }).click();
  expect((await created).status()).toBe(201);
}

test.describe.configure({ mode: "serial" });

test.describe("PLT-SAAS-07 — one tenant never sees another tenant's data", () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    tenantA = await provisionTenant(request, { code: uniqueCode("alpha"), nameAr: "شركة ألفا", ownerNameAr: "علي ألفا", planId: PlanId.Business, trial: true });
    tenantB = await provisionTenant(request, { code: uniqueCode("nile"), nameAr: "شركة النيل", ownerNameAr: "نهى النيل", planId: PlanId.Core, trial: false });
    await request.dispose();
  });

  test("a customer created in A is absent from B in the UI and persists in A", async ({ page, browser }) => {
    await tenantSignIn(page, tenantA);
    await addCustomer(page, CUSTOMER_OF_A);
    await page.reload();
    await expect(page.getByRole("cell", { name: CUSTOMER_OF_A }).first()).toBeVisible();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await tenantSignIn(pageB, tenantB);
    await pageB.goto("/sell/customers");
    await expect(pageB.getByText(/عرض 0 من 0 عميل/)).toBeVisible();
    await pageB.getByRole("searchbox").fill(CUSTOMER_OF_A);
    await expect(pageB.getByText("لا يوجد عملاء مطابقون")).toBeVisible();
    await expect(pageB.getByText(CUSTOMER_OF_A)).toHaveCount(0);
    await contextB.close();
  });

  test("B's token with A's tenant header is refused and returns no rows", async ({ request }) => {
    const apiA = await tenantApiLogin(request, tenantA);
    const apiB = await tenantApiLogin(request, tenantB);

    const own = await tenantCall(request, apiA, "GET", "/customers");
    expect(rowsOf(own.body).map((row) => row["nameAr"])).toContain(CUSTOMER_OF_A);

    const crossed = await tenantCall(request, { code: tenantA.code, token: apiB.token }, "GET", "/customers");
    expect(crossed.status).toBe(401);
    expect(errorOf(crossed).error).toBe(ApiError.SessionExpired);
    expect(JSON.stringify(crossed.body)).not.toContain(CUSTOMER_OF_A);

    const crossedWrite = await tenantCall(request, { code: tenantA.code, token: apiB.token }, "POST", "/customers", { nameAr: "دخيل" });
    expect(crossedWrite.status).toBe(401);

    const inB = await tenantCall(request, apiB, "GET", "/customers");
    expect(inB.status).toBe(200);
    expect(rowsOf(inB.body)).toHaveLength(0);

    const anonymous = await request.get(`${SAAS_API_URL}/api/customers`, { headers: { "x-mezan-tenant": tenantA.code } });
    expect(anonymous.status()).toBe(401);

    const afterAttack = await tenantCall(request, apiA, "GET", "/customers");
    expect(rowsOf(afterAttack.body).map((row) => row["nameAr"])).not.toContain("دخيل");
  });

  test("each tenant has its own database file", async ({ request }) => {
    const token = await platformToken(request);
    const response = await request.get(`${SAAS_API_URL}/api/platform/tenants`, { headers: { authorization: `Bearer ${token}` } });
    const files = ((await response.json()) as { tenant: { code: string; dbFile: string } }[])
      .filter((row) => row.tenant.code === tenantA.code || row.tenant.code === tenantB.code)
      .map((row) => row.tenant.dbFile);
    expect(files).toHaveLength(2);
    expect(new Set(files).size).toBe(2);
    expect(files).toContain(`tenants/${tenantA.code}.db`);
    expect(files).toContain(`tenants/${tenantB.code}.db`);
  });

  test("signing out of A and into B on the same browser shows nothing cached from A", async ({ page, request }) => {
    await tenantSignIn(page, tenantA);
    await page.goto("/sell/customers");
    await expect(page.getByRole("cell", { name: CUSTOMER_OF_A }).first()).toBeVisible();
    const tokenOfA = await page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "{}") as { token?: string }).token ?? "", StorageKey.Session);
    expect(tokenOfA).not.toBe("");

    await tenantSignOut(page);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.Session)).toBeNull();
    const revoked = await tenantCall(request, { code: tenantA.code, token: tokenOfA }, "GET", "/customers");
    expect(revoked.status).toBe(401);

    await page.goBack();
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByText(CUSTOMER_OF_A)).toHaveCount(0);

    await page.getByRole("button", { name: "تغيير المنشأة" }).click();
    await enterTenantCode(page, tenantB.code);
    await expect(page.getByRole("radio", { name: /علي ألفا/ })).toHaveCount(0);
    const email = page.getByRole("textbox", { name: "البريد الإلكتروني" });
    if (!(await email.isVisible())) await page.getByRole("button", { name: "آخر", exact: true }).click();
    await email.fill(tenantB.adminEmail);
    await fillPin(page, tenantB.adminPin);
    await expect(page.getByRole("button", { name: "نهى النيل" })).toBeVisible();

    await page.goto("/sell/customers");
    await expect(page.getByText(/عرض 0 من 0 عميل/)).toBeVisible();
    await expect(page.getByText(CUSTOMER_OF_A)).toHaveCount(0);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.TenantCode)).toBe(tenantB.code);
  });

  test("an invalidated session mid-work lands on sign-in with the reason, not on stale data", async ({ page, request }) => {
    await tenantSignIn(page, tenantA);
    const token = await page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "{}") as { token?: string }).token ?? "", StorageKey.Session);
    const logout = await request.post(`${SAAS_API_URL}/api/auth/logout`, { headers: { authorization: `Bearer ${token}`, "x-mezan-tenant": tenantA.code } });
    expect(logout.status()).toBeLessThan(300);
    await page.goto("/sell/customers");
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("انتهت الجلسة");
    await expect(page.getByText(CUSTOMER_OF_A)).toHaveCount(0);
  });
});
