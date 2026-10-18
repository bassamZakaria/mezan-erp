import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Entitlements } from "@mezan/domain";
import { test, expect, directApi } from "./support/test";
import {
  ApiError,
  CodePrefix,
  DEMO_API_URL,
  DEMO_PLATFORM_DIR_ENV,
  DEMO_TENANT,
  DEMO_WEB_URL,
  HttpMethod,
  Locale,
  PlanCode,
  PlanId,
  StorageKey,
  Theme,
  VIEWPORT_SIZE,
  Viewport,
  uniqueCode,
} from "./support/env";
import { screenRouteEntries } from "../../apps/web/src/routing";
import { isScreenInThisEdition, moduleOutsideLicence } from "../../apps/web/src/nav-config";
import { webCatalogs, type WebTranslationKey } from "../../apps/web/src/i18n/catalog";
import { enhScreens } from "../../apps/web/src/screens/enh/nav";
import {
  enterTenantCode,
  expectHealthyScreen,
  platformSignIn,
  provisionTenant,
  rowsOf,
  setLook,
  tenantApiLogin,
  tenantCall,
  tenantSignIn,
  watchPage,
  type Refusal,
  type TenantLogin,
} from "./support/saas";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

enum Door {
  Public = "public",
  Platform = "platform",
  Tenant = "tenant",
}

interface Screen {
  readonly name: string;
  readonly door: Door;
  readonly path: () => string;
  readonly refusals?: readonly Refusal[];
}

interface Look {
  readonly locale: Locale;
  readonly theme: Theme;
  readonly viewport: Viewport;
}

const TENANT_SCOPED_BEFORE_SIGN_IN: readonly string[] = ["/api/bootstrap/status", "/api/entitlements"];
const HR_NOT_LICENSED: Refusal = { status: 403, error: ApiError.ModuleNotLicensed, path: /^\/api\/hr\// };

const LOOKS: readonly Look[] = [Viewport.Desktop, Viewport.Phone].flatMap((viewport) =>
  [Locale.Arabic, Locale.English].flatMap((locale) => [Theme.Light, Theme.Dark].map((theme) => ({ locale, theme, viewport }))),
);

let tenant: TenantLogin;
let tenantState: StorageState;
let platformState: StorageState;

const SCREENS: readonly Screen[] = [
  { name: "platform-login", door: Door.Public, path: () => "/platform/login" },
  { name: "signup", door: Door.Public, path: () => "/signup" },
  { name: "tenant-login", door: Door.Public, path: () => "/" },
  { name: "platform-tenants", door: Door.Platform, path: () => "/platform/tenants" },
  { name: "platform-tenant-detail", door: Door.Platform, path: () => `/platform/tenants/${tenant.id}` },
  { name: "platform-plans", door: Door.Platform, path: () => "/platform/plans" },
  { name: "platform-plan-editor", door: Door.Platform, path: () => `/platform/plans/${PlanId.Business}` },
  { name: "platform-operators", door: Door.Platform, path: () => "/platform/users" },
  { name: "platform-security", door: Door.Platform, path: () => "/platform/security" },
  { name: "platform-operations", door: Door.Platform, path: () => "/platform/operations" },
  { name: "tenant-dashboard", door: Door.Tenant, path: () => "/dashboard" },
  { name: "tenant-billing", door: Door.Tenant, path: () => "/setup/settings-billing" },
  { name: "tenant-customers", door: Door.Tenant, path: () => "/sell/customers" },
  { name: "tenant-unlicensed-module", door: Door.Tenant, path: () => "/people/employees", refusals: [HR_NOT_LICENSED] },
];

async function contextFor(browser: Browser, door: Door, look: Look): Promise<BrowserContext> {
  const storageState = door === Door.Platform ? platformState : door === Door.Tenant ? tenantState : undefined;
  const context = await browser.newContext({ viewport: VIEWPORT_SIZE[look.viewport], storageState });
  await setLook(context, look.locale, look.theme);
  return context;
}

test.describe("Every SaaS screen — both locales, both themes, desktop and 390px", () => {
  test.beforeAll(async ({ browser, playwright }) => {
    const request = await directApi(playwright);
    tenant = await provisionTenant(request, { code: uniqueCode(CodePrefix.Walk), nameAr: "شركة الجولة", ownerNameAr: "جميلة الجولة", planId: PlanId.Business, trial: true });
    const api = await tenantApiLogin(request, tenant);
    const customer = await tenantCall(request, api, HttpMethod.Post, "/customers", { id: "CUST-WALK", code: "CW1", nameAr: "عميل الجولة" });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    await request.dispose();

    const tenantContext = await browser.newContext();
    await tenantSignIn(await tenantContext.newPage(), tenant);
    tenantState = await tenantContext.storageState();
    await tenantContext.close();

    const platformContext = await browser.newContext();
    await platformSignIn(await platformContext.newPage());
    platformState = await platformContext.storageState();
    await platformContext.close();
  });

  for (const look of LOOKS) {
    const label = `${look.locale}-${look.theme}-${look.viewport}`;
    test(`${label}: every screen has one h1, no errors, no page scroll, no raw enum`, async ({ browser }) => {
      test.setTimeout(180_000);
      for (const screen of SCREENS) {
        await test.step(screen.name, async () => {
          const context = await contextFor(browser, screen.door, look);
          const page = await context.newPage();
          const watch = watchPage(page, screen.refusals ?? []);
          await page.goto(screen.path());
          await expect(page.locator("h1").first()).toBeVisible();
          await expect.soft(page.locator("html"), `${screen.name}: text direction follows the locale`).toHaveAttribute("dir", look.locale === Locale.Arabic ? "rtl" : "ltr");
          await expect.soft(page.locator("html"), `${screen.name}: theme applies`).toHaveAttribute("data-theme", look.theme);
          await expectHealthyScreen(page, { name: `${label}-${screen.name}`, locale: look.locale, watch });
          await context.close();
        });
      }
    });
  }

  test("the platform console fits a 390px phone: the rail becomes a top bar, every page keeps to the viewport and its controls stay reachable [guards D-SAAS-12]", async ({ browser }) => {
    const look: Look = { locale: Locale.Arabic, theme: Theme.Light, viewport: Viewport.Phone };
    const width = VIEWPORT_SIZE[Viewport.Phone].width;
    for (const screen of SCREENS.filter((candidate) => candidate.door === Door.Platform)) {
      await test.step(screen.name, async () => {
        const context = await contextFor(browser, screen.door, look);
        const page = await context.newPage();
        const watch = watchPage(page);
        await page.goto(screen.path());
        await expect(page.locator("h1").first()).toBeVisible();
        await expectHealthyScreen(page, { name: `phone-console-${screen.name}`, locale: look.locale, watch });

        const rail = page.getByRole("navigation", { name: "منصة Mezan" });
        const railBox = await rail.boundingBox();
        const mainBox = await page.locator("main").boundingBox();
        expect(railBox?.width, `${screen.name}: the rail spans the viewport`).toBe(width);
        expect(mainBox?.width, `${screen.name}: the page spans the viewport`).toBe(width);
        expect(mainBox?.y ?? 0, `${screen.name}: the page sits under the bar`).toBeGreaterThanOrEqual((railBox?.y ?? 0) + (railBox?.height ?? 0));
        for (const label of ["المنشآت", "الباقات", "المشغّلون"]) {
          await expect(rail.getByRole("link", { name: label, exact: true })).toBeInViewport();
        }
        await expect(rail.getByRole("button", { name: "تسجيل الخروج" })).toBeInViewport();
        await context.close();
      });
    }

    const context = await contextFor(browser, Door.Platform, look);
    const page = await context.newPage();
    await page.goto("/platform/tenants");
    const card = page.getByRole("listitem").filter({ hasText: tenant.code });
    await expect(card).toBeVisible();
    await expect(page.getByRole("table"), "a phone gets cards, not a table to scroll sideways").toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText("نشطة", { exact: true }), "the status is in view without scrolling sideways").toBeInViewport({ ratio: 1 });
    await expect(card.getByRole("link", { name: /^عرض / }), "and so is the action that opens the tenant").toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the page itself does not scroll sideways").toBe(true);
    await page.getByRole("navigation", { name: "منصة Mezan" }).getByRole("link", { name: "الباقات", exact: true }).click();
    await expect(page).toHaveURL(/\/platform\/plans$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/platform/tenants");
    await page.getByRole("listitem").filter({ hasText: tenant.code }).getByRole("link", { name: /^عرض / }).click();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${tenant.id}$`));
    await context.close();
  });

  test("a tenant without HR makes no HR request from the shell [guards D-SAAS-03]", async ({ browser }) => {
    const context = await contextFor(browser, Door.Tenant, { locale: Locale.Arabic, theme: Theme.Light, viewport: Viewport.Desktop });
    const page = await context.newPage();
    const watch = watchPage(page);
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.goto("/sell/customers");
    await expect(page.getByRole("cell", { name: "عميل الجولة" }).first()).toBeVisible();
    await watch.settled();
    expect(requested).toContain("/api/entitlements");
    expect(requested.filter((pathname) => pathname.startsWith("/api/hr/"))).toEqual([]);
    expect(watch.problems).toEqual([]);
    await context.close();
  });

  test("the dashboard asks only for what the plan includes [guards D-SAAS-04]", async ({ browser }) => {
    const context = await contextFor(browser, Door.Tenant, { locale: Locale.Arabic, theme: Theme.Light, viewport: Viewport.Desktop });
    const page = await context.newPage();
    const watch = watchPage(page);
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("جميلة");
    await watch.settled();
    expect(requested).toContain("/api/dashboard/summary");
    expect(requested.filter((pathname) => pathname.startsWith("/api/contracting/"))).toEqual([]);
    expect(watch.problems).toEqual([]);
    await context.close();
  });

  test("the sign-in screen asks the server nothing tenant-scoped before a company is known, and asks once the code is confirmed [guards D-SAAS-06]", async ({ browser }) => {
    const context = await contextFor(browser, Door.Public, { locale: Locale.Arabic, theme: Theme.Light, viewport: Viewport.Desktop });
    const page = await context.newPage();
    const watch = watchPage(page);
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "رمز المنشأة" })).toBeVisible();
    await watch.settled();
    expect(requested).toContain("/api/platform/resolve");
    expect(requested.filter((pathname) => TENANT_SCOPED_BEFORE_SIGN_IN.includes(pathname))).toEqual([]);
    expect(watch.problems).toEqual([]);

    const status = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/bootstrap/status");
    await enterTenantCode(page, tenant.code);
    expect((await status).status()).toBe(200);
    await watch.settled();
    expect(requested).toContain("/api/entitlements");
    expect(watch.problems).toEqual([]);
    await context.close();
  });
});

interface TenantScreen {
  readonly name: string;
  readonly key: string;
  readonly path: () => string;
  readonly open?: (page: Page, look: Look) => Promise<void>;
  readonly checksEnglishCopy?: boolean;
}

// A dev server compiling a screen chunk for the first time, on a loaded machine, can hold the splash past the default.
const FIRST_PAINT_TIMEOUT_MS = 60_000;
const NOT_A_NAV_DESTINATION: readonly string[] = ["role-editor"];
const PAYABLE_RUN_STATUSES: readonly string[] = ["approved", "disbursed"];

function say(look: Look, key: WebTranslationKey): string {
  return webCatalogs[look.locale][key] ?? key;
}

function openTab(key: WebTranslationKey): (page: Page, look: Look) => Promise<void> {
  return async (page, look) => {
    const tab = page.getByRole("tab", { name: say(look, key), exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  };
}

let demoEntitlements: Entitlements;
let demoState: StorageState;
let payableRunId = "";
let reconciledTripNo = "";
let recordNames: ReadonlySet<string> = new Set();

const FEATURE_WAVE_SCREENS: ReadonlySet<string> = new Set(Object.keys(enhScreens));

const ROUTED_SCREENS: readonly TenantScreen[] = screenRouteEntries()
  .filter(([key]) => !NOT_A_NAV_DESTINATION.includes(key))
  .map(([key, route]) => ({ name: key, key, path: () => `/${route}`, checksEnglishCopy: FEATURE_WAVE_SCREENS.has(key) }));

const DEEP_SCREENS: readonly TenantScreen[] = [
  { name: "integrations-webhooks", key: "integrations", path: () => "/setup/integrations", open: openTab("integrations.tab.webhooks"), checksEnglishCopy: true },
  { name: "integrations-deliveries", key: "integrations", path: () => "/setup/integrations", open: openTab("integrations.tab.deliveries"), checksEnglishCopy: true },
  { name: "integrations-docs", key: "integrations", path: () => "/setup/integrations", open: openTab("integrations.tab.docs"), checksEnglishCopy: true },
  { name: "payroll-run-bank-file", key: "payroll", path: () => `/people/payroll/${encodeURIComponent(payableRunId)}`, open: openTab("hrPages.run.tabBankFile"), checksEnglishCopy: true },
  {
    name: "van-trip-reconciliation",
    key: "van-trips",
    checksEnglishCopy: true,
    path: () => `/sell/van-trips?q=${encodeURIComponent(reconciledTripNo)}`,
    open: async (page) => {
      await page.locator("main tbody tr").filter({ hasText: reconciledTripNo }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  { name: "glance-standalone", key: "glance", path: () => "/glance", checksEnglishCopy: true },
];

const TENANT_SCREENS: readonly TenantScreen[] = [...ROUTED_SCREENS, ...DEEP_SCREENS];

const ARABIC = /[\u0600-\u06FF]/;
const PLACEHOLDER = /\{[a-zA-Z]+\}/;
const LONG_UI_STRING = 15;
const ARABIC_UI_STRINGS: readonly string[] = Object.entries(webCatalogs[Locale.Arabic])
  .filter(([key, value]) => ARABIC.test(value) && webCatalogs[Locale.English][key as WebTranslationKey] !== value && !PLACEHOLDER.test(value))
  .map(([, value]) => value.trim());
const ARABIC_UI_LINES: ReadonlySet<string> = new Set(ARABIC_UI_STRINGS);
const LONG_ARABIC_UI_STRINGS: readonly string[] = ARABIC_UI_STRINGS.filter((value) => value.length >= LONG_UI_STRING);

/** A line the catalogue ships as interface copy, as opposed to a record's own Arabic name. */
function isArabicUiString(line: string): boolean {
  const cells = line.split("\t").map((cell) => cell.replace(/ total$/, "").trim());
  return cells.some((cell) => ARABIC.test(cell) && !recordNames.has(cell) && (ARABIC_UI_LINES.has(cell) || LONG_ARABIC_UI_STRINGS.some((value) => cell.includes(value))));
}

// The look is written into the stored origin rather than by an init script: an init script is injected
// into every frame, and a fully sandboxed srcdoc preview refuses it with a console error of its own.
function withLook(state: StorageState, look: Look): StorageState {
  const origin = new URL(DEMO_WEB_URL).origin;
  const chosen = [
    { name: StorageKey.Locale, value: look.locale },
    { name: StorageKey.Theme, value: look.theme },
  ];
  const origins = state.origins.some((entry) => entry.origin === origin) ? state.origins : [...state.origins, { origin, localStorage: [] }];
  return {
    ...state,
    origins: origins.map((entry) =>
      entry.origin === origin ? { ...entry, localStorage: [...entry.localStorage.filter((item) => !chosen.some((c) => c.name === item.name)), ...chosen] } : entry,
    ),
  };
}

function offered(key: string): boolean {
  return moduleOutsideLicence(key, demoEntitlements) === null && isScreenInThisEdition(key, demoEntitlements);
}

function demoStateFile(): string {
  return path.join(process.env[DEMO_PLATFORM_DIR_ENV] ?? "", "screen-walk-state.json");
}

test.describe("Every tenant-app screen the nav reaches — the seeded Enterprise demo tenant, both locales, both themes, desktop and 390px", () => {
  test.beforeAll(async ({ browser, playwright }) => {
    const request = await directApi(playwright);
    const demo = { id: "", ...DEMO_TENANT };
    const api = await tenantApiLogin(request, demo, DEMO_API_URL);
    demoEntitlements = (await tenantCall(request, api, HttpMethod.Get, "/entitlements", undefined, DEMO_API_URL)).body as Entitlements;
    expect(demoEntitlements.plan, "the walk runs on the Enterprise plan").toBe(PlanCode.Enterprise);
    const runs = rowsOf((await tenantCall(request, api, HttpMethod.Get, "/hr/payroll/runs", undefined, DEMO_API_URL)).body);
    payableRunId = String(runs.find((run) => PAYABLE_RUN_STATUSES.includes(String(run["status"])))?.["id"] ?? "");
    const trips = rowsOf((await tenantCall(request, api, HttpMethod.Get, "/field/van-trips", undefined, DEMO_API_URL)).body);
    reconciledTripNo = String(trips.find((trip) => trip["settlement"] !== null && trip["tripNo"])?.["tripNo"] ?? "");
    const named = await Promise.all(
      ["/branches", "/warehouses", "/crm/pipeline-stages"].map(async (route) => rowsOf((await tenantCall(request, api, HttpMethod.Get, route, undefined, DEMO_API_URL)).body)),
    );
    recordNames = new Set(named.flat().flatMap((record) => [record["name"], record["nameAr"]]).filter((name): name is string => typeof name === "string"));
    await request.dispose();
    expect(payableRunId, "the seed holds a payroll run that can be paid").not.toBe("");
    expect(reconciledTripNo, "the seed holds a counted van trip").not.toBe("");

    const stateFile = demoStateFile();
    if (existsSync(stateFile)) {
      demoState = JSON.parse(readFileSync(stateFile, "utf8")) as StorageState;
      return;
    }
    const context = await browser.newContext();
    await setLook(context, Locale.Arabic, Theme.Light);
    const page = await context.newPage();
    await tenantSignIn(page, demo, DEMO_WEB_URL);
    demoState = await context.storageState();
    writeFileSync(stateFile, JSON.stringify(demoState));
    await context.close();
  });

  for (const look of LOOKS) {
    const label = `${look.locale}-${look.theme}-${look.viewport}`;
    for (const screen of TENANT_SCREENS) {
      test(`${label} · ${screen.name}`, async ({ browser }) => {
        test.skip(!offered(screen.key), `${screen.key} is outside this tenant's licence or edition`);
        const context = await browser.newContext({ viewport: VIEWPORT_SIZE[look.viewport], storageState: withLook(demoState, look) });
        const page = await context.newPage();
        const watch = watchPage(page);
        await page.goto(`${DEMO_WEB_URL}${screen.path()}`);
        await expect(page.locator("h1").first()).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT_MS });
        await screen.open?.(page, look);
        await expect.soft(page.locator("html"), `${screen.name}: text direction follows the locale`).toHaveAttribute("dir", look.locale === Locale.Arabic ? "rtl" : "ltr");
        await expect.soft(page.locator("html"), `${screen.name}: theme applies`).toHaveAttribute("data-theme", look.theme);
        await expectHealthyScreen(page, { name: `tenant-${label}-${screen.name}`, locale: look.locale, watch });
        if (look.locale === Locale.English && screen.checksEnglishCopy) {
          const lines = (await page.locator("body").innerText()).split("\n").map((line) => line.trim());
          expect.soft(lines.filter(isArabicUiString), `${screen.name}: no Arabic interface text in English`).toEqual([]);
        }
        await context.close();
      });
    }
  }
});
