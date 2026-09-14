// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { useLocation } from "react-router";
import type { PlanDTO, TenantSummaryDTO } from "@mezan/contracts";
import { TenantsPage } from "./TenantsPage";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";
import type { PlatformSession } from "./session";

const plan: PlanDTO = {
  id: "plan-1",
  code: "growth",
  nameAr: "باقة النمو",
  nameEn: "Growth",
  modules: ["sales"],
  features: {},
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
    status: "active",
    dbFile: "tenants/acme.db",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  subscription: {
    id: "sub-1",
    tenantId: "tenant-1",
    planId: "plan-1",
    status: "active",
    billingCycle: "monthly",
    addOnModules: [],
    extraSeats: 0,
    extraBranches: 0,
    extraWarehouses: 0,
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    trialEndsAt: null,
    graceDays: 5,
    cancelledAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  plan,
  licenseState: { state: "ACTIVE", canWrite: true, usable: true },
  entitlements: null,
  payments: [],
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
