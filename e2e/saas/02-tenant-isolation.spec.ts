import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  ApiError,
  CodePrefix,
  FORWARDED_HOST_HEADER,
  HttpMethod,
  PLATFORM_DIR_ENV,
  PlanId,
  SAAS_API_URL,
  StorageKey,
  TENANT_DOMAIN,
  TENANT_HEADER,
  TenantStatus,
  uniqueCode,
} from "./support/env";
import {
  addCustomer,
  enterCredentials,
  enterTenantCode,
  errorOf,
  platformToken,
  provisionTenant,
  rowsOf,
  storedSession,
  tenantApiLogin,
  tenantCall,
  tenantSignIn,
  tenantSignOut,
  type TenantLogin,
} from "./support/saas";

const CUSTOMER_OF_A = `عميل النيل ${uniqueCode(CodePrefix.IsolatedA)}`;
const INTRUDER_NAME = "دخيل";
const SQLITE_SIDECARS = ["", "-wal"];

let tenantA: TenantLogin;
let tenantB: TenantLogin;

function bytesOnDisk(dbPath: string): Buffer {
  return Buffer.concat(SQLITE_SIDECARS.map((suffix) => `${dbPath}${suffix}`).filter((file) => existsSync(file)).map((file) => readFileSync(file)));
}

test.describe.configure({ mode: "serial" });

test.describe("PLT-SAAS-07 — one tenant never sees another tenant's data", () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    tenantA = await provisionTenant(request, { code: uniqueCode(CodePrefix.IsolatedA), nameAr: "شركة ألفا", ownerNameAr: "علي ألفا", planId: PlanId.Business, trial: true });
    tenantB = await provisionTenant(request, { code: uniqueCode(CodePrefix.IsolatedB), nameAr: "شركة النيل", ownerNameAr: "نهى النيل", planId: PlanId.Core, trial: false });
    await request.dispose();
  });

  test("a customer created in A is absent from B in the UI and persists in A", async ({ page, browser }) => {
    await tenantSignIn(page, tenantA);
    expect(await addCustomer(page, CUSTOMER_OF_A)).toBe(201);
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
    const crossed = { code: tenantA.code, token: apiB.token };

    const own = await tenantCall(request, apiA, HttpMethod.Get, "/customers");
    expect(rowsOf(own.body).map((row) => row["nameAr"])).toEqual([CUSTOMER_OF_A]);

    const crossedRead = await tenantCall(request, crossed, HttpMethod.Get, "/customers");
    expect(crossedRead.status).toBe(401);
    expect(errorOf(crossedRead).error).toBe(ApiError.SessionExpired);
    expect(JSON.stringify(crossedRead.body)).not.toContain(CUSTOMER_OF_A);

    const crossedWrite = await tenantCall(request, crossed, HttpMethod.Post, "/customers", { id: "CUST-INTRUDER", code: "INT", nameAr: INTRUDER_NAME });
    expect(crossedWrite.status).toBe(401);
    expect(errorOf(crossedWrite).error).toBe(ApiError.SessionExpired);

    const inB = await tenantCall(request, apiB, HttpMethod.Get, "/customers");
    expect(inB.status).toBe(200);
    expect(rowsOf(inB.body)).toEqual([]);

    const anonymous = await request.get(`${SAAS_API_URL}/api/customers`, { headers: { [TENANT_HEADER]: tenantA.code } });
    expect(anonymous.status()).toBe(401);
    expect(JSON.stringify(await anonymous.json())).not.toContain(CUSTOMER_OF_A);

    const afterAttack = await tenantCall(request, apiA, HttpMethod.Get, "/customers");
    expect(rowsOf(afterAttack.body).map((row) => row["nameAr"])).toEqual([CUSTOMER_OF_A]);
  });

  test("A's subdomain decides the tenant, whatever header and token B sends with it", async ({ request }) => {
    const apiB = await tenantApiLogin(request, tenantB);
    const onHostOfA = { [FORWARDED_HOST_HEADER]: `${tenantA.code}.${TENANT_DOMAIN}` };

    const read = await tenantCall(request, apiB, HttpMethod.Get, "/customers", undefined, SAAS_API_URL, onHostOfA);
    expect(read.status).toBe(401);
    expect(errorOf(read).error).toBe(ApiError.SessionExpired);
    expect(JSON.stringify(read.body)).not.toContain(CUSTOMER_OF_A);

    const write = await tenantCall(request, apiB, HttpMethod.Post, "/customers", { id: "CUST-HOST", code: "HST", nameAr: INTRUDER_NAME }, SAAS_API_URL, onHostOfA);
    expect(write.status).toBe(401);

    const apiA = await tenantApiLogin(request, tenantA);
    const onHostOfB = { [FORWARDED_HOST_HEADER]: `${tenantB.code}.${TENANT_DOMAIN}` };
    const reversed = await tenantCall(request, apiA, HttpMethod.Get, "/customers", undefined, SAAS_API_URL, onHostOfB);
    expect(reversed.status).toBe(401);
    expect(errorOf(reversed).error).toBe(ApiError.SessionExpired);

    expect(rowsOf((await tenantCall(request, apiA, HttpMethod.Get, "/customers")).body).map((row) => row["nameAr"])).toEqual([CUSTOMER_OF_A]);
    expect(rowsOf((await tenantCall(request, apiB, HttpMethod.Get, "/customers")).body)).toEqual([]);
  });

  test("a tenant session opens no platform route, and a platform session opens no tenant route", async ({ request }) => {
    const apiA = await tenantApiLogin(request, tenantA);
    const operator = await platformToken(request);

    for (const route of ["/tenants", `/tenants/${tenantB.id}`, `/tenants/${tenantB.id}/payments`, "/plans", "/users"]) {
      const asTenant = await request.get(`${SAAS_API_URL}/api/platform${route}`, {
        headers: { authorization: `Bearer ${apiA.token}`, [TENANT_HEADER]: tenantA.code },
      });
      expect(asTenant.status(), route).toBe(401);
      expect(((await asTenant.json()) as { error: string }).error, route).toBe(ApiError.Unauthenticated);
    }
    const suspendAsTenant = await request.post(`${SAAS_API_URL}/api/platform/tenants/${tenantB.id}/suspend`, { headers: { authorization: `Bearer ${apiA.token}` } });
    expect(suspendAsTenant.status()).toBe(401);

    const asOperator = { code: tenantA.code, token: operator };
    const read = await tenantCall(request, asOperator, HttpMethod.Get, "/customers");
    expect(read.status).toBe(401);
    expect(errorOf(read).error).toBe(ApiError.SessionExpired);
    expect(JSON.stringify(read.body)).not.toContain(CUSTOMER_OF_A);
    expect((await tenantCall(request, asOperator, HttpMethod.Post, "/customers", { id: "CUST-OPERATOR", code: "OPR", nameAr: INTRUDER_NAME })).status).toBe(401);

    const tenants = await request.get(`${SAAS_API_URL}/api/platform/tenants`, { headers: { authorization: `Bearer ${operator}` } });
    const statusOfB = ((await tenants.json()) as { tenant: { id: string; status: string } }[]).find((row) => row.tenant.id === tenantB.id)?.tenant.status;
    expect(statusOfB).toBe(TenantStatus.Active);
    expect(rowsOf((await tenantCall(request, apiA, HttpMethod.Get, "/customers")).body).map((row) => row["nameAr"])).toEqual([CUSTOMER_OF_A]);
  });

  test("a record of A cannot be read or changed by its id from B", async ({ request }) => {
    const apiA = await tenantApiLogin(request, tenantA);
    const apiB = await tenantApiLogin(request, tenantB);
    const customerOfA = rowsOf((await tenantCall(request, apiA, HttpMethod.Get, "/customers")).body)[0];
    const id = String(customerOfA?.["id"]);
    expect(id).not.toBe("undefined");
    expect((await tenantCall(request, apiA, HttpMethod.Get, `/customers/${id}`)).status).toBe(200);

    const read = await tenantCall(request, apiB, HttpMethod.Get, `/customers/${id}`);
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain(CUSTOMER_OF_A);

    const change = await tenantCall(request, apiB, HttpMethod.Patch, `/customers/${id}`, { nameAr: INTRUDER_NAME });
    expect(change.status).toBe(404);

    const unchanged = await tenantCall(request, apiA, HttpMethod.Get, `/customers/${id}`);
    expect((unchanged.body as { nameAr: string }).nameAr).toBe(CUSTOMER_OF_A);
    const sameChangeByOwner = await tenantCall(request, apiA, HttpMethod.Patch, `/customers/${id}`, { nameAr: CUSTOMER_OF_A });
    expect(sameChangeByOwner.status, "the change B was refused is one the route accepts from A").toBe(200);
    expect(rowsOf((await tenantCall(request, apiB, HttpMethod.Get, "/customers")).body)).toEqual([]);
  });

  test("each tenant has its own database file on disk, and A's customer is written only into A's", async ({ request }) => {
    const token = await platformToken(request);
    const response = await request.get(`${SAAS_API_URL}/api/platform/tenants`, { headers: { authorization: `Bearer ${token}` } });
    const listed = (await response.json()) as { tenant: { code: string; dbFile: string } }[];
    const dbFileOf = (code: string): string => listed.find((row) => row.tenant.code === code)?.tenant.dbFile ?? "";
    expect(dbFileOf(tenantA.code)).toBe(`tenants/${tenantA.code}.db`);
    expect(dbFileOf(tenantB.code)).toBe(`tenants/${tenantB.code}.db`);

    const platformDir = process.env[PLATFORM_DIR_ENV] ?? "";
    expect(platformDir, `${PLATFORM_DIR_ENV} names the directory the server was started on`).not.toBe("");
    const fileOfA = path.join(platformDir, dbFileOf(tenantA.code));
    const fileOfB = path.join(platformDir, dbFileOf(tenantB.code));
    expect(existsSync(fileOfA), fileOfA).toBe(true);
    expect(existsSync(fileOfB), fileOfB).toBe(true);
    expect(statSync(fileOfA).ino).not.toBe(statSync(fileOfB).ino);

    const marker = Buffer.from(CUSTOMER_OF_A, "utf8");
    expect(bytesOnDisk(fileOfA).includes(marker), "A's customer is in A's file").toBe(true);
    expect(bytesOnDisk(fileOfB).includes(marker), "A's customer is in B's file").toBe(false);
  });

  test("signing out of A and into B on the same browser shows nothing cached from A", async ({ page, request }) => {
    await tenantSignIn(page, tenantA);
    await page.goto("/sell/customers");
    await expect(page.getByRole("cell", { name: CUSTOMER_OF_A }).first()).toBeVisible();
    const tokenOfA = (await storedSession(page))?.token ?? "";
    expect(tokenOfA).not.toBe("");

    await tenantSignOut(page);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.Session)).toBeNull();
    const revoked = await tenantCall(request, { code: tenantA.code, token: tokenOfA }, HttpMethod.Get, "/customers");
    expect(revoked.status).toBe(401);

    await page.goBack();
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByText(CUSTOMER_OF_A)).toHaveCount(0);

    await page.getByRole("button", { name: "تغيير المنشأة" }).click();
    await enterTenantCode(page, tenantB.code);
    await expect(page.getByRole("radio", { name: /علي ألفا/ })).toHaveCount(0);
    await enterCredentials(page, tenantB.adminEmail, tenantB.adminPin);
    await expect(page.getByRole("button", { name: "نهى النيل" })).toBeVisible();

    await page.goto("/sell/customers");
    await expect(page.getByText(/عرض 0 من 0 عميل/)).toBeVisible();
    await expect(page.getByText(CUSTOMER_OF_A)).toHaveCount(0);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), StorageKey.TenantCode)).toBe(tenantB.code);
  });

  test("an invalidated session mid-work lands on sign-in with the reason, not on stale data", async ({ page, request }) => {
    await tenantSignIn(page, tenantA);
    const token = (await storedSession(page))?.token ?? "";
    const logout = await request.post(`${SAAS_API_URL}/api/auth/logout`, { headers: { authorization: `Bearer ${token}`, [TENANT_HEADER]: tenantA.code } });
    expect(logout.status()).toBe(200);
    await page.goto("/sell/customers");
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("انتهت الجلسة");
    await expect(page.getByText(CUSTOMER_OF_A)).toHaveCount(0);
  });

  test("the reason a session ended is still on sign-in after the page loads again, and goes once the user starts to sign in", async ({ page, request }) => {
    await tenantSignIn(page, tenantA);
    const token = (await storedSession(page))?.token ?? "";
    const logout = await request.post(`${SAAS_API_URL}/api/auth/logout`, { headers: { authorization: `Bearer ${token}`, [TENANT_HEADER]: tenantA.code } });
    expect(logout.status()).toBe(200);

    await page.reload();
    await expect(page.getByRole("status")).toContainText("انتهت الجلسة");
    await page.reload();
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("انتهت الجلسة");

    await page.getByLabel("رمز PIN رقم 1").fill("1");
    await expect(page.getByRole("status")).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("رمز PIN رقم 1")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});
