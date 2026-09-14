// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import type { PlanDTO, TenantSummaryDTO } from "@mezan/contracts";
import { TenantDetailPage } from "./TenantDetailPage";
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

const plan2: PlanDTO = { ...plan, id: "plan-2", code: "scale", nameAr: "باقة التوسع", nameEn: "Scale" };

function makeSummary(overrides: Partial<TenantSummaryDTO["tenant"]> = {}, subOverrides: Partial<NonNullable<TenantSummaryDTO["subscription"]>> = {}): TenantSummaryDTO {
  return {
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
      ...overrides,
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
      ...subOverrides,
    },
    plan,
    licenseState: { state: "ACTIVE", canWrite: true, usable: true },
    entitlements: null,
    payments: [],
  };
}

const supportSession: PlatformSession = {
  token: "SUPPORT-TOKEN",
  user: { id: "PU-2", email: "support@mezan.example", role: "support" },
};

function renderDetail(options: { transport: ReturnType<typeof stubPlatformTransport>; session: PlatformSession }) {
  return renderWithPlatformProviders(
    <Routes>
      <Route path="tenants/:id" element={<TenantDetailPage />} />
    </Routes>,
    { transport: options.transport, initialSession: options.session, route: "/platform/tenants/tenant-1" },
  );
}

describe("TenantDetailPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the subscription's facts", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByText("باقة النمو — growth")).toBeInTheDocument();
    expect(screen.getByText("شهرية")).toBeInTheDocument();
    expect(screen.getByText("01/09/2026")).toBeInTheDocument();
    expect(screen.getByText("01/10/2026")).toBeInTheDocument();
  });

  it("shows suspend and archive for an active tenant, not resume, for an owner", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByRole("button", { name: "إيقاف المنشأة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أرشفة المنشأة" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "استئناف المنشأة" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "تغيير الباقة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إلغاء الاشتراك" })).toBeInTheDocument();
  });

  it("shows resume, not suspend, for a suspended tenant", async () => {
    const summary = makeSummary({ status: "suspended" });
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByRole("button", { name: "استئناف المنشأة" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إيقاف المنشأة" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أرشفة المنشأة" })).toBeInTheDocument();
  });

  it("hides every write button for a support operator", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: supportSession });

    await screen.findByText("باقة النمو — growth");
    expect(screen.queryByRole("button", { name: "إيقاف المنشأة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "أرشفة المنشأة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "تغيير الباقة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إلغاء الاشتراك" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تسجيل دفعة" })).not.toBeInTheDocument();
  });

  it("«تسجيل دفعة» posts the payment and refreshes the tenant summary", async () => {
    let currentSummary = makeSummary();
    let posted: unknown = null;
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: currentSummary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/payments": (init) => {
        posted = JSON.parse(String(init?.body));
        currentSummary = {
          ...currentSummary,
          payments: [
            {
              id: "pay-1",
              tenantId: "tenant-1",
              subscriptionId: "sub-1",
              amount: "500.00",
              currency: "EGP",
              reference: "REF-1",
              paidAt: "2026-09-15T00:00:00.000Z",
              recordedBy: testPlatformSession.user.id,
              note: null,
              createdAt: "2026-09-15T00:00:00.000Z",
            },
          ],
        };
        return { status: 201, body: currentSummary };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "تسجيل دفعة" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("المرجع"), { target: { value: "REF-1" } });
    const amountInput = within(dialog).getByLabelText("المبلغ");
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: "500" } });
    fireEvent.blur(amountInput);
    fireEvent.click(within(dialog).getByRole("button", { name: "تسجيل الدفعة" }));

    expect(await screen.findByText("REF-1")).toBeInTheDocument();
    expect(posted).toMatchObject({ amount: "500.00", reference: "REF-1" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
