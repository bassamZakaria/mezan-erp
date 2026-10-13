// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Link, Route, Routes } from "react-router";
import type { Transport, TransportResponse } from "../data/transport";
import { LicenseStateCode, SubscriptionStatusCode, TenantBooksStanding, TenantWireStatus, type PlanDTO, type TenantSummaryDTO } from "@mezan/contracts";
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

const plan2: PlanDTO = { ...plan, id: "plan-2", code: "scale", nameAr: "باقة التوسع", nameEn: "Scale" };

const entitlementsFixture: NonNullable<TenantSummaryDTO["entitlements"]> = {
  plan: "growth",
  activeModules: ["sales", "inventory"],
  features: {},
  seats: 8,
  expiresAt: "2026-11-15T00:00:00.000Z",
  limits: { branches: 1, warehouses: 2 },
};

function makeSummary(overrides: Partial<TenantSummaryDTO["tenant"]> = {}, subOverrides: Partial<NonNullable<TenantSummaryDTO["subscription"]>> = {}): TenantSummaryDTO {
  return {
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
      ...overrides,
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
      ...subOverrides,
    },
    plan,
    licenseState: { state: LicenseStateCode.Active, canWrite: true, usable: true },
    entitlements: null,
    payments: [],
    books: TenantBooksStanding.Bound,
    handOverMailConfigured: true,
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

  it("shows an honest «لا توجد استحقاقات» when entitlements is null", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByText("لا توجد استحقاقات")).toBeInTheDocument();
  });

  it("shows the entitlements preview: plan code, module chips, seats, limits and expiry", async () => {
    const summary = { ...makeSummary(), entitlements: entitlementsFixture };
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByText("growth")).toBeInTheDocument();
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("المخزون")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("15/11/2026")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد استحقاقات")).not.toBeInTheDocument();
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
    const summary = makeSummary({ status: TenantWireStatus.Suspended });
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
    expect(screen.queryByRole("button", { name: "إيقاف الاشتراك" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "استئناف الاشتراك" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تسجيل دفعة" })).not.toBeInTheDocument();
  });

  it("shows the server's own refusal message when a transition is rejected — the click used to just do nothing", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/suspend": () => ({
        status: 409,
        body: { error: "INVALID_TENANT_TRANSITION", message: 'لا يمكن نقل المنشأة من الحالة "active" إلى "suspended"' },
      }),
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إيقاف المنشأة" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إيقاف المنشأة؟" })).getByRole("button", { name: "إيقاف المنشأة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('لا يمكن نقل المنشأة من الحالة "active" إلى "suspended"');
  });

  it("falls back to the mapped catalog string when the server sends only a bare VALIDATION_ERROR code", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/suspend": () => ({ status: 400, body: { error: "VALIDATION_ERROR", details: {} } }),
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إيقاف المنشأة" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إيقاف المنشأة؟" })).getByRole("button", { name: "إيقاف المنشأة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تحقق من الحقول المدخلة.");
  });

  it("suspending asks for confirmation first, and posts nothing until it is given (D-SAAS-10)", async () => {
    let suspendPosts = 0;
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/suspend": () => {
        suspendPosts += 1;
        return { body: { ...summary, tenant: { ...summary.tenant, status: "suspended" } } };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إيقاف المنشأة" }));
    const dialog = await screen.findByRole("dialog", { name: "إيقاف المنشأة؟" });
    expect(suspendPosts).toBe(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "رجوع" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "إيقاف المنشأة؟" })).not.toBeInTheDocument());
    expect(suspendPosts).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "إيقاف المنشأة" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إيقاف المنشأة؟" })).getByRole("button", { name: "إيقاف المنشأة" }));
    await waitFor(() => expect(suspendPosts).toBe(1));
  });

  it("shows the billing day, says when it needs review, and lets the platform owner set it", async () => {
    const sent: unknown[] = [];
    let day = 28;
    let needsReview = true;
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary({}, { billingAnchorDay: day, billingAnchorNeedsReview: needsReview }) }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/subscription/anchor-day": (init) => {
        const body = JSON.parse(String(init?.body)) as { day: number };
        sent.push(body);
        day = body.day;
        needsReview = false;
        return { body: makeSummary({}, { billingAnchorDay: day, billingAnchorNeedsReview: false }) };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByText("يوم الفوترة يحتاج مراجعة")).toBeInTheDocument();
    const field = screen.getByRole("spinbutton", { name: "يوم الفوترة من الشهر" });
    expect(field).toHaveValue(28);
    fireEvent.change(field, { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ يوم الفوترة" }));
    const dialog = await screen.findByRole("dialog", { name: "تغيير يوم الفوترة؟" });
    expect(dialog).toHaveTextContent("تغيير يوم الفوترة من 28 إلى 31 يطيل أو يقصّر الفترة المدفوعة التالية");
    expect(sent).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ يوم الفوترة" }));

    await waitFor(() => expect(sent).toEqual([{ day: 31 }]));
    await waitFor(() => expect(screen.queryByText("يوم الفوترة يحتاج مراجعة")).not.toBeInTheDocument());
    expect(screen.getByRole("spinbutton", { name: "يوم الفوترة من الشهر" })).toHaveValue(31);
  });

  it("refuses a billing day that is not on a calendar before asking the server, and shows a support operator the day without the control", async () => {
    let posts = 0;
    const handlers = {
      "GET /tenants/tenant-1": () => ({ body: makeSummary({}, { billingAnchorDay: 15 }) }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/subscription/anchor-day": () => {
        posts += 1;
        return { body: makeSummary() };
      },
    };
    const asOwner = renderDetail({ transport: stubPlatformTransport(handlers), session: testPlatformSession });
    const field = await screen.findByRole("spinbutton", { name: "يوم الفوترة من الشهر" });
    fireEvent.change(field, { target: { value: "32" } });
    expect(screen.getByRole("button", { name: "حفظ يوم الفوترة" })).toBeDisabled();
    expect(posts).toBe(0);
    asOwner.unmount();

    renderDetail({ transport: stubPlatformTransport(handlers), session: { token: "S", user: { id: "PU-2", email: "support@mezan.example", role: "support" } } });
    expect(await screen.findByText("يوم الفوترة من الشهر")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "يوم الفوترة من الشهر" })).not.toBeInTheDocument();
  });

  it("offers the owner of the platform to archive a tenant stuck in provisioning and free its code, after asking", async () => {
    let releases = 0;
    const stuck = makeSummary({ status: TenantWireStatus.Provisioning });
    const archived = makeSummary({ status: TenantWireStatus.Archived, code: "released-tenant-1" });
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: releases === 0 ? stuck : archived }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/release": () => {
        releases += 1;
        return { body: archived };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "أرشفة وتحرير الرمز" }));
    const dialog = await screen.findByRole("dialog", { name: "أرشفة المنشأة وتحرير رمزها؟" });
    expect(dialog).toHaveTextContent("acme");
    expect(releases).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "أرشفة وتحرير" }));

    await waitFor(() => expect(releases).toBe(1));
    expect(await screen.findByText("released-tenant-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "أرشفة وتحرير الرمز" })).not.toBeInTheDocument();
  });

  it("offers no release for a live tenant, nor to a support operator", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });
    await screen.findByRole("button", { name: "أرشفة المنشأة" });
    expect(screen.queryByRole("button", { name: "أرشفة وتحرير الرمز" })).not.toBeInTheDocument();
  });

  it("says the owner contact is unverified, and after a reset names the address the owner now signs in with", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary({ ownerContactVerified: false }) }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-pin/reset": () => ({
        body: { adminEmail: "owner@acme.test", signInEmail: "inbox@elsewhere.test", adminPin: "305917" },
      }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByText("بريد المالك غير مؤكَّد")).toBeInTheDocument();
    expect(screen.getByText(/بريد دخول حساب المالك يختلف عن البريد المسجَّل هنا/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة تعيين رمز المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين رمز المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByText("305917")).toBeInTheDocument();
    expect(screen.getByText("بريد الدخول الحالي للمالك")).toBeInTheDocument();
    expect(screen.getByText("inbox@elsewhere.test")).toBeInTheDocument();
  });

  it("shows no unverified mark and no second address for a verified owner", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-pin/reset": () => ({ body: { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPin: "305917" } }),
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين رمز المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين رمز المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByText("305917")).toBeInTheDocument();
    expect(screen.queryByText("بريد المالك غير مؤكَّد")).not.toBeInTheDocument();
    expect(screen.queryByText("بريد الدخول الحالي للمالك")).not.toBeInTheDocument();
  });

  it("resetting the owner's PIN asks first, then shows the new PIN once with the owner's email", async () => {
    let resets = 0;
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-pin/reset": () => {
        resets += 1;
        return { body: { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPin: "305917" } };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين رمز المالك" }));
    const dialog = await screen.findByRole("dialog", { name: "إعادة تعيين رمز المالك؟" });
    expect(resets).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "رجوع" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "إعادة تعيين رمز المالك؟" })).not.toBeInTheDocument());
    expect(resets).toBe(0);
    expect(screen.queryByText("305917")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة تعيين رمز المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين رمز المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByText("305917")).toBeInTheDocument();
    expect(screen.getByText("owner@acme.test")).toBeInTheDocument();
    expect(screen.getByText(/لن يظهر .* مرة أخرى/)).toBeInTheDocument();
    expect(resets).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "إخفاء الرمز" }));
    await waitFor(() => expect(screen.queryByText("305917")).not.toBeInTheDocument());
  });

  function renderConsole(transport: Transport) {
    return renderWithPlatformProviders(
      <Routes>
        <Route path="tenants/:id" element={<TenantDetailPage />} />
        <Route
          path="tenants"
          element={
            <nav aria-label="قائمة الاختبار">
              <Link to="/platform/tenants/tenant-1">افتح أكمي</Link>
              <Link to="/platform/tenants/tenant-2">افتح الثانية</Link>
            </nav>
          }
        />
      </Routes>,
      { transport, initialSession: testPlatformSession, route: "/platform/tenants/tenant-1" },
    );
  }

  async function askForReset() {
    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين رمز المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين رمز المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));
  }

  const LEAVE_DIALOG = "مغادرة الصفحة قبل تسليم الرمز؟";

  it("still shows the new PIN when the reset answers after the operator has left the page and come back, and never on another tenant's page", async () => {
    let answer: (response: TransportResponse) => void = () => undefined;
    const base = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /tenants/tenant-2": () => ({ body: makeSummary({ id: "tenant-2", code: "other", nameAr: "منشأة ثانية", ownerEmail: "owner@other.test" }) }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    const transport: Transport = (path, init) =>
      path === "/tenants/tenant-1/owner-pin/reset" ? new Promise<TransportResponse>((resolve) => (answer = resolve)) : base(path, init);
    renderConsole(transport);
    await askForReset();

    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));
    const leaving = await screen.findByRole("dialog", { name: LEAVE_DIALOG });
    expect(screen.queryByRole("navigation", { name: "قائمة الاختبار" })).not.toBeInTheDocument();
    fireEvent.click(within(leaving).getByRole("button", { name: "غادر على أي حال" }));
    await screen.findByRole("navigation", { name: "قائمة الاختبار" });

    const body = { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPin: "305917" };
    await act(async () => {
      answer({ status: 200, ok: true, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)) });
    });
    fireEvent.click(screen.getByRole("link", { name: "افتح أكمي" }));

    expect(await screen.findByText("305917")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: LEAVE_DIALOG })).getByRole("button", { name: "غادر على أي حال" }));
    fireEvent.click(await screen.findByRole("link", { name: "افتح الثانية" }));
    await screen.findByRole("heading", { name: "منشأة ثانية", level: 1 });
    expect(screen.queryByText("305917")).not.toBeInTheDocument();
    expect(screen.queryByText(/لن يظهر .* مرة أخرى/)).not.toBeInTheDocument();
  });

  it("asks before leaving while the new PIN has not been acknowledged, keeps it on staying, and lets go once it is hidden", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-pin/reset": () => ({ body: { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPin: "305917" } }),
    });
    renderConsole(transport);
    await askForReset();
    await screen.findByText("305917");

    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: LEAVE_DIALOG })).getByRole("button", { name: "ابقَ في الصفحة" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument());
    expect(screen.getByText("305917")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إخفاء الرمز" }));
    await waitFor(() => expect(screen.queryByText("305917")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));

    await screen.findByRole("navigation", { name: "قائمة الاختبار" });
    expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "افتح أكمي" }));
    await screen.findByRole("heading", { name: "شركة أكمي", level: 1 });
    expect(screen.queryByText("305917")).not.toBeInTheDocument();
  });

  it("shows the server's refusal when the owner's PIN cannot be reset, and no PIN", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-pin/reset": () => ({
        status: 409,
        body: { error: "TENANT_OWNER_ACCOUNT_NOT_FOUND", message: "لا يوجد في المنشأة حساب مدير نشط ببريد مالكها." },
      }),
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين رمز المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين رمز المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("لا يوجد في المنشأة حساب مدير نشط ببريد مالكها.");
  });

  it("does not offer the PIN reset to a support operator", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: supportSession });

    await screen.findByText("باقة النمو — growth");
    expect(screen.queryByRole("button", { name: "إعادة تعيين رمز المالك" })).not.toBeInTheDocument();
  });

  it("archiving asks for confirmation, and confirming posts the archive", async () => {
    let archived = false;
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: archived ? { ...summary, tenant: { ...summary.tenant, status: "archived" } } : summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/archive": () => {
        archived = true;
        return { body: { ...summary, tenant: { ...summary.tenant, status: "archived" } } };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "أرشفة المنشأة" }));
    const confirmDialog = screen.getByRole("dialog");
    expect(within(confirmDialog).getByText("أرشفة المنشأة؟")).toBeInTheDocument();
    expect(archived).toBe(false);

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "أرشفة المنشأة" }));
    expect(await screen.findByText("مؤرشفة")).toBeInTheDocument();
    expect(archived).toBe(true);
  });

  it("cancelling the subscription asks for confirmation, and confirming posts the cancellation", async () => {
    let cancelled = false;
    const summary = makeSummary();
    const cancelledSubscription = { ...summary.subscription!, status: "cancelled" as const };
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: cancelled ? { ...summary, subscription: cancelledSubscription } : summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/subscription/cancel": () => {
        cancelled = true;
        return { body: { ...summary, subscription: cancelledSubscription } };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إلغاء الاشتراك" }));
    const confirmDialog = screen.getByRole("dialog");
    expect(within(confirmDialog).getByText("إلغاء الاشتراك؟")).toBeInTheDocument();
    expect(cancelled).toBe(false);

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إلغاء الاشتراك" }));
    expect(await screen.findByText("ملغى")).toBeInTheDocument();
    expect(cancelled).toBe(true);
  });

  it("suspending the subscription requires a reason, and confirming sends it to the server", async () => {
    let suspendedBody: unknown = null;
    const summary = makeSummary();
    const suspended = { ...summary.subscription!, status: "suspended" as const };
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: suspendedBody ? { ...summary, subscription: suspended } : summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/subscription/suspend": (init) => {
        suspendedBody = JSON.parse(String(init?.body));
        return { body: { ...summary, subscription: suspended } };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إيقاف الاشتراك" }));
    const confirmDialog = screen.getByRole("dialog");
    expect(within(confirmDialog).getByText("إيقاف الاشتراك؟")).toBeInTheDocument();

    const confirmButton = within(confirmDialog).getByRole("button", { name: "إيقاف الاشتراك" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(confirmDialog).getByLabelText("السبب"), { target: { value: "توقف عن السداد" } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(await screen.findByText("موقوف")).toBeInTheDocument();
    expect(suspendedBody).toEqual({ reason: "توقف عن السداد" });
  });

  it("resuming a suspended subscription requires a reason, and confirming sends it to the server", async () => {
    let resumedBody: unknown = null;
    const summary = makeSummary({}, { status: SubscriptionStatusCode.Suspended });
    const resumed = { ...summary.subscription!, status: SubscriptionStatusCode.Active };
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: resumedBody ? { ...summary, subscription: resumed } : summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/subscription/resume": (init) => {
        resumedBody = JSON.parse(String(init?.body));
        return { body: { ...summary, subscription: resumed } };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "استئناف الاشتراك" }));
    const confirmDialog = screen.getByRole("dialog");
    expect(within(confirmDialog).getByText("استئناف الاشتراك؟")).toBeInTheDocument();

    const confirmButton = within(confirmDialog).getByRole("button", { name: "استئناف الاشتراك" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(confirmDialog).getByLabelText("السبب"), { target: { value: "تمت التسوية" } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(await screen.findByText("نشط")).toBeInTheDocument();
    expect(resumedBody).toEqual({ reason: "تمت التسوية" });
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

  describe("the tenant's owner", () => {
    const admins = [
      { id: "U-1", nameAr: "سارة المالكة", email: "owner@acme.test" },
      { id: "U-2", nameAr: "خالد المدير", email: "second@acme.test" },
    ];

    const WAITING = { userId: "U-2", email: "second@acme.test", requestedAt: "2026-10-01T09:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", linkMailed: true };

    it("flags a tenant with no owner, and assigns the admin the platform owner picks only after asking", async () => {
      const assigned: unknown[] = [];
      let release: (() => void) | undefined;
      const answered = new Promise<void>((resolve) => (release = resolve));
      const stub = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: assigned.length === 0 ? makeSummary({ ownerNeeded: true }) : makeSummary({ ownerEmail: "second@acme.test" }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "GET /tenants/tenant-1/owner/candidates": () => ({ body: admins }),
        "POST /tenants/tenant-1/owner": (init) => {
          assigned.push(JSON.parse(String(init?.body)));
          return { body: makeSummary({ ownerEmail: "second@acme.test" }) };
        },
      });
      const transport: Transport = async (path, init) => {
        const response: TransportResponse = await stub(path, init);
        if (init?.method === "POST") await answered;
        return response;
      };
      renderDetail({ transport, session: testPlatformSession });

      expect(await screen.findByText("المنشأة بلا مالك محدَّد")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "تعيين مالك" }));
      const second = (await screen.findByText("second@acme.test")).closest("li") as HTMLElement;
      const first = screen.getByText("سارة المالكة").closest("li") as HTMLElement;
      fireEvent.click(within(second).getByRole("button", { name: "تعيين مالكًا" }));
      const dialog = await screen.findByRole("dialog", { name: "تعيين مالك المنشأة؟" });
      expect(dialog).toHaveTextContent("second@acme.test");
      expect(assigned).toEqual([]);

      fireEvent.click(within(dialog).getByRole("button", { name: "تعيين" }));

      await waitFor(() => expect(assigned).toEqual([{ userId: "U-2" }]));
      expect(within(second).getByRole("button", { name: "تعيين مالكًا" })).toBeDisabled();
      expect(within(first).getByRole("button", { name: "تعيين مالكًا" })).toBeEnabled();
      await act(async () => release?.());
      await waitFor(() => expect(screen.queryByText("المنشأة بلا مالك محدَّد")).not.toBeInTheDocument());
      expect(screen.getByText(/بريد المالك: second@acme\.test/)).toBeInTheDocument();
    });

    it("shows a pending hand-over with who asked for it, and confirms it only after asking", async () => {
      let confirms = 0;
      const pending = makeSummary({ pendingOwner: WAITING });
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: confirms === 0 ? pending : makeSummary({ ownerEmail: "second@acme.test" }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/owner/confirm": () => {
          confirms += 1;
          return { body: makeSummary({ ownerEmail: "second@acme.test" }) };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      expect(await screen.findByText("نقل ملكية بانتظار التأكيد")).toBeInTheDocument();
      expect(screen.getByText(/second@acme\.test/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "تأكيد نقل الملكية" }));
      const dialog = await screen.findByRole("dialog", { name: "تأكيد نقل ملكية المنشأة؟" });
      expect(dialog).toHaveTextContent("owner@acme.test");
      expect(dialog).toHaveTextContent("second@acme.test");
      expect(confirms).toBe(0);
      fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد النقل" }));

      await waitFor(() => expect(confirms).toBe(1));
      await waitFor(() => expect(screen.queryByText("نقل ملكية بانتظار التأكيد")).not.toBeInTheDocument());
    });

    function pendingTransport(pendingOwner: typeof WAITING, posts: string[] = []) {
      let dropped = false;
      let current = pendingOwner;
      return stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: dropped ? makeSummary({}) : makeSummary({ pendingOwner: current }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/owner/decline": () => {
          posts.push("decline");
          dropped = true;
          return { body: makeSummary({}) };
        },
        "POST /tenants/tenant-1/owner/resend": () => {
          posts.push("resend");
          current = { ...pendingOwner, expiresAt: "2099-01-01T00:00:00.000Z", linkMailed: true };
          return { body: makeSummary({ pendingOwner: current }) };
        },
      });
    }

    it("says the previous owner was mailed a link only when one was", async () => {
      renderDetail({ transport: pendingTransport({ ...WAITING, linkMailed: false }), session: testPlatformSession });

      expect(await screen.findByText(/لم يُرسل رابط تأكيد إلى بريد المالك السابق/)).toBeInTheDocument();
      expect(screen.queryByText(/من الرابط المرسل إلى بريده/)).not.toBeInTheDocument();
    });

    it("declines a pending hand-over only after asking, and the request is gone", async () => {
      const posts: string[] = [];
      renderDetail({ transport: pendingTransport(WAITING, posts), session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "إلغاء طلب النقل" }));
      const dialog = await screen.findByRole("dialog", { name: "إلغاء طلب نقل الملكية؟" });
      expect(dialog).toHaveTextContent("second@acme.test");
      expect(posts).toEqual([]);
      fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء الطلب" }));

      await waitFor(() => expect(posts).toEqual(["decline"]));
      await waitFor(() => expect(screen.queryByText("نقل ملكية بانتظار التأكيد")).not.toBeInTheDocument());
    });

    it("shows a lapsed hand-over as expired, offers to send the link again or decline it, and no longer offers to confirm it", async () => {
      const posts: string[] = [];
      renderDetail({ transport: pendingTransport({ ...WAITING, expiresAt: "2020-01-01T00:00:00.000Z" }, posts), session: testPlatformSession });

      expect(await screen.findByText(/انتهت مهلة تأكيد هذا الطلب/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تأكيد نقل الملكية" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "إلغاء طلب النقل" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "إرسال الرابط من جديد" }));

      await waitFor(() => expect(posts).toEqual(["resend"]));
      expect(await screen.findByRole("button", { name: "تأكيد نقل الملكية" })).toBeInTheDocument();
      expect(screen.queryByText(/انتهت مهلة تأكيد هذا الطلب/)).not.toBeInTheDocument();
    });

    it("says in Arabic that the connection failed when an owner action cannot reach the server", async () => {
      const stub = pendingTransport(WAITING);
      const transport: Transport = async (path, init) => {
        if (init?.method === "POST") throw new TypeError("Failed to fetch");
        return stub(path, init);
      };
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "إرسال الرابط من جديد" }));

      expect(await screen.findByText("تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم أعد المحاولة.")).toBeInTheDocument();
      expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    });

    it("shows the state but no owner action to a support operator, nor for a tenant that is not live", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary({ ownerNeeded: true, pendingOwner: WAITING }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: supportSession });

      expect(await screen.findByText("نقل ملكية بانتظار التأكيد")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تعيين مالك" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تأكيد نقل الملكية" })).not.toBeInTheDocument();
    });

    it("does not offer to send the link again while the platform has no mail, and says what to do instead", async () => {
      const posts: string[] = [];
      const stub = pendingTransport({ ...WAITING, linkMailed: false }, posts);
      const transport: Transport = async (path, init) => {
        const response = await stub(path, init);
        if (path !== "/tenants/tenant-1") return response;
        return { ...response, json: <T,>() => Promise.resolve({ ...makeSummary({ pendingOwner: { ...WAITING, linkMailed: false } }), handOverMailConfigured: false } as T) };
      };
      renderDetail({ transport, session: testPlatformSession });

      const resend = await screen.findByRole("button", { name: "إرسال الرابط من جديد" });
      expect(resend).toBeDisabled();
      expect(resend).toHaveAccessibleDescription("البريد غير مفعّل على المنصة، فلا يُرسل رابط. أكّد نقل الملكية من هنا أو عيّن المالك مباشرة.");
      expect(screen.getByText("البريد غير مفعّل على المنصة، فلا يُرسل رابط. أكّد نقل الملكية من هنا أو عيّن المالك مباشرة.")).toBeVisible();
      fireEvent.click(resend);
      expect(posts).toEqual([]);
      expect(screen.getByRole("button", { name: "تأكيد نقل الملكية" })).toBeEnabled();
    });

    it("explains an unverified owner address without blaming one cause", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary({ ownerContactVerified: false }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: testPlatformSession });

      expect(
        await screen.findByText("بريد دخول حساب المالك يختلف عن البريد المسجَّل هنا، ولم يثبت بعد أن المالك نفسه هو من غيّره. يبقى البريد المسجَّل كما هو حتى يسجّل المالك دخوله برمزه الخاص، أو تؤكّد أنت مالك المنشأة من هنا."),
      ).toBeInTheDocument();
    });
  });

  describe("the company's books", () => {
    const admins = [
      { id: "U-1", nameAr: "سارة المالكة", email: "owner@acme.test" },
      { id: "U-2", nameAr: "خالد المدير", email: "second@acme.test" },
    ];
    const withBooks = (books: TenantBooksStanding, overrides: Partial<TenantSummaryDTO["tenant"]> = {}): TenantSummaryDTO => ({ ...makeSummary(overrides), books });

    function booksTransport(start: TenantBooksStanding, posts: { route: string; body: unknown }[] = []) {
      let standing = start;
      const act = (route: string, next: TenantBooksStanding) => (init: RequestInit | undefined) => {
        posts.push({ route, body: init?.body ? JSON.parse(String(init.body)) : null });
        standing = next;
        return { body: withBooks(standing) };
      };
      return stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: withBooks(standing) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "GET /tenants/tenant-1/books": () => ({ body: { standing, companyName: "شركة أكمي للتجارة", admins } }),
        "POST /tenants/tenant-1/books/confirm": act("confirm", TenantBooksStanding.Bound),
        "POST /tenants/tenant-1/books/disown": act("disown", TenantBooksStanding.Disowned),
        "POST /tenants/tenant-1/books/unbind": act("unbind", TenantBooksStanding.Disowned),
      });
    }

    it("shows bound books as bound and offers the platform owner to unbind them, nothing else", async () => {
      renderDetail({ transport: booksTransport(TenantBooksStanding.Bound), session: testPlatformSession });

      expect(await screen.findByRole("button", { name: "فك ربط الدفاتر" })).toBeInTheDocument();
      expect(screen.getByText("دفاتر مربوطة")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تأكيد الدفاتر" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "ليست دفاتر هذه المنشأة" })).not.toBeInTheDocument();
    });

    it("says unbound books hold nothing back, shows the company name and admins the file holds, and confirms with exactly what the dialog showed and the admin picked, only after asking", async () => {
      const posts: { route: string; body: unknown }[] = [];
      renderDetail({ transport: booksTransport(TenantBooksStanding.Unbound, posts), session: testPlatformSession });

      expect(await screen.findByText("دفاتر غير مربوطة (قديمة)")).toBeInTheDocument();
      expect(screen.getByText(/وتعمل المنشأة عليها كما كانت ولا يمنع ذلك شيئًا/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "تأكيد الدفاتر" }));
      const dialog = await screen.findByRole("dialog", { name: "تأكيد أن هذه دفاتر المنشأة؟" });
      expect(await within(dialog).findByText("شركة أكمي للتجارة")).toBeInTheDocument();
      const confirm = within(dialog).getByRole("button", { name: "تأكيد وربط" });
      expect(confirm).toBeDisabled();
      fireEvent.click(within(dialog).getByRole("radio", { name: /خالد المدير.*second@acme\.test/ }));
      expect(posts).toEqual([]);
      fireEvent.click(confirm);

      await waitFor(() => expect(posts).toEqual([{ route: "confirm", body: { userId: "U-2", companyName: "شركة أكمي للتجارة" } }]));
      expect(await screen.findByText("دفاتر مربوطة")).toBeInTheDocument();
      expect(screen.queryByText("دفاتر غير مربوطة (قديمة)")).not.toBeInTheDocument();
    });

    it("stops serving the company when the platform owner says the books are not its own, after asking", async () => {
      const posts: { route: string; body: unknown }[] = [];
      renderDetail({ transport: booksTransport(TenantBooksStanding.Unbound, posts), session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "ليست دفاتر هذه المنشأة" }));
      const dialog = await screen.findByRole("dialog", { name: "إيقاف العمل على هذه الدفاتر؟" });
      expect(posts).toEqual([]);
      fireEvent.click(within(dialog).getByRole("button", { name: "إيقاف العمل عليها" }));

      await waitFor(() => expect(posts).toEqual([{ route: "disown", body: null }]));
      expect(await screen.findByText("دفاتر موقوفة")).toBeInTheDocument();
      expect(screen.getByText(/سُجّل أن الملف الموجود ليس دفاتر هذه المنشأة، فلا يدخلها أحد/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "تأكيد الدفاتر" })).toBeInTheDocument();
    });

    it("unbinds bound books only once the company's code is typed", async () => {
      const posts: { route: string; body: unknown }[] = [];
      renderDetail({ transport: booksTransport(TenantBooksStanding.Bound, posts), session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "فك ربط الدفاتر" }));
      const dialog = await screen.findByRole("dialog", { name: "فك ربط دفاتر المنشأة؟" });
      const confirm = within(dialog).getByRole("button", { name: "فك الربط" });
      expect(confirm).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText("اكتب رمز المنشأة للتأكيد"), { target: { value: "acm" } });
      expect(confirm).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText("اكتب رمز المنشأة للتأكيد"), { target: { value: "acme" } });
      fireEvent.click(confirm);

      await waitFor(() => expect(posts).toEqual([{ route: "unbind", body: { code: "acme" } }]));
      expect(await screen.findByText("دفاتر موقوفة")).toBeInTheDocument();
    });

    it.each([
      [TenantBooksStanding.Missing, "ملف الدفاتر مفقود", /ملف دفاتر هذه المنشأة ليس في مكانه على الخادم/],
      [TenantBooksStanding.Foreign, "دفاتر منشأة أخرى", /الملف الموجود مربوط بمنشأة أخرى أو لم يُنشئ فيه أحد حسابًا/],
      [TenantBooksStanding.Unreadable, "ملف دفاتر تالف", /تعذّرت قراءة ملف دفاتر هذه المنشأة/],
    ])("explains books that are %s", async (standing, label, explanation) => {
      renderDetail({ transport: booksTransport(standing), session: testPlatformSession });

      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.getByText(explanation)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تأكيد الدفاتر" })).not.toBeInTheDocument();
    });

    it("says nothing about the books of a company still being provisioned", async () => {
      renderDetail({ transport: stubPlatformTransport({ "GET /tenants/tenant-1": () => ({ body: withBooks(TenantBooksStanding.Provisioning, { status: TenantWireStatus.Provisioning }) }), "GET /plans": () => ({ body: [plan, plan2] }) }), session: testPlatformSession });

      expect(await screen.findByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
      expect(screen.queryByText(/دفاتر/)).not.toBeInTheDocument();
    });

    const REASON = "دفاتر هذه المنشأة لا تُفتح الآن، فلا يُعيَّن لها مالك ولا يُعاد تعيين رمزه حتى تعود دفاترها إلى مكانها.";

    it.each([TenantBooksStanding.Disowned, TenantBooksStanding.Foreign, TenantBooksStanding.Missing, TenantBooksStanding.Unreadable])(
      "does not offer to assign an owner or reset the owner's PIN while the books are %s, and says why in Arabic",
      async (standing) => {
        renderDetail({ transport: booksTransport(standing), session: testPlatformSession });

        const assign = await screen.findByRole("button", { name: "تعيين مالك" });
        const reset = screen.getByRole("button", { name: "إعادة تعيين رمز المالك" });
        expect(assign).toBeDisabled();
        expect(reset).toBeDisabled();
        expect(assign).toHaveAccessibleDescription(REASON);
        expect(reset).toHaveAccessibleDescription(REASON);
        expect(screen.getByText(REASON)).toBeVisible();
      },
    );

    it.each([TenantBooksStanding.Unbound, TenantBooksStanding.Bound])("offers to assign an owner and to reset the owner's PIN while the books are %s", async (standing) => {
      renderDetail({ transport: booksTransport(standing), session: testPlatformSession });

      expect(await screen.findByRole("button", { name: "تعيين مالك" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "إعادة تعيين رمز المالك" })).toBeEnabled();
      expect(screen.queryByText(REASON)).not.toBeInTheDocument();
    });

    it("shows a support operator where the books stand and none of the actions", async () => {
      renderDetail({ transport: booksTransport(TenantBooksStanding.Unbound), session: supportSession });

      expect(await screen.findByText("دفاتر غير مربوطة (قديمة)")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تأكيد الدفاتر" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "ليست دفاتر هذه المنشأة" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "فك ربط الدفاتر" })).not.toBeInTheDocument();
    });

    it("shows the server's refusal when the books cannot be confirmed, and offers the three actions again", async () => {
      const stub = booksTransport(TenantBooksStanding.Unbound);
      const transport: Transport = async (path, init) => {
        if (path === "/tenants/tenant-1/books/confirm") {
          const body = { error: "AUDIT_UNAVAILABLE", message: "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى." };
          return { status: 503, ok: false, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)) };
        }
        return stub(path, init);
      };
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "تأكيد الدفاتر" }));
      const dialog = await screen.findByRole("dialog", { name: "تأكيد أن هذه دفاتر المنشأة؟" });
      fireEvent.click(await within(dialog).findByRole("radio", { name: /سارة المالكة/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد وربط" }));

      expect(await screen.findByText("تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.")).toBeInTheDocument();
      expect(screen.getByText("دفاتر غير مربوطة (قديمة)")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "تأكيد الدفاتر" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "ليست دفاتر هذه المنشأة" })).toBeEnabled();
    });
  });
});
