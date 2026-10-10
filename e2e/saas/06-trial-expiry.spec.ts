import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { ApiError, BillingCycle, CLOCK_API_PORT, CLOCK_API_URL, CLOCK_WEB_PORT, CLOCK_WEB_URL, PlanId, uniqueCode } from "./support/env";
import { errorOf, rowsOf, tenantApiLogin, tenantCall, tenantSignIn, type ApiAnswer, type TenantApi, type TenantLogin } from "./support/saas";
import { startApiServer, startWebServer, type ServerHandle } from "./support/servers";

const CODE = uniqueCode("trial");
const CUSTOMER_NAME = "عميل فترة التجربة";
const DEPARTMENT_NAME = "قسم فترة التجربة";
const FREE_INVOICE_QUOTA = 100;
const DAY_MS = 86_400_000;

let api: ServerHandle | null = null;
let web: ServerHandle | null = null;
let tenant: TenantLogin;
let trialEndsAt = "";

function call(request: APIRequestContext, session: TenantApi, method: "GET" | "POST", route: string, data?: unknown): Promise<ApiAnswer> {
  return tenantCall(request, session, method, route, data, CLOCK_API_URL);
}

test.describe.configure({ mode: "serial" });

test.describe("Trial expiry — day 15 lands on Free, a lost module goes read-only, the Free quota holds", () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300_000);
    const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-saas-e2e-clock-"));
    const request = await playwright.request.newContext();

    api = await startApiServer({ port: CLOCK_API_PORT, platformDir });
    const start = await request.post(`${CLOCK_API_URL}/api/signup`, {
      data: { code: CODE, nameAr: "شركة التجربة", ownerEmail: `owner@${CODE}.example`, ownerNameAr: "تامر التجربة", planId: PlanId.Core, billingCycle: BillingCycle.Monthly },
    });
    expect(start.status(), await start.text()).toBe(201);
    const token = new URL(((await start.json()) as { devVerifyUrl: string }).devVerifyUrl).searchParams.get("token") ?? "";
    const verify = await request.post(`${CLOCK_API_URL}/api/signup/verify`, { data: { token } });
    expect(verify.status(), await verify.text()).toBe(200);
    const body = (await verify.json()) as { tenant: { id: string }; adminEmail: string; adminPin: string };
    tenant = { id: body.tenant.id, code: CODE, adminEmail: body.adminEmail, adminPin: body.adminPin };

    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const onTrial = await call(request, session, "GET", "/entitlements");
    expect((onTrial.body as { plan: string }).plan).toBe("enterprise");
    trialEndsAt = (onTrial.body as { trialEndsAt: string }).trialEndsAt;
    expect((await call(request, session, "POST", "/customers", { id: "CUST-TRIAL", code: "CT1", nameAr: CUSTOMER_NAME })).status).toBe(201);
    const department = await call(request, session, "POST", "/hr/departments", { id: "DEPT-TRIAL", code: "TRL", name: "Trial department", nameAr: DEPARTMENT_NAME });
    expect(department.status, JSON.stringify(department.body)).toBe(201);

    await api.stop();
    const dayAfter = new Date(Date.parse(trialEndsAt) + DAY_MS).toISOString().slice(0, 10);
    api = await startApiServer({ port: CLOCK_API_PORT, platformDir, fakeToday: dayAfter });
    web = await startWebServer({ port: CLOCK_WEB_PORT, apiUrl: CLOCK_API_URL });
    await request.dispose();
  });

  test.afterAll(async () => {
    await web?.stop();
    await api?.stop();
  });

  test("the day after the trial the tenant is on Free, signed in, with its data intact", async ({ page, request }) => {
    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const entitlements = await call(request, session, "GET", "/entitlements");
    expect((entitlements.body as { plan: string; planKind: string }).plan).toBe("free");
    expect((entitlements.body as { planKind: string }).planKind).toBe("free");
    expect((entitlements.body as { readOnlyModules: string[] }).readOnlyModules).toContain("hr");

    await tenantSignIn(page, tenant, CLOCK_WEB_URL);
    await expect(page.getByRole("status").filter({ hasText: "تجربتك المجانية" })).toHaveCount(0);
    await page.goto(`${CLOCK_WEB_URL}/setup/settings-billing`);
    await expect(page.getByRole("heading", { name: "المجانية", level: 2 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/فواتير المبيعات[^\d]*0\s*من\s*100/);

    await page.goto(`${CLOCK_WEB_URL}/sell/customers`);
    await expect(page.getByRole("cell", { name: CUSTOMER_NAME }).first()).toBeVisible();
  });

  test("a module that left the plan still reads and refuses writes in Arabic", async ({ page, request }) => {
    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const read = await call(request, session, "GET", "/hr/departments");
    expect(read.status).toBe(200);
    expect(rowsOf(read.body).map((row) => row["nameAr"])).toContain(DEPARTMENT_NAME);
    const write = await call(request, session, "POST", "/hr/departments", { id: "DEPT-AFTER", code: "AFT", name: "After", nameAr: "قسم بعد التجربة" });
    expect(write.status).toBe(403);
    expect(errorOf(write).error).toBe(ApiError.ModuleReadOnly);
    const sentence = errorOf(write).message ?? "";
    expect(sentence).toMatch(/[؀-ۿ]/);

    await tenantSignIn(page, tenant, CLOCK_WEB_URL);
    await page.goto(`${CLOCK_WEB_URL}/people/departments`);
    await expect(page.getByRole("heading", { name: "الأقسام", level: 1 })).toBeVisible();
    await expect(page.getByRole("cell", { name: DEPARTMENT_NAME }).first()).toBeVisible();

    await page.getByRole("button", { name: "إضافة قسم" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/الكود|كود القسم/).first().fill("UI1");
    await dialog.getByLabel(/اسم القسم|الاسم/).first().fill("قسم من الواجهة");
    const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/hr/departments" && r.request().method() === "POST");
    await dialog.getByRole("button", { name: /حفظ|إضافة/ }).last().click();
    expect((await refused).status()).toBe(403);
    await expect(page.getByText(sentence).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(ApiError.ModuleReadOnly);

    await page.reload();
    await expect(page.getByRole("cell", { name: DEPARTMENT_NAME }).first()).toBeVisible();
    await expect(page.getByText("قسم من الواجهة")).toHaveCount(0);
  });

  test("the Free plan accepts 100 sales invoices in the month and refuses the 101st in Arabic", async ({ page, request }) => {
    test.setTimeout(240_000);
    const session = await tenantApiLogin(request, tenant, CLOCK_API_URL);
    const usage = await call(request, session, "GET", "/billing/subscription");
    const today = (usage.body as { today: string }).today;
    const customerId = String(rowsOf((await call(request, session, "GET", "/customers")).body)[0]?.["id"]);
    const item = await call(request, session, "POST", "/items", { id: "ITEM-QUOTA", code: "SVCQ", nameAr: "خدمة استشارية", type: "service", baseUnitCode: "PCS", trackInventory: false });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const branchId = String(rowsOf((await call(request, session, "GET", "/branches")).body)[0]?.["id"]);
    const warehouseId = String(rowsOf((await call(request, session, "GET", "/warehouses")).body)[0]?.["id"]);
    const accounts = rowsOf((await call(request, session, "GET", "/accounts?pageSize=500")).body);
    const accountId = (code: string): string => String(accounts.find((account) => account["code"] === code)?.["id"] ?? "");
    const invoice = (n: number) => ({
      date: today,
      dueDate: today,
      customerId,
      customerNameAr: CUSTOMER_NAME,
      customerTaxExempt: false,
      warehouseId,
      branchId,
      currency: "EGP",
      discount: { type: "percent", percent: 0 },
      arAccountId: accountId("1105") || accountId("1200"),
      taxAccountId: accountId("2200"),
      lines: [
        { lineId: `L${n}`, itemId: "ITEM-QUOTA", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", discountType: "percent", discountPercent: 0, taxRatePercent: 0, revenueAccountId: accountId("4100") },
      ],
    });

    for (let n = 1; n <= FREE_INVOICE_QUOTA; n += 1) {
      const created = await call(request, session, "POST", "/sales-invoices", invoice(n));
      expect(created.status, `invoice ${n}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(201);
    }
    const refused = await call(request, session, "POST", "/sales-invoices", invoice(FREE_INVOICE_QUOTA + 1));
    expect(refused.status).toBe(409);
    expect(errorOf(refused).error).toBe(ApiError.PlanLimitReached);
    expect(errorOf(refused).message ?? "").toMatch(/[؀-ۿ]/);

    await tenantSignIn(page, tenant, CLOCK_WEB_URL);
    await page.goto(`${CLOCK_WEB_URL}/setup/settings-billing`);
    await expect(page.locator("main")).toContainText(/فواتير المبيعات[^\d]*100\s*من\s*100/);
    await page.goto(`${CLOCK_WEB_URL}/sell/sales-invoices`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("table").getByRole("row").nth(1)).toBeVisible();
  });
});
