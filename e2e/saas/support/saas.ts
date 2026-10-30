import { mkdirSync } from "node:fs";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import {
  ApiError,
  BillingCycle,
  Currency,
  DiscountType,
  HttpMethod,
  ItemType,
  Locale,
  PASSWORD_LABEL,
  PLATFORM_OWNER_EMAIL,
  PLATFORM_OWNER_PASSWORD,
  PlanId,
  SAAS_API_URL,
  StorageKey,
  TENANT_HEADER,
  Theme,
  WALK_DIR,
} from "./env";

export interface TenantLogin {
  readonly id: string;
  readonly code: string;
  readonly adminEmail: string;
  readonly adminPassword: string;
}

export interface NewTenantInput {
  readonly code: string;
  readonly nameAr: string;
  readonly ownerNameAr: string;
  readonly planId: PlanId;
  readonly trial: boolean;
}

export interface TenantApi {
  readonly code: string;
  readonly token: string;
}

const PLAN_OPTION: Record<PlanId, RegExp> = {
  [PlanId.Free]: /free$/,
  [PlanId.Core]: /core$/,
  [PlanId.Business]: /business$/,
  [PlanId.Enterprise]: /enterprise$/,
};

const RAW_ENUM = /\b(?:[A-Z]{2,}_[A-Z_]{2,}|[a-z]{3,}_[a-z_]{3,})\b/;
const OVERFLOW_TOLERANCE = 2;
const SANDBOXED_PREVIEW = "about:srcdoc";
const SANDBOX_REFUSAL = /^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/;

export async function platformSignIn(page: Page, baseUrl = ""): Promise<void> {
  await page.goto(`${baseUrl}/platform/login`);
  await page.getByLabel("البريد الإلكتروني").fill(PLATFORM_OWNER_EMAIL);
  await page.getByLabel("كلمة المرور").fill(PLATFORM_OWNER_PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
  await expect(page.getByRole("heading", { name: "المنشآت", level: 1 })).toBeVisible();
}

export async function createTenantInConsole(page: Page, input: NewTenantInput): Promise<TenantLogin> {
  await page.getByRole("button", { name: "منشأة جديدة" }).click();
  const dialog = page.getByRole("dialog", { name: "منشأة جديدة" });
  await dialog.getByLabel("الكود").fill(input.code);
  await dialog.getByLabel("الاسم بالعربية").fill(input.nameAr);
  await dialog.getByLabel("اسم مالك الحساب").fill(input.ownerNameAr);
  await dialog.getByLabel("البريد الإلكتروني لمالك الحساب").fill(`owner@${input.code}.example`);
  await dialog.getByRole("combobox", { name: "الباقة" }).click();
  await page.getByRole("option", { name: PLAN_OPTION[input.planId] }).click();
  const trial = dialog.getByRole("switch", { name: "فترة تجريبية" });
  if ((await trial.getAttribute("aria-checked")) !== String(input.trial)) await trial.click();
  const created = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/platform/tenants" && r.request().method() === HttpMethod.Post,
  );
  await dialog.getByRole("button", { name: "إنشاء المنشأة" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { tenant: { id: string }; adminEmail: string; adminPassword: string };
  return { id: body.tenant.id, code: input.code, adminEmail: body.adminEmail, adminPassword: body.adminPassword };
}

export async function openTenantDetail(page: Page, code: string): Promise<void> {
  await page.goto("/platform/tenants");
  await page.getByRole("row").filter({ hasText: code }).getByRole("button", { name: "عرض" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants\/[^/]+$/);
  await expect(page.getByRole("button", { name: "تسجيل دفعة" })).toBeVisible();
}

export async function fillPassword(page: Page, password: string): Promise<void> {
  const field = page.getByLabel(PASSWORD_LABEL, { exact: true });
  await field.fill(password);
  await field.press("Enter");
}

export async function enterTenantCode(page: Page, code: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "رمز المنشأة" });
  await field.waitFor({ state: "visible" });
  if ((await field.inputValue()) !== code) {
    await field.fill(code);
    await field.blur();
  }
  await expect(page.getByRole("button", { name: "تغيير المنشأة" })).toBeVisible();
}

export async function enterCredentials(page: Page, email: string, password: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "البريد الإلكتروني" });
  if (!(await field.isVisible())) await page.getByRole("button", { name: "آخر", exact: true }).click();
  await field.fill(email);
  await fillPassword(page, password);
}

export async function tenantSignIn(page: Page, tenant: TenantLogin, baseUrl = ""): Promise<void> {
  await page.goto(`${baseUrl}/`);
  await enterTenantCode(page, tenant.code);
  await enterCredentials(page, tenant.adminEmail, tenant.adminPassword);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
}

export interface StoredSession {
  readonly token: string;
  readonly tenantName: string;
}

export async function storedSession(page: Page): Promise<StoredSession | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { token: string; tenantName: string }) : null;
  }, StorageKey.Session);
}

// The browser holds its session only in HttpOnly cookies; this signs it out
// on the server through the page's own cookie jar, as the app itself does.
export async function serverSignOut(page: Page, tenantCode: string): Promise<number> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "mezan_csrf")?.value ?? "";
  const response = await page.request.post("/api/auth/logout", { headers: { "x-mezan-tenant": tenantCode, "x-mezan-csrf": decodeURIComponent(csrf) } });
  return response.status();
}

export async function addCustomer(page: Page, name: string, baseUrl = ""): Promise<number> {
  await page.goto(`${baseUrl}/sell/customers`);
  await page.getByRole("button", { name: "إضافة عميل" }).first().click();
  const dialog = page.getByRole("dialog", { name: "إضافة عميل" });
  await dialog.getByLabel("اسم العميل").fill(name);
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/customers" && r.request().method() === HttpMethod.Post);
  await dialog.getByRole("button", { name: "إضافة عميل" }).click();
  return (await answered).status();
}

export async function tenantSignOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByLabel(PASSWORD_LABEL, { exact: true })).toBeVisible();
}

const platformDevices = new Map<string, string>();

export async function platformToken(request: APIRequestContext, apiUrl = SAAS_API_URL): Promise<string> {
  const response = await request.post(`${apiUrl}/api/platform/auth/login`, {
    data: { email: PLATFORM_OWNER_EMAIL, password: PLATFORM_OWNER_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const { token, deviceSecret } = (await response.json()) as { token: string; deviceSecret: string };
  platformDevices.set(token, deviceSecret);
  return token;
}

export function bearer(token: string): Record<string, string> {
  const device = platformDevices.get(token);
  return { authorization: `Bearer ${token}`, ...(device ? { "x-mezan-device": device } : {}) };
}

export async function provisionTenant(
  request: APIRequestContext,
  input: NewTenantInput,
  apiUrl = SAAS_API_URL,
): Promise<TenantLogin> {
  const token = await platformToken(request, apiUrl);
  const response = await request.post(`${apiUrl}/api/platform/tenants`, {
    headers: { ...bearer(token) },
    data: {
      code: input.code,
      nameAr: input.nameAr,
      ownerNameAr: input.ownerNameAr,
      ownerEmail: `owner@${input.code}.example`,
      planId: input.planId,
      billingCycle: BillingCycle.Monthly,
      trial: input.trial,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { tenant: { id: string }; adminEmail: string; adminPassword: string };
  return { id: body.tenant.id, code: input.code, adminEmail: body.adminEmail, adminPassword: body.adminPassword };
}

export async function tenantApiLogin(
  request: APIRequestContext,
  tenant: TenantLogin,
  apiUrl = SAAS_API_URL,
): Promise<TenantApi> {
  const response = await request.post(`${apiUrl}/api/auth/login`, {
    headers: { [TENANT_HEADER]: tenant.code },
    data: { username: tenant.adminEmail, password: tenant.adminPassword },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { code: tenant.code, token: ((await response.json()) as { token: string }).token };
}

export interface ApiAnswer {
  readonly status: number;
  readonly body: unknown;
}

export async function tenantCall(
  request: APIRequestContext,
  api: TenantApi,
  method: HttpMethod,
  path: string,
  data?: unknown,
  apiUrl = SAAS_API_URL,
  extraHeaders: Record<string, string> = {},
): Promise<ApiAnswer> {
  const response = await request.fetch(`${apiUrl}/api${path}`, {
    method,
    headers: { ...bearer(api.token), [TENANT_HEADER]: api.code, ...extraHeaders },
    data,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status(), body };
}

export function rowsOf(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const items = (body as { items?: unknown; rows?: unknown } | null)?.items ?? (body as { rows?: unknown } | null)?.rows;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

export interface InvoiceDrafts {
  readonly itemName: string;
  readonly customerName: string;
  draft(sequence: number): Record<string, unknown>;
}

export interface InvoiceDraftsInput {
  readonly customerId: string;
  readonly customerName: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly today: string;
}

/** Service lines only: a stock line would need a funded warehouse before it could be saved. */
export async function invoiceDrafts(request: APIRequestContext, api: TenantApi, input: InvoiceDraftsInput, apiUrl = SAAS_API_URL): Promise<InvoiceDrafts> {
  const item = await tenantCall(
    request,
    api,
    HttpMethod.Post,
    "/items",
    { id: input.itemId, code: input.itemId, nameAr: input.itemName, type: ItemType.Service, baseUnitCode: "PCS", trackInventory: false, salePrice: "100" },
    apiUrl,
  );
  expect(item.status, JSON.stringify(item.body)).toBe(201);
  const branchId = String(rowsOf((await tenantCall(request, api, HttpMethod.Get, "/branches", undefined, apiUrl)).body)[0]?.["id"]);
  const warehouseId = String(rowsOf((await tenantCall(request, api, HttpMethod.Get, "/warehouses", undefined, apiUrl)).body)[0]?.["id"]);
  const accounts = rowsOf((await tenantCall(request, api, HttpMethod.Get, "/accounts?pageSize=500", undefined, apiUrl)).body);
  const accountId = (code: string): string => String(accounts.find((account) => account["code"] === code)?.["id"] ?? "");
  return {
    itemName: input.itemName,
    customerName: input.customerName,
    draft: (sequence) => ({
      date: input.today,
      dueDate: input.today,
      customerId: input.customerId,
      customerNameAr: input.customerName,
      customerTaxExempt: false,
      warehouseId,
      branchId,
      currency: Currency.Egp,
      discount: { type: DiscountType.Percent, percent: 0 },
      arAccountId: accountId("1105") || accountId("1200"),
      taxAccountId: accountId("2200"),
      lines: [
        {
          lineId: `L${sequence}`,
          itemId: input.itemId,
          itemNameAr: input.itemName,
          isStock: false,
          qty: "1",
          unitPrice: "100",
          discountType: DiscountType.Percent,
          discountPercent: 0,
          taxRatePercent: 0,
          revenueAccountId: accountId("4100"),
        },
      ],
    }),
  };
}

export async function pickEntity(page: Page, label: string, query: string): Promise<void> {
  const input = page.getByLabel(label);
  await input.click();
  await input.fill(query);
  await page.getByRole("button", { name: query }).first().click();
}

export function errorOf(answer: ApiAnswer): { error?: string; message?: string } {
  return (answer.body ?? {}) as { error?: string; message?: string };
}

export interface Refusal {
  readonly status: number;
  readonly error: ApiError;
  readonly path: RegExp;
}

export interface PageWatch {
  readonly problems: string[];
  readonly refusals: string[];
  settled(): Promise<void>;
}

export function watchPage(page: Page, allowed: readonly Refusal[] = []): PageWatch {
  const problems: string[] = [];
  const refusals: string[] = [];
  const pending = new Set<Promise<void>>();
  page.on("pageerror", (error) => problems.push(`pageerror ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Failed to load resource/.test(message.text())) return;
    // The test runner's own scripts are refused by a fully sandboxed srcdoc frame (an e-mail preview);
    // the frame runs nothing of the app's, so the refusal says nothing about the screen.
    if (message.location().url === SANDBOXED_PREVIEW && SANDBOX_REFUSAL.test(message.text())) return;
    problems.push(`console ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const read = (async () => {
      const pathname = new URL(response.url()).pathname;
      let error = "";
      try {
        error = ((await response.json()) as { error?: string }).error ?? "";
      } catch {
        error = "";
      }
      const label = `${response.status()} ${response.request().method()} ${pathname} ${error}`.trim();
      const intended = allowed.some((a) => a.status === response.status() && a.error === error && a.path.test(pathname));
      (intended ? refusals : problems).push(label);
    })();
    pending.add(read);
    void read.finally(() => pending.delete(read));
  });
  return {
    problems,
    refusals,
    async settled() {
      await page.waitForLoadState("networkidle");
      await Promise.all([...pending]);
    },
  };
}

export async function setLook(context: BrowserContext, locale: Locale, theme: Theme): Promise<void> {
  await context.addInitScript(
    ([localeKey, localeValue, themeKey, themeValue]) => {
      window.localStorage.setItem(localeKey as string, localeValue as string);
      window.localStorage.setItem(themeKey as string, themeValue as string);
    },
    [StorageKey.Locale, locale, StorageKey.Theme, theme],
  );
}

export interface ScreenCheck {
  readonly name: string;
  readonly locale: Locale;
  readonly watch: PageWatch;
}

// A <code> element declares its text a machine literal — an API scope, an environment variable, a
// code an administrator typed — which is the one place an identifier is the content, not a leak.
async function textOutsideCode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const literals = [...document.querySelectorAll<HTMLElement>("code")];
    const before = literals.map((element) => element.style.getPropertyValue("display"));
    literals.forEach((element) => element.style.setProperty("display", "none"));
    const text = document.body.innerText;
    literals.forEach((element, index) => element.style.setProperty("display", before[index] ?? ""));
    return text;
  });
}

export async function expectHealthyScreen(page: Page, check: ScreenCheck): Promise<void> {
  await check.watch.settled();
  const headings = (await page.locator("h1").allInnerTexts()).map((text) => text.trim());
  expect.soft(headings.filter((text) => text !== ""), `${check.name}: exactly one non-empty h1`).toHaveLength(1);
  expect.soft(headings, `${check.name}: no empty h1`).not.toContain("");
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
  expect.soft(overflow, `${check.name}: no horizontal page scroll`).toBeLessThanOrEqual(OVERFLOW_TOLERANCE);
  if (check.locale === Locale.Arabic) {
    const text = await textOutsideCode(page);
    expect.soft(text.match(RAW_ENUM)?.[0] ?? null, `${check.name}: no raw enum text in Arabic`).toBeNull();
  }
  mkdirSync(WALK_DIR, { recursive: true });
  await page.screenshot({ path: `${WALK_DIR}/${check.name}.png` });
  expect.soft(check.watch.problems, `${check.name}: no console errors or unexpected 4xx/5xx`).toEqual([]);
}
