// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PlanDTO, SignupRequestDTO } from "@mezan/contracts";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

const corePlan: PlanDTO = {
  id: "PLAN-CORE",
  code: "core",
  nameAr: "الأساسية",
  nameEn: "Core",
  modules: ["accounting"],
  features: {},
  kind: "paid",
  quotas: {},
  seatsIncluded: 3,
  branchesIncluded: 1,
  warehousesIncluded: 1,
  priceMonthly: "490",
  priceYearly: "4900",
  trialDays: 14,
  isPublic: true,
  sortOrder: 1,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const request: SignupRequestDTO = {
  id: "REQ-1",
  code: "nile",
  nameAr: "منشأة النيل",
  nameEn: null,
  ownerEmail: "owner@nile.example",
  ownerNameAr: "سارة",
  intendedPlanId: "PLAN-CORE",
  billingCycle: "monthly",
  createdAt: "2026-10-20T10:00:00.000Z",
  verifiedAt: "2026-10-20T10:05:00.000Z",
};

function renderPage(handlers: Parameters<typeof stubPlatformTransport>[0], session = testPlatformSession) {
  renderWithPlatformProviders(<PlatformShell />, {
    route: "/platform/signup-requests",
    initialSession: session,
    transport: stubPlatformTransport({
      "GET /plans": () => ({ body: [corePlan] }),
      "GET /settings/signup-mode": () => ({ body: { mode: "approval" } }),
      ...handlers,
    }),
  });
}

describe("SignupRequestsPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("approves a request onto the chosen package and shows the one-time PIN", async () => {
    let approved: unknown = null;
    let rows = [request];
    renderPage({
      "GET /signup-requests": () => ({ body: rows }),
      "POST /signup-requests/REQ-1/approve": (init) => {
        approved = JSON.parse(String(init?.body));
        rows = [];
        return { status: 201, body: { tenant: { code: "nile" }, adminEmail: "owner@nile.example", adminPin: "482913" } };
      },
    });

    const row = (await screen.findByText("منشأة النيل")).closest("tr")!;
    expect(within(row).getByText("owner@nile.example")).toBeInTheDocument();
    expect(within(row).getByText("الأساسية")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "موافقة" }));

    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("باقة مدفوعة بلا فترة تجريبية تبدأ فترتها المدفوعة الآن: سجّل الدفعة من صفحة المنشأة.")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "الموافقة وإنشاء الحساب" }));

    expect(await within(panel).findByText("482913")).toBeInTheDocument();
    expect(approved).toEqual({ planId: "PLAN-CORE", billingCycle: "monthly", trial: false });
    await waitFor(() => expect(screen.getByText("لا توجد طلبات تنتظر المراجعة.")).toBeInTheDocument());
  });

  it("rejects only after confirming, and changing the mode asks first", async () => {
    let rejected = 0;
    let mode: unknown = null;
    renderPage({
      "GET /signup-requests": () => ({ body: rejected ? [] : [request] }),
      "POST /signup-requests/REQ-1/reject": () => {
        rejected += 1;
        return { body: { rejected: true } };
      },
      "PUT /settings/signup-mode": (init) => {
        mode = JSON.parse(String(init?.body));
        return { body: mode };
      },
    });

    const row = (await screen.findByText("منشأة النيل")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "رفض" }));
    const confirm = await screen.findByRole("dialog");
    expect(rejected).toBe(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "رفض" }));
    await waitFor(() => expect(rejected).toBe(1));

    fireEvent.click(screen.getByRole("combobox", { name: "طريقة التسجيل" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "مغلق" }));
    expect(mode).toBeNull();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "مغلق" }));
    await waitFor(() => expect(mode).toEqual({ mode: "closed" }));
  });

  it("is read-only for support", async () => {
    renderPage({ "GET /signup-requests": () => ({ body: [request] }) }, supportSession);

    const row = (await screen.findByText("منشأة النيل")).closest("tr")!;
    expect(within(row).queryByRole("button", { name: "موافقة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "طريقة التسجيل" })).not.toBeInTheDocument();
    expect(screen.getByText("بموافقتي")).toBeInTheDocument();
  });
});
