import { type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { test, expect, directApi } from "./support/test";
import {
  ApiError,
  CodePrefix,
  DEMO_API_URL,
  DEMO_SERVER_TODAY,
  DEMO_TENANT,
  DEMO_WEB_URL,
  HttpMethod,
  Locale,
  PlanId,
  Theme,
  uniqueCode,
} from "./support/env";
import {
  expectHealthyScreen,
  bearer,
  platformToken,
  provisionTenant,
  rowsOf,
  setLook,
  tenantApiLogin,
  tenantCall,
  tenantSignIn,
  watchPage,
  type ApiAnswer,
  type TenantApi,
  type TenantLogin,
} from "./support/saas";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface ListScreen {
  readonly name: string;
  readonly path: string;
  readonly api: string;
}

const DAY_MS = 86_400_000;
const SERVER_NOON = new Date(`${DEMO_SERVER_TODAY}T12:00:00.000Z`);
const DEMO_ADMIN_FIRST_NAME = "محمد";
const WAREHOUSE_LIMIT_SENTENCE = "وصلتم إلى الحد الأقصى للمستودعات في باقتكم";
const SEARCH_WORDS_PER_NAME = 2;

const HEAVIEST_LISTS: readonly ListScreen[] = [
  { name: "chart-of-accounts", path: "/money/coa", api: "/accounts" },
  { name: "customers", path: "/sell/customers", api: "/customers" },
  { name: "sales-invoices", path: "/sell/sales-invoices", api: "/sales-invoices" },
  { name: "purchase-invoices", path: "/buy/purchase-invoices", api: "/purchases/invoices" },
  { name: "journal-entries", path: "/money/journals", api: "/gl/journal-entries" },
  { name: "items", path: "/items/items", api: "/items" },
  { name: "users", path: "/setup/users", api: "/users" },
  { name: "suppliers", path: "/buy/vendors", api: "/suppliers" },
  { name: "employees", path: "/people/employees", api: "/hr/employees" },
  { name: "warehouses", path: "/setup/settings-warehouses", api: "/warehouses" },
];

let demo: TenantLogin;
let beside: TenantLogin;
let demoState: StorageState;

function call(request: APIRequestContext, session: TenantApi, method: HttpMethod, route: string, data?: unknown): Promise<ApiAnswer> {
  return tenantCall(request, session, method, route, data, DEMO_API_URL);
}

async function onServerDay(page: Page): Promise<void> {
  await page.clock.setFixedTime(SERVER_NOON);
}

async function platformTenant(request: APIRequestContext, match: (row: { tenant: { id: string; code: string } }) => boolean) {
  const token = await platformToken(request, DEMO_API_URL);
  const listed = await request.get(`${DEMO_API_URL}/api/platform/tenants`, { headers: { ...bearer(token) } });
  expect(listed.status()).toBe(200);
  const rows = (await listed.json()) as { tenant: { id: string; code: string }; subscription: { status: string; trialEndsAt: string | null } | null }[];
  const found = rows.find(match);
  expect(found, "the tenant is listed in the console").toBeDefined();
  return found!;
}

test.describe.configure({ mode: "serial" });

test.describe("A populated tenant — the seeded demo beside a freshly provisioned one, on one server", () => {
  test.beforeAll(async ({ browser, playwright }) => {
    const request = await directApi(playwright);
    const listed = await platformTenant(request, (row) => row.tenant.code === DEMO_TENANT.code);
    demo = { id: listed.tenant.id, ...DEMO_TENANT };
    beside = await provisionTenant(
      request,
      { code: uniqueCode(CodePrefix.BesideDemo), nameAr: "شركة بجوار العرض", ownerNameAr: "جيهان الجوار", planId: PlanId.Business, trial: true },
      DEMO_API_URL,
    );
    await request.dispose();

    const context = await browser.newContext();
    await setLook(context, Locale.Arabic, Theme.Light);
    const page = await context.newPage();
    await onServerDay(page);
    await tenantSignIn(page, demo, DEMO_WEB_URL);
    demoState = await context.storageState();
    await context.close();
  });

  test("the demo tenant signs in on the server's day and greets its seeded admin", async ({ page }) => {
    await onServerDay(page);
    await tenantSignIn(page, demo, DEMO_WEB_URL);

    await page.goto(`${DEMO_WEB_URL}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(DEMO_ADMIN_FIRST_NAME);
    expect(await page.evaluate(() => new Date().toISOString().slice(0, 10))).toBe(DEMO_SERVER_TODAY);
  });

  test("a new tenant on the same server reads none of the demo's customers: not by list, not by id, not by search", async ({ page, request }) => {
    const demoSession = await tenantApiLogin(request, demo, DEMO_API_URL);
    const besideSession = await tenantApiLogin(request, beside, DEMO_API_URL);
    const demoCustomers = rowsOf((await call(request, demoSession, HttpMethod.Get, "/customers")).body);
    expect(demoCustomers.length, "the demo has customers to keep apart").toBeGreaterThan(20);

    const listed = await call(request, besideSession, HttpMethod.Get, "/customers");
    expect(listed.status).toBe(200);
    expect(rowsOf(listed.body)).toEqual([]);

    for (const customer of demoCustomers) {
      const id = String(customer["id"]);
      const name = String(customer["nameAr"]);
      const byId = await call(request, besideSession, HttpMethod.Get, `/customers/${encodeURIComponent(id)}`);
      expect(byId.status, `${id} by id`).toBe(404);
      expect(JSON.stringify(byId.body), `${id} by id`).not.toContain(name);

      const words = name.split(/\s+/).slice(0, SEARCH_WORDS_PER_NAME).join(" ");
      const found = await call(request, besideSession, HttpMethod.Get, `/customers?q=${encodeURIComponent(words)}`);
      expect(found.status, `search for ${words}`).toBe(200);
      expect(rowsOf(found.body), `search for ${words}`).toEqual([]);
      expect(rowsOf((await call(request, demoSession, HttpMethod.Get, `/customers?q=${encodeURIComponent(words)}`)).body).length, `the demo itself finds ${words}`).toBeGreaterThan(0);
    }

    await onServerDay(page);
    await tenantSignIn(page, beside, DEMO_WEB_URL);
    await page.goto(`${DEMO_WEB_URL}/sell/customers`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const shown = await page.locator("main").innerText();
    for (const customer of demoCustomers) expect(shown).not.toContain(String(customer["nameAr"]));
  });

  test("the ten heaviest lists of the populated tenant open with their rows, one h1, no errors and no page scroll", async ({ browser, request }) => {
    test.setTimeout(240_000);
    const demoSession = await tenantApiLogin(request, demo, DEMO_API_URL);
    for (const screen of HEAVIEST_LISTS) {
      await test.step(screen.name, async () => {
        const stored = rowsOf((await call(request, demoSession, HttpMethod.Get, screen.api)).body).length;
        expect(stored, `${screen.name}: the seed left rows to show`).toBeGreaterThan(0);

        const context = await browser.newContext({ storageState: demoState });
        await setLook(context, Locale.Arabic, Theme.Light);
        const page = await context.newPage();
        await onServerDay(page);
        const watch = watchPage(page);
        await page.goto(`${DEMO_WEB_URL}${screen.path}`);
        await expect(page.locator("h1").first()).toBeVisible();
        await expect(page.locator("main tbody tr").first(), `${screen.name}: rows are on screen`).toBeVisible();
        expect(await page.locator("main tbody tr").count(), `${screen.name}: rows are on screen`).toBeGreaterThan(0);
        await expectHealthyScreen(page, { name: `demo-${screen.name}`, locale: Locale.Arabic, watch });
        await context.close();
      });
    }
  });

  test("the plan's warehouse limit holds on the populated tenant: it fills up to the limit and the next one is refused in Arabic", async ({ request }) => {
    const session = await tenantApiLogin(request, demo, DEMO_API_URL);
    const limit = ((await call(request, session, HttpMethod.Get, "/entitlements")).body as { limits: { warehouses: number } }).limits.warehouses;
    const existing = rowsOf((await call(request, session, HttpMethod.Get, "/warehouses")).body);
    const room = limit - existing.length;
    expect(existing.length, "the seed's own warehouses").toBeGreaterThan(1);
    expect(room, "room left under the limit to fill").toBeGreaterThan(0);
    const branchId = String(existing[0]?.["branchId"]);
    const add = (n: number) =>
      call(request, session, HttpMethod.Post, "/warehouses", { id: `WH-LIMIT-${n}`, code: `LIMIT-${n}`, name: `مستودع الحد ${n}`, branchId });

    for (let n = 1; n <= room; n += 1) {
      expect((await add(n)).status, `warehouse ${existing.length + n} of ${limit}`).toBe(201);
    }
    const refused = await add(room + 1);

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: ApiError.WarehouseLimitReached, message: WAREHOUSE_LIMIT_SENTENCE });
    expect(rowsOf((await call(request, session, HttpMethod.Get, "/warehouses")).body)).toHaveLength(limit);
  });

  test("a trial tenant's banner counts the days from the server's day, with the browser on that same day", async ({ page, request }) => {
    const listed = await platformTenant(request, (row) => row.tenant.id === beside.id);
    const trialEndsAt = listed.subscription?.trialEndsAt ?? "";
    const daysLeft = Math.round((Date.parse(trialEndsAt.slice(0, 10)) - Date.parse(DEMO_SERVER_TODAY)) / DAY_MS);
    expect(daysLeft, "the trial is still running").toBeGreaterThan(0);

    await onServerDay(page);
    await tenantSignIn(page, beside, DEMO_WEB_URL);
    await page.goto(`${DEMO_WEB_URL}/dashboard`);

    await expect(page.getByRole("status").filter({ hasText: "تجربتك المجانية" })).toContainText(`تبقّى ${daysLeft} يومًا من تجربتك المجانية`);
    expect(await page.evaluate(() => new Date().toISOString().slice(0, 10))).toBe(DEMO_SERVER_TODAY);
  });
});
