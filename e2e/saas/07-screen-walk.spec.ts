import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { ApiError, CodePrefix, HttpMethod, Locale, PlanId, Theme, VIEWPORT_SIZE, Viewport, uniqueCode } from "./support/env";
import {
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

const HR_NOT_LICENSED: Refusal = { status: 403, error: ApiError.ModuleNotLicensed, path: /^\/api\/hr\// };
const PRE_TENANT_LOOKUPS: Refusal = { status: 400, error: ApiError.TenantRequired, path: /^\/api\/(bootstrap\/status|entitlements)$/ };

const LOOKS: readonly Look[] = [Viewport.Desktop, Viewport.Phone].flatMap((viewport) =>
  [Locale.Arabic, Locale.English].flatMap((locale) => [Theme.Light, Theme.Dark].map((theme) => ({ locale, theme, viewport }))),
);

let tenant: TenantLogin;
let tenantState: StorageState;
let platformState: StorageState;

const SCREENS: readonly Screen[] = [
  { name: "platform-login", door: Door.Public, path: () => "/platform/login" },
  { name: "signup", door: Door.Public, path: () => "/signup" },
  { name: "tenant-login", door: Door.Public, path: () => "/", refusals: [PRE_TENANT_LOOKUPS] },
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

function fitsViewport(screen: Screen, viewport: Viewport): boolean {
  return viewport === Viewport.Desktop || screen.door !== Door.Platform;
}

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
      for (const screen of SCREENS.filter((candidate) => fitsViewport(candidate, look.viewport))) {
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

  test.fixme(
    "the platform console fits a 390px phone [D-SAAS-12: PlatformShell.tsx keeps a fixed 220px rail beside the page at every width and its tables do not scroll inside a container, so at 390px the tenants, tenant detail, plans, plan editor and operators pages scroll sideways by 109-701px]",
    async ({ browser }) => {
      const look: Look = { locale: Locale.Arabic, theme: Theme.Light, viewport: Viewport.Phone };
      for (const screen of SCREENS.filter((candidate) => candidate.door === Door.Platform)) {
        const context = await contextFor(browser, screen.door, look);
        const page = await context.newPage();
        const watch = watchPage(page);
        await page.goto(screen.path());
        await expect(page.locator("h1").first()).toBeVisible();
        await expectHealthyScreen(page, { name: `defect-D-SAAS-12-${screen.name}`, locale: look.locale, watch });
        await context.close();
      }
    },
  );

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

  test.fixme(
    "the sign-in screen asks the server nothing tenant-scoped before a company is known [D-SAAS-06: on a device with no company code, the app requests /api/bootstrap/status and /api/entitlements with no x-mezan-tenant header and gets two 400 TENANT_REQUIRED answers and two console errors on first paint]",
    async ({ browser }) => {
      const context = await contextFor(browser, Door.Public, { locale: Locale.Arabic, theme: Theme.Light, viewport: Viewport.Desktop });
      const page = await context.newPage();
      const watch = watchPage(page);
      await page.goto("/");
      await watch.settled();
      expect(watch.problems).toEqual([]);
      await context.close();
    },
  );
});
