// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { LicenseStateCode, SubscriptionStatusCode, TenantBooksStanding, TenantWireStatus, type PlanDTO, type TenantSummaryDTO } from "@mezan/contracts";
import type { Transport } from "../data/transport";
import { NARROW_TENANT_LIST_QUERY, TenantsPage } from "./TenantsPage";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";
import type { PlatformSession } from "./session";

const plan: PlanDTO = {
  id: "plan-1",
  code: "growth",
  nameAr: "باقة النمو",
  nameEn: "Growth",
  modules: ["sales"],
  features: {},
  kind: "paid",
  quotas: {},
  seatsIncluded: 5,
  branchesIncluded: 1,
  warehousesIncluded: 1,
  priceMonthly: "500.00",
  priceYearly: "5000.00",
  trialDays: 14,
  isPublic: true,
  sortOrder: 1,
  status: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const tenantSummary: TenantSummaryDTO = {
  tenant: {
    id: "tenant-1",
    code: "acme",
    nameAr: "شركة أكمي",
    nameEn: "Acme Co",
    ownerEmail: "owner@acme.test",
    status: TenantWireStatus.Active,
    ownerContactVerified: true,
    ownerNeeded: false,
    pendingOwner: null,
    dbFile: "tenants/acme.db",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  subscription: {
    id: "sub-1",
    tenantId: "tenant-1",
    planId: "plan-1",
    status: SubscriptionStatusCode.Active,
    billingCycle: "monthly",
    addOnModules: [],
    extraSeats: 0,
    extraBranches: 0,
    extraWarehouses: 0,
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    billingAnchorDay: 1,
    billingAnchorNeedsReview: false,
    trialEndsAt: null,
    graceDays: 5,
    cancelledAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  plan,
  licenseState: { state: LicenseStateCode.Active, canWrite: true, usable: true },
  entitlements: null,
  payments: [],
  books: TenantBooksStanding.Bound,
  handOverMailConfigured: true,
};

const supportSession: PlatformSession = {
  token: "SUPPORT-TOKEN",
  user: { id: "PU-2", email: "support@mezan.example", role: "support" },
};

function baseHandlers() {
  return {
    "GET /tenants": () => ({ body: [tenantSummary] }),
    "GET /plans": () => ({ body: [plan] }),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

describe("TenantsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom ships no Clipboard API; the result panel's copy button only
    // renders when one is there to use (mirrors ConnectedDevicesPanel).
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("lists a tenant's code, name, plan, status chip, licence chip and period end", async () => {
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport(baseHandlers()),
      initialSession: testPlatformSession,
    });

    expect(await screen.findByText("acme")).toBeInTheDocument();
    expect(screen.getByText("شركة أكمي")).toBeInTheDocument();
    expect(screen.getByText("باقة النمو")).toBeInTheDocument();
    expect(screen.getByText("نشطة")).toBeInTheDocument();
    expect(screen.getByText("الترخيص نشط")).toBeInTheDocument();
    expect(screen.getByText("01/10/2026")).toBeInTheDocument();
  });

  it("marks the one row whose stored subscription status is not recognised as needing review, beside a normal row", async () => {
    const odd: TenantSummaryDTO = {
      ...tenantSummary,
      tenant: { ...tenantSummary.tenant, id: "tenant-2", code: "oddone", nameAr: "منشأة غريبة" },
      subscription: tenantSummary.subscription && { ...tenantSummary.subscription, id: "sub-2", tenantId: "tenant-2", status: SubscriptionStatusCode.Unknown },
    };
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [tenantSummary, odd] }) }),
      initialSession: testPlatformSession,
    });

    const oddRow = (await screen.findByText("oddone")).closest("tr");
    expect(oddRow).toHaveTextContent("غير معروفة — تحتاج مراجعة");
    expect(screen.getByText("acme").closest("tr")).toHaveTextContent("الترخيص نشط");
    expect(screen.getByText("acme").closest("tr")).not.toHaveTextContent("غير معروفة");
  });

  describe("on a phone-width screen", () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === NARROW_TENANT_LIST_QUERY,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it("marks on its own card a tenant with no owner on record and one whose hand-over awaits confirmation, and no other", async () => {
      const ownerless: TenantSummaryDTO = { ...tenantSummary, tenant: { ...tenantSummary.tenant, id: "tenant-2", code: "ownerless", ownerNeeded: true } };
      const waiting: TenantSummaryDTO = {
        ...tenantSummary,
        tenant: { ...tenantSummary.tenant, id: "tenant-3", code: "waiting", pendingOwner: { userId: "U-2", email: "second@acme.test", requestedAt: "2026-10-01T09:00:00.000Z", expiresAt: "2026-10-08T09:00:00.000Z", linkMailed: true } },
      };
      renderWithPlatformProviders(<TenantsPage />, {
        transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [tenantSummary, ownerless, waiting] }) }),
        initialSession: testPlatformSession,
      });

      const cardOf = async (code: string) => (await screen.findByText(code)).closest("li") as HTMLElement;
      expect(within(await cardOf("ownerless")).getByText("المنشأة بلا مالك محدَّد")).toBeInTheDocument();
      expect(within(await cardOf("waiting")).getByText("نقل ملكية بانتظار التأكيد")).toBeInTheDocument();
      expect(screen.getAllByText("المنشأة بلا مالك محدَّد")).toHaveLength(1);
      expect(screen.getAllByText("نقل ملكية بانتظار التأكيد")).toHaveLength(1);
    });

    it("lists each tenant as a card that carries its status, licence and its own «عرض» action, with no table to scroll sideways", async () => {
      const unverified: TenantSummaryDTO = {
        ...tenantSummary,
        tenant: { ...tenantSummary.tenant, id: "tenant-2", code: "renamed", nameAr: "منشأة ثانية", status: TenantWireStatus.Suspended, ownerContactVerified: false },
      };
      renderWithPlatformProviders(
        <>
          <TenantsPage />
          <LocationProbe />
        </>,
        { transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [tenantSummary, unverified] }) }), initialSession: testPlatformSession },
      );

      const first = (await screen.findByText("acme")).closest("li");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1, name: "المنشآت" })).toBeInTheDocument();
      expect(first).toHaveTextContent("شركة أكمي");
      expect(first).toHaveTextContent("نشطة");
      expect(first).toHaveTextContent("الترخيص نشط");
      expect(first).toHaveTextContent("باقة النمو");
      const second = screen.getByText("renamed").closest("li");
      expect(second).toHaveTextContent("موقوفة");
      expect(second).toHaveTextContent("بريد المالك غير مؤكَّد");
      expect(within(second as HTMLElement).getByRole("link", { name: "عرض منشأة ثانية" })).toHaveTextContent("عرض");

      fireEvent.click(within(first as HTMLElement).getByRole("link", { name: "عرض شركة أكمي" }));
      expect(screen.getByTestId("location")).toHaveTextContent("/platform/tenants/tenant-1");
    });

    it("says so when there is no tenant yet, and still offers the owner a new one", async () => {
      renderWithPlatformProviders(<TenantsPage />, {
        transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [] }) }),
        initialSession: testPlatformSession,
      });

      expect(await screen.findByText("لا توجد منشآت بعد.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "منشأة جديدة" })).toBeInTheDocument();
    });
  });

  it("marks the tenant whose billing day still needs the platform owner's review", async () => {
    const unsettled: TenantSummaryDTO = {
      ...tenantSummary,
      tenant: { ...tenantSummary.tenant, id: "tenant-2", code: "unsettled", nameAr: "منشأة قديمة" },
      subscription: tenantSummary.subscription && { ...tenantSummary.subscription, id: "sub-2", tenantId: "tenant-2", billingAnchorNeedsReview: true },
    };
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [tenantSummary, unsettled] }) }),
      initialSession: testPlatformSession,
    });

    expect((await screen.findByText("unsettled")).closest("tr")).toHaveTextContent("يوم الفوترة يحتاج مراجعة");
    expect(screen.getByText("acme").closest("tr")).not.toHaveTextContent("يوم الفوترة يحتاج مراجعة");
  });

  it("marks only the tenant whose owner address has not been confirmed by the owner", async () => {
    const unverified: TenantSummaryDTO = {
      ...tenantSummary,
      tenant: { ...tenantSummary.tenant, id: "tenant-2", code: "renamed", nameAr: "منشأة مُعاد تسميتها", ownerContactVerified: false },
    };
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [tenantSummary, unverified] }) }),
      initialSession: testPlatformSession,
    });

    expect((await screen.findByText("renamed")).closest("tr")).toHaveTextContent("بريد المالك غير مؤكَّد");
    expect(screen.getByText("acme").closest("tr")).not.toHaveTextContent("بريد المالك غير مؤكَّد");
  });

  it("marks a tenant on trial as «تجريبي» in the licence column, so an operator can tell it from a paying one (D-SAAS-09)", async () => {
    const trialing: TenantSummaryDTO = {
      ...tenantSummary,
      subscription: { ...tenantSummary.subscription!, status: SubscriptionStatusCode.Trialing, trialEndsAt: "2026-10-01T00:00:00.000Z" },
    };
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [trialing] }) }),
      initialSession: testPlatformSession,
    });

    const row = (await screen.findByText("acme")).closest("tr")!;
    expect(within(row).getByText("تجريبي")).toBeInTheDocument();
    expect(within(row).queryByText("الترخيص نشط")).not.toBeInTheDocument();
  });

  it("keeps the licence state when a trialing tenant's licence is no longer active", async () => {
    const lapsed: TenantSummaryDTO = {
      ...tenantSummary,
      subscription: { ...tenantSummary.subscription!, status: SubscriptionStatusCode.Trialing },
      licenseState: { state: LicenseStateCode.ReadOnly, canWrite: false, usable: true },
    };
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport({ ...baseHandlers(), "GET /tenants": () => ({ body: [lapsed] }) }),
      initialSession: testPlatformSession,
    });

    const row = (await screen.findByText("acme")).closest("tr")!;
    expect(within(row).queryByText("تجريبي")).not.toBeInTheDocument();
  });

  it("shows «منشأة جديدة» for an owner", async () => {
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport(baseHandlers()),
      initialSession: testPlatformSession,
    });
    expect(await screen.findByRole("button", { name: "منشأة جديدة" })).toBeInTheDocument();
  });

  it("hides «منشأة جديدة» for a support operator", async () => {
    renderWithPlatformProviders(<TenantsPage />, {
      transport: stubPlatformTransport(baseHandlers()),
      initialSession: supportSession,
    });
    await screen.findByText("acme");
    expect(screen.queryByRole("button", { name: "منشأة جديدة" })).not.toBeInTheDocument();
  });

  it("says in Arabic that the connection failed when the list cannot reach the server, never the browser's own words", async () => {
    const plansTransport = stubPlatformTransport({ "GET /plans": () => ({ body: [plan] }) });
    const transport: Transport = async (path, init) => {
      if (path === "/tenants") throw new TypeError("Failed to fetch");
      return plansTransport(path, init);
    };
    renderWithPlatformProviders(<TenantsPage />, { transport, initialSession: testPlatformSession });

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم أعد المحاولة.");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it("shows a loading skeleton before the tenants arrive, then the rows", async () => {
    let resolveTenants: (result: { status: number; body: unknown }) => void = () => {};
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolveTenants = resolve;
    });
    const plansTransport = stubPlatformTransport({ "GET /plans": () => ({ body: [plan] }) });
    const transport: Transport = async (path, init) => {
      if (path === "/tenants" && (init?.method ?? "GET").toUpperCase() === "GET") {
        const result = await pending;
        return {
          status: result.status,
          ok: result.status < 400,
          json: async <T,>() => result.body as T,
          text: async () => JSON.stringify(result.body),
        };
      }
      return plansTransport(path, init);
    };
    renderWithPlatformProviders(<TenantsPage />, { transport, initialSession: testPlatformSession });

    expect(screen.getByText("جارٍ التحميل…")).toBeInTheDocument();
    expect(screen.queryByText("acme")).not.toBeInTheDocument();

    resolveTenants({ status: 200, body: [tenantSummary] });
    expect(await screen.findByText("acme")).toBeInTheDocument();
  });

  it("surfaces the server's message in the error banner when the tenants fail to load", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants": () => ({ status: 500, body: { error: "INTERNAL", message: "تعذّر تحميل المنشآت." } }),
      "GET /plans": () => ({ body: [plan] }),
    });
    renderWithPlatformProviders(<TenantsPage />, { transport, initialSession: testPlatformSession });

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل المنشآت.");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
  });

  it("shows the empty state once loaded with no tenants — never while still loading or failed", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants": () => ({ body: [] }),
      "GET /plans": () => ({ body: [plan] }),
    });
    renderWithPlatformProviders(<TenantsPage />, { transport, initialSession: testPlatformSession });

    expect(await screen.findByText("لا توجد منشآت بعد.")).toBeInTheDocument();
  });

  it("opens the create dialog, submits, and shows the one-time admin PIN with a copy button", async () => {
    let posted: unknown = null;
    const transport = stubPlatformTransport({
      ...baseHandlers(),
      "POST /tenants": (init) => {
        posted = JSON.parse(String(init?.body));
        return {
          status: 201,
          body: {
            tenant: { ...tenantSummary.tenant, id: "tenant-2", code: "newco", status: "active" },
            adminEmail: "owner@newco.test",
            adminPin: "482910",
          },
        };
      },
    });
    renderWithPlatformProviders(<TenantsPage />, { transport, initialSession: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "منشأة جديدة" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("الكود"), { target: { value: "newco" } });
    expect(within(dialog).getByLabelText("الاسم بالعربية")).toHaveAttribute("maxlength", "200");
    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية"), { target: { value: "شركة جديدة" } });
    fireEvent.change(within(dialog).getByLabelText("اسم مالك الحساب"), { target: { value: "مالك الحساب" } });
    fireEvent.change(within(dialog).getByLabelText("البريد الإلكتروني لمالك الحساب"), { target: { value: "owner@newco.test" } });
    // Select is a custom listbox (not a native <select>): open it, then mousedown the option.
    fireEvent.click(within(dialog).getByRole("combobox", { name: "الباقة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "باقة النمو — growth" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "إنشاء المنشأة" }));

    expect(await within(dialog).findByText("482910")).toBeInTheDocument();
    expect(within(dialog).getByText("newco")).toBeInTheDocument();
    expect(within(dialog).getByText("owner@newco.test")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "نسخ" })).toBeInTheDocument();
    expect(posted).toMatchObject({ code: "newco", nameAr: "شركة جديدة", planId: "plan-1", ownerEmail: "owner@newco.test" });
  });

  it("the one-time PIN is unreachable after the result panel is closed", async () => {
    const transport = stubPlatformTransport({
      ...baseHandlers(),
      "POST /tenants": () => ({
        status: 201,
        body: {
          tenant: { ...tenantSummary.tenant, id: "tenant-2", code: "newco", status: "active" },
          adminEmail: "owner@newco.test",
          adminPin: "482910",
        },
      }),
    });
    renderWithPlatformProviders(<TenantsPage />, { transport, initialSession: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "منشأة جديدة" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("الكود"), { target: { value: "newco" } });
    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية"), { target: { value: "شركة جديدة" } });
    fireEvent.change(within(dialog).getByLabelText("اسم مالك الحساب"), { target: { value: "مالك الحساب" } });
    fireEvent.change(within(dialog).getByLabelText("البريد الإلكتروني لمالك الحساب"), { target: { value: "owner@newco.test" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "الباقة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "باقة النمو — growth" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "إنشاء المنشأة" }));

    expect(await within(dialog).findByText("482910")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "إغلاق" }));

    expect(screen.queryByText("482910")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates to the tenant detail page on row click", async () => {
    renderWithPlatformProviders(
      <>
        <TenantsPage />
        <LocationProbe />
      </>,
      { transport: stubPlatformTransport(baseHandlers()), initialSession: testPlatformSession },
    );

    fireEvent.click(await screen.findByText("acme"));
    expect(screen.getByTestId("location")).toHaveTextContent("/platform/tenants/tenant-1");
  });
});
