import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { ApiError, CodePrefix, HttpMethod, Locale, PlanId, Theme, VIEWPORT_SIZE, Viewport, uniqueCode } from "./support/env";
import {
  enterTenantCode,
  expectHealthyScreen,
  platformSignIn,
  provisionTenant,
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
    const request = await playwright.request.newContext();
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
    const list = await page.getByRole("table").evaluate((table) => {
      let box = table.parentElement;
      while (box && !["auto", "scroll"].includes(getComputedStyle(box).overflowX)) box = box.parentElement;
      if (!box) return null;
      const before = box.scrollLeft;
      box.scrollLeft = before - 80;
      return { hidden: box.scrollWidth - box.clientWidth, moved: Math.abs(box.scrollLeft - before) };
    });
    expect(list, "the tenants list sits in a container that scrolls sideways").not.toBeNull();
    expect(list?.hidden ?? 0, "the list is wider than the phone").toBeGreaterThan(0);
    expect(list?.moved ?? 0, "and its own container scrolls to the rest").toBeGreaterThan(0);
    await page.getByRole("navigation", { name: "منصة Mezan" }).getByRole("link", { name: "الباقات", exact: true }).click();
    await expect(page).toHaveURL(/\/platform\/plans$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/platform/tenants");
    await page.getByRole("row").filter({ hasText: tenant.code }).getByRole("button", { name: "عرض" }).click();
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
