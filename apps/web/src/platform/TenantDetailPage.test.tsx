// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Link, Route, Routes } from "react-router";
import { focusManager } from "@tanstack/react-query";
import type { Transport, TransportResponse } from "../data/transport";
import { LicenseStateCode, SubscriptionStatusCode, TenantBooksStanding, TenantWireStatus, type CardCheckoutDTO, type PlanDTO, type TenantSummaryDTO } from "@mezan/contracts";
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

  it("gives every dialog on the page its own key, so the browser console stays free of duplicate-key warnings", async () => {
    const complaints = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });
    await screen.findByText("باقة النمو — growth");

    expect(complaints.mock.calls.filter((call) => String(call[0]).includes("same key"))).toEqual([]);
    complaints.mockRestore();
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
    const card = within(screen.getByRole("heading", { name: "الاستحقاقات" }).parentElement!);
    expect(card.getByText("المبيعات")).toBeInTheDocument();
    expect(card.getByText("المخزون")).toBeInTheDocument();
    expect(card.getByText("8")).toBeInTheDocument();
    expect(card.getByText("1")).toBeInTheDocument();
    expect(card.getByText("2")).toBeInTheDocument();
    expect(card.getByText("15/11/2026")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد استحقاقات")).not.toBeInTheDocument();
  });

  describe("company extras", () => {
    const extrasCard = () => within(screen.getByRole("heading", { name: "إضافات المنشأة" }).parentElement!);

    it("lets an owner grant add-on modules and extra users, and sends exactly what was chosen after confirming", async () => {
      const posts: unknown[] = [];
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/subscription/extras": (init) => {
          posts.push(JSON.parse(String(init?.body)));
          return { body: makeSummary({}, { addOnModules: ["inventory"], extraSeats: 2 }) };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      expect(card.queryByRole("button", { name: "المبيعات" })).not.toBeInTheDocument();
      expect(card.getByRole("button", { name: "حفظ الإضافات" })).toBeDisabled();

      fireEvent.click(card.getByRole("button", { name: "المخزون" }));
      fireEvent.change(card.getByLabelText("مستخدمون إضافيون"), { target: { value: "2" } });
      fireEvent.click(card.getByRole("button", { name: "حفظ الإضافات" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "حفظ الإضافات" }));

      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toEqual({ addOnModules: ["inventory"], extraSeats: 2, extraBranches: 0, extraWarehouses: 0, graceDays: 5 });
      expect(posts[0]).not.toHaveProperty("extraStorageMb");
    });

    it("sends the extra attachment storage the owner typed, in megabytes, after confirming", async () => {
      const posts: Array<{ extraStorageMb?: number }> = [];
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: { ...makeSummary(), plan: { ...plan, quotas: { storage_mb: 1024 } } } }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/subscription/extras": (init) => {
          posts.push(JSON.parse(String(init?.body)));
          return { body: makeSummary({}, { extraStorageMb: 2048 }) };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.change(card.getByLabelText("مساحة إضافية للمرفقات (MB)"), { target: { value: "2048" } });
      fireEvent.click(card.getByRole("button", { name: "حفظ الإضافات" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "حفظ الإضافات" }));

      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]!.extraStorageMb).toBe(2048);
    });

    it("an untouched storage field is not sent, so a request approved meanwhile keeps its granted space", async () => {
      const posts: Array<Record<string, unknown>> = [];
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: { ...makeSummary({}, { extraStorageMb: 2048 }), plan: { ...plan, quotas: { storage_mb: 1024 } } } }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/subscription/extras": (init) => {
          posts.push(JSON.parse(String(init?.body)));
          return { body: makeSummary({}, { extraStorageMb: 2048, extraSeats: 3 }) };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.change(card.getByLabelText("مستخدمون إضافيون"), { target: { value: "3" } });
      fireEvent.click(card.getByRole("button", { name: "حفظ الإضافات" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "حفظ الإضافات" }));

      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).not.toHaveProperty("extraStorageMb");
      expect(posts[0]!.extraSeats).toBe(3);
    });

    it("shows space approved while the owner edits other extras, never the figure the form opened with", async () => {
      let granted = 0;
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: { ...makeSummary({}, { extraStorageMb: granted }), plan: { ...plan, quotas: { storage_mb: 1024 } } } }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.change(card.getByLabelText("مستخدمون إضافيون"), { target: { value: "3" } });
      granted = 4096;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });

      await waitFor(() => expect(card.getByLabelText("مساحة إضافية للمرفقات (MB)")).toHaveValue(4096));
      expect(card.getByLabelText("مستخدمون إضافيون")).toHaveValue(3);
    });

    it("shows the stored extra storage, and says what the plan already includes — or that it has no cap", async () => {
      const capped = { ...makeSummary({}, { extraStorageMb: 5120 }), plan: { ...plan, quotas: { storage_mb: 1024 } } };
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: capped }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      expect(card.getByLabelText("مساحة إضافية للمرفقات (MB)")).toHaveValue(5120);
      expect(card.getByText("الباقة تشمل 1 GB")).toBeInTheDocument();
    });

    it("says the plan has no storage cap when the plan sets none", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      expect(extrasCard().getByText("الباقة بلا حد لمساحة المرفقات")).toBeInTheDocument();
    });

    it("blocks saving an extra storage figure above the limit, and disables the field for support", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: { ...makeSummary(), plan: { ...plan, quotas: { storage_mb: 1024 } } } }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.change(card.getByLabelText("مساحة إضافية للمرفقات (MB)"), { target: { value: "1048577" } });
      expect(card.getByRole("alert")).toHaveTextContent("1048576 MB");
      expect(card.getByRole("button", { name: "حفظ الإضافات" })).toBeDisabled();
    });

    it("leaves the extra storage field read-only for support", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary({}, { extraStorageMb: 1024 }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: supportSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      expect(extrasCard().getByLabelText("مساحة إضافية للمرفقات (MB)")).toBeDisabled();
    });

    it("select all adds every module the plan lacks, and an invalid count blocks saving", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.click(card.getByRole("button", { name: "تحديد الكل" }));
      expect(card.getByRole("button", { name: "المخزون" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.change(card.getByLabelText("فروع إضافية"), { target: { value: "" } });
      expect(card.getByRole("alert")).toHaveTextContent("الأعداد أرقام صحيحة من 0 إلى 10000، والمساحة الإضافية من 0 إلى 1048576 MB، وأيام السماح من 0 إلى 365");
      expect(card.getByRole("button", { name: "حفظ الإضافات" })).toBeDisabled();
      fireEvent.change(card.getByLabelText("فروع إضافية"), { target: { value: "0" } });
      fireEvent.change(card.getByLabelText("أيام السماح"), { target: { value: "400" } });
      expect(card.getByRole("button", { name: "حفظ الإضافات" })).toBeDisabled();
    });

    it("cancelling the confirmation sends nothing; a refusal is shown and keeps what was typed", async () => {
      const posts: unknown[] = [];
      let refuse = false;
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/subscription/extras": (init) => {
          posts.push(JSON.parse(String(init?.body)));
          return refuse ? { status: 422, body: { error: "INVALID_SUBSCRIPTION", message: "مرفوض من الخادم" } } : { body: makeSummary() };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.change(card.getByLabelText("مخازن إضافية"), { target: { value: "4" } });
      fireEvent.click(card.getByRole("button", { name: "حفظ الإضافات" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "رجوع" }));
      expect(posts).toEqual([]);

      refuse = true;
      fireEvent.click(card.getByRole("button", { name: "حفظ الإضافات" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "حفظ الإضافات" }));
      expect(await screen.findByText("مرفوض من الخادم")).toBeInTheDocument();
      expect(posts).toHaveLength(1);
      expect(card.getByLabelText("مخازن إضافية")).toHaveValue(4);

      fireEvent.click(card.getByRole("button", { name: "إلغاء" }));
      expect(screen.queryByText("مرفوض من الخادم")).not.toBeInTheDocument();
      expect(card.getByLabelText("مخازن إضافية")).toHaveValue(0);
    });

    it("select all sends only modules the plan lacks", async () => {
      const posts: Array<{ addOnModules: string[] }> = [];
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/subscription/extras": (init) => {
          posts.push(JSON.parse(String(init?.body)));
          return { body: makeSummary() };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.click(card.getByRole("button", { name: "تحديد الكل" }));
      fireEvent.click(card.getByRole("button", { name: "حفظ الإضافات" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "حفظ الإضافات" }));

      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]!.addOnModules).toContain("inventory");
      expect(posts[0]!.addOnModules).not.toContain("sales");
    });

    it("is read-only for an owner once the subscription is cancelled", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary({}, { status: SubscriptionStatusCode.Cancelled }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      expect(card.getByRole("button", { name: "المخزون" })).toBeDisabled();
      expect(card.queryByRole("button", { name: "حفظ الإضافات" })).not.toBeInTheDocument();
    });

    it("keeps unsaved extras when another action on the page refreshes the subscription", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "POST /tenants/tenant-1/subscription/anchor-day": () => ({ body: makeSummary({}, { billingAnchorDay: 15, updatedAt: "2026-09-02T00:00:00.000Z" }) }),
      });
      renderDetail({ transport, session: testPlatformSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      fireEvent.change(card.getByLabelText("مستخدمون إضافيون"), { target: { value: "7" } });

      fireEvent.change(screen.getByRole("spinbutton", { name: "يوم الفوترة من الشهر" }), { target: { value: "15" } });
      fireEvent.click(screen.getByRole("button", { name: "حفظ يوم الفوترة" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "حفظ يوم الفوترة" }));

      await waitFor(() => expect(screen.getByRole("spinbutton", { name: "يوم الفوترة من الشهر" })).toHaveValue(15));
      expect(card.getByLabelText("مستخدمون إضافيون")).toHaveValue(7);
      expect(card.getByRole("button", { name: "حفظ الإضافات" })).toBeEnabled();
    });

    it("is read-only for support", async () => {
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary({}, { addOnModules: ["inventory"] }) }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      renderDetail({ transport, session: supportSession });

      await screen.findByRole("heading", { name: "إضافات المنشأة" });
      const card = extrasCard();
      expect(card.getByRole("button", { name: "المخزون" })).toBeDisabled();
      expect(card.queryByRole("button", { name: "حفظ الإضافات" })).not.toBeInTheDocument();
    });
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

  it("offers a trialing tenant the tenant-level suspend, and says why the subscription one is absent", async () => {
    const summary = makeSummary({}, { status: SubscriptionStatusCode.Trialing });
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByRole("button", { name: "إيقاف المنشأة" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إيقاف الاشتراك" })).not.toBeInTheDocument();
    expect(screen.getByText(/الاشتراك في فترة التجربة فلا يُوقَف من هنا/)).toBeInTheDocument();
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
      "POST /tenants/tenant-1/owner-password/reset": () => ({
        body: { adminEmail: "owner@acme.test", signInEmail: "inbox@elsewhere.test", adminPassword: "Tmp-3059-17ab" },
      }),
    });
    renderDetail({ transport, session: testPlatformSession });

    expect(await screen.findByText("بريد المالك غير مؤكَّد")).toBeInTheDocument();
    expect(screen.getByText(/بريد دخول حساب المالك يختلف عن البريد المسجَّل هنا/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة تعيين كلمة مرور المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين كلمة مرور المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByText("Tmp-3059-17ab")).toBeInTheDocument();
    expect(screen.getByText("بريد الدخول الحالي للمالك")).toBeInTheDocument();
    expect(screen.getByText("inbox@elsewhere.test")).toBeInTheDocument();
  });

  it("shows no unverified mark and no second address for a verified owner", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-password/reset": () => ({ body: { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPassword: "Tmp-3059-17ab" } }),
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين كلمة مرور المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين كلمة مرور المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByText("Tmp-3059-17ab")).toBeInTheDocument();
    expect(screen.queryByText("بريد المالك غير مؤكَّد")).not.toBeInTheDocument();
    expect(screen.queryByText("بريد الدخول الحالي للمالك")).not.toBeInTheDocument();
  });

  it("resetting the owner's password asks first, then shows the new temporary password once with the owner's email", async () => {
    let resets = 0;
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-password/reset": () => {
        resets += 1;
        return { body: { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPassword: "Tmp-3059-17ab" } };
      },
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين كلمة مرور المالك" }));
    const dialog = await screen.findByRole("dialog", { name: "إعادة تعيين كلمة مرور المالك؟" });
    expect(resets).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "رجوع" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "إعادة تعيين كلمة مرور المالك؟" })).not.toBeInTheDocument());
    expect(resets).toBe(0);
    expect(screen.queryByText("Tmp-3059-17ab")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة تعيين كلمة مرور المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين كلمة مرور المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByText("Tmp-3059-17ab")).toBeInTheDocument();
    expect(screen.getByText("owner@acme.test")).toBeInTheDocument();
    expect(screen.getByText(/لن تظهر .* مرة أخرى/)).toBeInTheDocument();
    expect(resets).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "إخفاء كلمة المرور" }));
    await waitFor(() => expect(screen.queryByText("Tmp-3059-17ab")).not.toBeInTheDocument());
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
    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين كلمة مرور المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين كلمة مرور المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));
  }

  const LEAVE_DIALOG = "مغادرة الصفحة قبل تسليم كلمة المرور؟";

  it("still shows the new temporary password when the reset answers after the operator has left the page and come back, and never on another tenant's page", async () => {
    let answer: (response: TransportResponse) => void = () => undefined;
    const base = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /tenants/tenant-2": () => ({ body: makeSummary({ id: "tenant-2", code: "other", nameAr: "منشأة ثانية", ownerEmail: "owner@other.test" }) }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    const transport: Transport = (path, init) =>
      path === "/tenants/tenant-1/owner-password/reset" ? new Promise<TransportResponse>((resolve) => (answer = resolve)) : base(path, init);
    renderConsole(transport);
    await askForReset();

    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));
    const leaving = await screen.findByRole("dialog", { name: LEAVE_DIALOG });
    expect(screen.queryByRole("navigation", { name: "قائمة الاختبار" })).not.toBeInTheDocument();
    fireEvent.click(within(leaving).getByRole("button", { name: "غادر على أي حال" }));
    await screen.findByRole("navigation", { name: "قائمة الاختبار" });

    const body = { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPassword: "Tmp-3059-17ab" };
    await act(async () => {
      answer({ status: 200, ok: true, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)) });
    });
    fireEvent.click(screen.getByRole("link", { name: "افتح أكمي" }));

    expect(await screen.findByText("Tmp-3059-17ab")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: LEAVE_DIALOG })).getByRole("button", { name: "غادر على أي حال" }));
    fireEvent.click(await screen.findByRole("link", { name: "افتح الثانية" }));
    await screen.findByRole("heading", { name: "منشأة ثانية", level: 1 });
    expect(screen.queryByText("Tmp-3059-17ab")).not.toBeInTheDocument();
    expect(screen.queryByText(/لن تظهر .* مرة أخرى/)).not.toBeInTheDocument();
  });

  it("asks before leaving while the new temporary password has not been acknowledged, keeps it on staying, and lets go once it is hidden", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-password/reset": () => ({ body: { adminEmail: "owner@acme.test", signInEmail: "owner@acme.test", adminPassword: "Tmp-3059-17ab" } }),
    });
    renderConsole(transport);
    await askForReset();
    await screen.findByText("Tmp-3059-17ab");

    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: LEAVE_DIALOG })).getByRole("button", { name: "ابقَ في الصفحة" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument());
    expect(screen.getByText("Tmp-3059-17ab")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إخفاء كلمة المرور" }));
    await waitFor(() => expect(screen.queryByText("Tmp-3059-17ab")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("link", { name: /المنشآت/ }));

    await screen.findByRole("navigation", { name: "قائمة الاختبار" });
    expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "افتح أكمي" }));
    await screen.findByRole("heading", { name: "شركة أكمي", level: 1 });
    expect(screen.queryByText("Tmp-3059-17ab")).not.toBeInTheDocument();
  });

  it("shows the server's refusal when the owner's password cannot be reset, and no password", async () => {
    const summary = makeSummary();
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
      "POST /tenants/tenant-1/owner-password/reset": () => ({
        status: 409,
        body: { error: "TENANT_OWNER_ACCOUNT_NOT_FOUND", message: "لا يوجد في المنشأة حساب مدير نشط ببريد مالكها." },
      }),
    });
    renderDetail({ transport, session: testPlatformSession });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة تعيين كلمة مرور المالك" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "إعادة تعيين كلمة مرور المالك؟" })).getByRole("button", { name: "إعادة التعيين" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("لا يوجد في المنشأة حساب مدير نشط ببريد مالكها.");
  });

  it("does not offer the password reset to a support operator", async () => {
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: supportSession });

    await screen.findByText("باقة النمو — growth");
    expect(screen.queryByRole("button", { name: "إعادة تعيين كلمة مرور المالك" })).not.toBeInTheDocument();
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

  describe("«تسجيل دفعة» — a repeated reference is never reported as saved", () => {
    const ALREADY_RECORDED =
      'المرجع "REF-1" مسجَّل من قبل لهذه المنشأة بتاريخ 2026-09-15 بمبلغ 500.00 ج.م. إن كانت هذه دفعة أخرى فعلًا فأكِّد تسجيلها';
    const paymentRow = (id: string) => ({
      id, tenantId: "tenant-1", subscriptionId: "sub-1", amount: "500.00", currency: "EGP" as const, reference: "REF-1",
      paidAt: "2026-09-15T00:00:00.000Z", recordedBy: testPlatformSession.user.id, note: null, createdAt: "2026-09-15T00:00:00.000Z",
    });

    interface Posted {
      readonly amount: string;
      readonly reference: string;
      readonly idempotencyKey: string;
      readonly confirmDuplicateReference?: boolean;
    }

    function console_(respond: (body: Posted, attempt: number) => { status: number; body: unknown } | "network-failure") {
      const posts: Posted[] = [];
      const recorded: ReturnType<typeof paymentRow>[] = [];
      const summary = () => ({ ...makeSummary(), payments: recorded });
      const stub = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: summary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
      });
      const transport: typeof stub = (path, init) => {
        if (path !== "/tenants/tenant-1/payments" || init?.method !== "POST") return stub(path, init);
        const body = JSON.parse(String(init.body)) as Posted;
        posts.push(body);
        const answer = respond(body, posts.length);
        if (answer === "network-failure") return Promise.reject(new Error("network down"));
        if (answer.status === 201) recorded.push(paymentRow(`pay-${recorded.length + 1}`));
        const payload = answer.status === 201 || answer.status === 200 ? summary() : answer.body;
        return Promise.resolve({
          status: answer.status,
          ok: answer.status < 400,
          json: <T,>() => Promise.resolve(payload as T),
          text: () => Promise.resolve(JSON.stringify(payload)),
        });
      };
      renderDetail({ transport, session: testPlatformSession });
      return { posts, recorded };
    }

    async function fillAndSubmit(reference = "REF-1") {
      fireEvent.click(await screen.findByRole("button", { name: "تسجيل دفعة" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("المرجع"), { target: { value: reference } });
      const amountInput = within(dialog).getByLabelText("المبلغ");
      fireEvent.focus(amountInput);
      fireEvent.change(amountInput, { target: { value: "500" } });
      fireEvent.blur(amountInput);
      fireEvent.click(within(dialog).getByRole("button", { name: "تسجيل الدفعة" }));
      return dialog;
    }

    const refusal = { status: 409, body: { error: "PAYMENT_REFERENCE_ALREADY_RECORDED", message: ALREADY_RECORDED } };

    it("says when the reference was recorded, keeps the form open, and records nothing until the operator confirms", async () => {
      const t = console_((body) => (body.confirmDuplicateReference ? { status: 201, body: null } : refusal));

      const dialog = await fillAndSubmit();

      expect(await within(dialog).findByText(ALREADY_RECORDED)).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(t.recorded).toHaveLength(0);
      expect(within(dialog).queryByRole("button", { name: "تسجيل الدفعة" })).not.toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: "نعم، دفعة أخرى — سجِّلها" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(t.recorded).toHaveLength(1);
      expect(t.posts.map((post) => post.confirmDuplicateReference === true)).toEqual([false, true]);
      expect(t.posts[1]!.idempotencyKey).toBe(t.posts[0]!.idempotencyKey);
    });

    it("drops the confirmation when the operator changes the reference after the warning", async () => {
      const t = console_((body) => (body.reference === "REF-1" ? refusal : { status: 201, body: null }));
      const dialog = await fillAndSubmit();
      await within(dialog).findByText(ALREADY_RECORDED);

      fireEvent.change(within(dialog).getByLabelText("المرجع"), { target: { value: "REF-2" } });

      expect(within(dialog).queryByText(ALREADY_RECORDED)).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "تسجيل الدفعة" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(t.posts[1]).toMatchObject({ reference: "REF-2" });
      expect(t.posts[1]!.confirmDuplicateReference).not.toBe(true);
    });

    it("resends the same key when a submission failed on the way, so the retry cannot become a second payment", async () => {
      const t = console_((_body, attempt) => (attempt === 1 ? "network-failure" : { status: 201, body: null }));

      const dialog = await fillAndSubmit();
      expect(await within(dialog).findByText("تعذّر تسجيل الدفعة.")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "تسجيل الدفعة" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(t.posts).toHaveLength(2);
      expect(t.posts[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(t.posts[1]!.idempotencyKey).toBe(t.posts[0]!.idempotencyKey);
    });

    it("mints a new key for the next payment, so two genuine payments are two submissions", async () => {
      const t = console_(() => ({ status: 201, body: null }));

      await fillAndSubmit("REF-1");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await fillAndSubmit("REF-2");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      expect(t.posts).toHaveLength(2);
      expect(t.posts[1]!.idempotencyKey).not.toBe(t.posts[0]!.idempotencyKey);
      expect(t.recorded).toHaveLength(2);
    });
  });

  describe("card checkouts — operator actions", () => {
    const unapplied: CardCheckoutDTO = {
      id: "chk-1", tenantId: "tenant-1", subscriptionId: "sub-1", provider: "paymob", testMode: false, amount: "500.000000",
      currency: "EGP", status: "unapplied", checkoutUrl: null, providerRef: "574588", paymentId: null, failureReason: "AMOUNT_MISMATCH",
      capturedAmount: "480.500000", requestedBy: "tenant:acme:u1", attentionCause: null, resolution: null, resolvedAt: null, resolvedBy: null,
      resolutionReason: null, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z",
    };
    const expired: CardCheckoutDTO = { ...unapplied, id: "chk-2", status: "failed", providerRef: null, failureReason: "EXPIRED", capturedAmount: null };
    const flagged: CardCheckoutDTO = { ...expired, id: "chk-3", status: "pending", failureReason: "NEEDS_ATTENTION", attentionCause: "UNREADABLE" };
    const AMOUNT = "المبلغ المحصَّل فعلًا (جنيه)";
    const REASON = "سبب التطبيق اليدوي";
    const OVERRIDE = "أؤكّد تسجيل مبلغ يختلف عمّا سجّله مزوّد الدفع";
    const OVERRIDE_ERROR = "المبلغ يختلف عمّا سجّله مزوّد الدفع. أكّد التجاوز أو أعِد المبلغ كما هو.";
    const AMOUNT_ERROR = "أدخل مبلغًا أكبر من صفر بحد أقصى خانتين عشريتين.";

    function checkoutsTransport(handlers: Parameters<typeof stubPlatformTransport>[0] = {}, checkouts: CardCheckoutDTO[] = [unapplied]) {
      return stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "GET /tenants/tenant-1/card-checkouts": () => ({ body: { cardCheckout: true, testMode: false, checkouts } }),
        ...handlers,
      });
    }

    async function openDialog(checkouts: CardCheckoutDTO[] = [unapplied]) {
      const posted: unknown[] = [];
      const transport = checkoutsTransport(
        {
          "POST /tenants/tenant-1/card-checkouts/chk-1/apply": (init) => {
            posted.push(JSON.parse(String(init?.body)));
            return { body: { ...unapplied, status: "paid" } };
          },
        },
        checkouts,
      );
      renderDetail({ transport, session: testPlatformSession });
      fireEvent.click(await screen.findByRole("button", { name: "تطبيق على الاشتراك" }));
      const dialog = screen.getByRole("dialog");
      const type = (label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
      const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: "تطبيق الدفعة" }));
      return { dialog, posted, type, submit };
    }

    it("applies the amount the provider recorded, sending only the reason", async () => {
      const { dialog, posted, type, submit } = await openDialog();

      expect(within(dialog).getByLabelText(AMOUNT)).toHaveValue("480.50");
      expect(within(dialog).getByText("سجّل مزوّد الدفع تحصيل 480.50. المتوقع كان 500.00.")).toBeInTheDocument();
      expect(within(dialog).queryByRole("switch", { name: OVERRIDE })).not.toBeInTheDocument();
      type(REASON, "  طابقت كشف البنك  ");
      submit();

      await waitFor(() => expect(posted).toEqual([{ reason: "طابقت كشف البنك" }]));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("reads Arabic-Indic digits as the same amount", async () => {
      const { posted, type, submit } = await openDialog();

      type(AMOUNT, "٤٨٠٫٥٠");
      type(REASON, "طابقت كشف البنك");
      submit();

      await waitFor(() => expect(posted).toEqual([{ reason: "طابقت كشف البنك" }]));
    });

    it("refuses a different amount until the override is confirmed, then sends it as an override", async () => {
      const { dialog, posted, type, submit } = await openDialog();

      type(AMOUNT, "500");
      type(REASON, "طابقت كشف البنك");
      submit();
      expect(await within(dialog).findByText(OVERRIDE_ERROR)).toBeInTheDocument();
      expect(posted).toEqual([]);

      fireEvent.click(within(dialog).getByRole("switch", { name: OVERRIDE }));
      submit();

      await waitFor(() => expect(posted).toEqual([{ amount: "500", overrideAmount: true, reason: "طابقت كشف البنك" }]));
    });

    it("asks for the amount and the override when the provider recorded none", async () => {
      const { dialog, posted, type, submit } = await openDialog([{ ...unapplied, capturedAmount: null }]);

      expect(within(dialog).getByLabelText(AMOUNT)).toHaveValue("");
      type(REASON, "طابقت كشف البنك");
      submit();
      expect(await within(dialog).findByText(AMOUNT_ERROR)).toBeInTheDocument();

      type(AMOUNT, "480.50");
      fireEvent.click(within(dialog).getByRole("switch", { name: OVERRIDE }));
      submit();

      await waitFor(() => expect(posted).toEqual([{ amount: "480.50", overrideAmount: true, reason: "طابقت كشف البنك" }]));
    });

    it.each([
      ["no reason", "480.50", "", "اكتب سبب التطبيق اليدوي (ثلاثة أحرف على الأقل)."],
      ["a zero amount", "0.00", "طابقت كشف البنك", AMOUNT_ERROR],
      ["an amount that is not a number", "12,5", "طابقت كشف البنك", AMOUNT_ERROR],
      ["three decimal places", "480.505", "طابقت كشف البنك", AMOUNT_ERROR],
      ["a negative amount", "-480.50", "طابقت كشف البنك", AMOUNT_ERROR],
    ])("refuses %s before anything is posted", async (_label, amount, reason, message) => {
      const { dialog, posted, type, submit } = await openDialog();

      type(AMOUNT, amount);
      type(REASON, reason);
      submit();

      expect(await within(dialog).findByText(message)).toBeInTheDocument();
      expect(posted).toEqual([]);
    });

    it("keeps the dialog open and shows the server's refusal", async () => {
      const transport = checkoutsTransport({
        "POST /tenants/tenant-1/card-checkouts/chk-1/apply": () => ({
          status: 409,
          body: { error: "CARD_PAYMENT_NOT_APPLICABLE", message: "تعذّر تطبيق دفعة البطاقة: المرجع مسجَّل كدفعة من قبل" },
        }),
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "تطبيق على الاشتراك" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(REASON), { target: { value: "طابقت كشف البنك" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "تطبيق الدفعة" }));

      expect(await within(dialog).findByText("تعذّر تطبيق دفعة البطاقة: المرجع مسجَّل كدفعة من قبل")).toBeInTheDocument();
    });

    it("offers neither action to a support operator, and names why a checkout expired or needs review", async () => {
      renderDetail({ transport: checkoutsTransport({}, [unapplied, expired, flagged]), session: supportSession });

      expect(await screen.findByText(/انتهت المهلة دون أن يؤكّد مزوّد الدفع أي عملية/)).toBeInTheDocument();
      expect(screen.getByText(/تحتاج مراجعة: ردّ مزوّد الدفع عن هذه العملية غير مقروء/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "البتّ في العملية" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تطبيق على الاشتراك" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "مطابقة العمليات المعلّقة مع Paymob" })).not.toBeInTheDocument();
    });

    it("shows one apply button per unapplied checkout only", async () => {
      renderDetail({ transport: checkoutsTransport({}, [unapplied, expired, flagged]), session: testPlatformSession });

      expect(await screen.findAllByRole("button", { name: "تطبيق على الاشتراك" })).toHaveLength(1);
    });

    it("offers no apply action while the subscription cannot be renewed, says why, and offers it once it can", async () => {
      const stranded: CardCheckoutDTO = { ...unapplied, id: "chk-5", failureReason: "SUBSCRIPTION_NOT_RENEWABLE" };
      const cancelledSummary = makeSummary({}, { status: SubscriptionStatusCode.Cancelled });
      const first = renderDetail({
        transport: checkoutsTransport({ "GET /tenants/tenant-1": () => ({ body: cancelledSummary }) }, [stranded]),
        session: testPlatformSession,
      });

      expect(await screen.findByText("الاشتراك لا يقبل التجديد الآن — أعد تفعيله أولًا ثم طبِّق الدفعة")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تطبيق على الاشتراك" })).not.toBeInTheDocument();
      first.unmount();

      renderDetail({ transport: checkoutsTransport({}, [stranded]), session: testPlatformSession });
      expect(await screen.findByRole("button", { name: "تطبيق على الاشتراك" })).toBeInTheDocument();
    });

    it("names a payment whose reference is already recorded, and offers no apply action the server would refuse", async () => {
      const recorded: CardCheckoutDTO = { ...unapplied, id: "chk-4", failureReason: "REFERENCE_ALREADY_RECORDED" };
      renderDetail({ transport: checkoutsTransport({}, [recorded]), session: testPlatformSession });

      expect(await screen.findByText(/مرجع هذه العملية مسجَّل كدفعة من قبل/)).toBeInTheDocument();
      expect(screen.getByText("مسجَّلة كدفعة — لا تحتاج تطبيقًا")).toBeInTheDocument();
      expect(screen.queryByText(/سبب غير معروف/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تطبيق على الاشتراك" })).not.toBeInTheDocument();
    });

    describe("a flagged checkout", () => {
      const RESOLVE = "البتّ في العملية";
      const DECISION_REASON = "سبب القرار";
      const refundFlag: CardCheckoutDTO = { ...flagged, id: "chk-6", attentionCause: "REFUND" };
      const voidFlag: CardCheckoutDTO = { ...flagged, id: "chk-7", attentionCause: "VOID" };

      function resolving(checkouts: CardCheckoutDTO[] = [flagged], answer: () => { status?: number; body: unknown } = () => ({ body: { ...flagged, resolution: "REVIEWED" } })) {
        const posted: { path: string; body: unknown }[] = [];
        const handler = (init: RequestInit | undefined, path: string) => {
          posted.push({ path, body: JSON.parse(String(init?.body)) });
          return answer();
        };
        const transport = checkoutsTransport(
          Object.fromEntries(checkouts.map((c) => [`POST /tenants/tenant-1/card-checkouts/${c.id}/resolve`, handler])),
          checkouts,
        );
        return { posted, transport };
      }

      async function decide(dialog: HTMLElement, choice: string, reason = "راجعت لوحة بيموب") {
        fireEvent.click(within(dialog).getByRole("radio", { name: choice }));
        fireEvent.change(within(dialog).getByLabelText(DECISION_REASON), { target: { value: reason } });
      }

      it("says in Arabic whether the provider shows a refund, a void or an answer that could not be read", async () => {
        renderDetail({ transport: checkoutsTransport({}, [flagged, refundFlag, voidFlag]), session: testPlatformSession });

        expect(await screen.findByText(/آخر حركة على هذا الطلب لدى مزوّد الدفع استرداد/)).toBeInTheDocument();
        expect(screen.getByText(/آخر حركة على هذا الطلب لدى مزوّد الدفع إلغاء قبل التسوية/)).toBeInTheDocument();
        expect(screen.getByText(/ردّ مزوّد الدفع عن هذه العملية غير مقروء/)).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: RESOLVE })).toHaveLength(3);
      });

      it("marks a checkout reviewed only after the owner confirms what that does", async () => {
        const { posted, transport } = resolving();
        renderDetail({ transport, session: testPlatformSession });

        fireEvent.click(await screen.findByRole("button", { name: RESOLVE }));
        const dialog = screen.getByRole("dialog");
        await decide(dialog, "رُوجعت ولا يلزم إجراء");
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));

        expect(within(dialog).getByText(/يتوقف سؤال مزوّد الدفع عن هذه العملية/)).toBeInTheDocument();
        expect(posted).toEqual([]);

        fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد القرار" }));

        await waitFor(() => expect(posted).toEqual([
          { path: "/tenants/tenant-1/card-checkouts/chk-3/resolve", body: { resolution: "REVIEWED", reason: "راجعت لوحة بيموب" } },
        ]));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });

      it("records a refund, and sends the transaction number and amount of a payment applied by hand", async () => {
        const { posted, transport } = resolving([refundFlag, flagged]);
        renderDetail({ transport, session: testPlatformSession });

        fireEvent.click((await screen.findAllByRole("button", { name: RESOLVE }))[0]!);
        let dialog = screen.getByRole("dialog");
        await decide(dialog, "تسجيلها كمستردّة", "رُدّ المبلغ من لوحة بيموب");
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));
        expect(within(dialog).getByText(/تُغلق العملية كمستردّة ولا تُجدِّد الاشتراك/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد القرار" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        fireEvent.click(screen.getAllByRole("button", { name: RESOLVE })[1]!);
        dialog = screen.getByRole("dialog");
        await decide(dialog, "تطبيق الدفعة يدويًا على الاشتراك", "الدفعة ظاهرة في لوحة بيموب");
        fireEvent.change(within(dialog).getByLabelText("رقم العملية في لوحة Paymob"), { target: { value: "٥٧٤٥٨٨" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));
        expect(within(dialog).getByText(/يجدّد اشتراك المنشأة فترة واحدة/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد القرار" }));

        await waitFor(() => expect(posted.map((p) => p.body)).toEqual([
          { resolution: "REFUNDED", reason: "رُدّ المبلغ من لوحة بيموب" },
          { resolution: "APPLIED_BY_HAND", reason: "الدفعة ظاهرة في لوحة بيموب", providerRef: "574588", amount: "500.00" },
        ]));
      });

      it("asks for the override before sending an amount other than the checkout's", async () => {
        const { posted, transport } = resolving();
        renderDetail({ transport, session: testPlatformSession });

        fireEvent.click(await screen.findByRole("button", { name: RESOLVE }));
        const dialog = screen.getByRole("dialog");
        await decide(dialog, "تطبيق الدفعة يدويًا على الاشتراك");
        fireEvent.change(within(dialog).getByLabelText("رقم العملية في لوحة Paymob"), { target: { value: "574588" } });
        fireEvent.change(within(dialog).getByLabelText("المبلغ المحصَّل كما في لوحة Paymob (جنيه)"), { target: { value: "480.50" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));
        expect(within(dialog).getByText("المبلغ يختلف عن قيمة عملية الدفع. أكّد التجاوز أو أعِد المبلغ كما هو.")).toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole("switch", { name: "أؤكّد تسجيل مبلغ يختلف عن قيمة عملية الدفع" }));
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));
        fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد القرار" }));

        await waitFor(() => expect(posted.map((p) => p.body)).toEqual([
          { resolution: "APPLIED_BY_HAND", reason: "راجعت لوحة بيموب", providerRef: "574588", amount: "480.50", overrideAmount: true },
        ]));
      });

      it.each([
        ["no decision", async () => undefined, "اختر القرار أولًا."],
        ["no reason", async (dialog: HTMLElement) => decide(dialog, "رُوجعت ولا يلزم إجراء", "  "), "اكتب سبب القرار (ثلاثة أحرف على الأقل)."],
        ["no transaction number", async (dialog: HTMLElement) => decide(dialog, "تطبيق الدفعة يدويًا على الاشتراك"), "أدخل رقم العملية كما يظهر في لوحة Paymob (أرقام فقط)."],
      ])("does not go on to the confirmation with %s", async (_label, fill, message) => {
        const { posted, transport } = resolving();
        renderDetail({ transport, session: testPlatformSession });

        fireEvent.click(await screen.findByRole("button", { name: RESOLVE }));
        const dialog = screen.getByRole("dialog");
        await fill(dialog);
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));

        expect(within(dialog).getByText(message)).toBeInTheDocument();
        expect(within(dialog).queryByRole("button", { name: "تأكيد القرار" })).not.toBeInTheDocument();
        expect(posted).toEqual([]);
      });

      it("does not offer applying by hand while the subscription cannot be renewed", async () => {
        const cancelledSummary = makeSummary({}, { status: SubscriptionStatusCode.Cancelled });
        renderDetail({ transport: checkoutsTransport({ "GET /tenants/tenant-1": () => ({ body: cancelledSummary }) }, [flagged]), session: testPlatformSession });

        fireEvent.click(await screen.findByRole("button", { name: RESOLVE }));
        const dialog = screen.getByRole("dialog");

        expect(within(dialog).getByRole("radio", { name: "تطبيق الدفعة يدويًا على الاشتراك" })).toBeDisabled();
        expect(within(dialog).getByText("الاشتراك لا يقبل التجديد الآن — أعد تفعيله أولًا ثم طبِّق الدفعة")).toBeInTheDocument();
      });

      it("keeps the dialog open and shows the server's refusal", async () => {
        const { transport } = resolving([flagged], () => ({
          status: 409,
          body: { error: "CARD_PAYMENT_NOT_APPLICABLE", message: "تعذّر تطبيق دفعة البطاقة: عملية الدفع ليست معلّقة للمراجعة، أو سبق البتّ فيها" },
        }));
        renderDetail({ transport, session: testPlatformSession });

        fireEvent.click(await screen.findByRole("button", { name: RESOLVE }));
        const dialog = screen.getByRole("dialog");
        await decide(dialog, "رُوجعت ولا يلزم إجراء");
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));
        fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد القرار" }));

        expect(await within(dialog).findByText(/عملية الدفع ليست معلّقة للمراجعة، أو سبق البتّ فيها/)).toBeInTheDocument();
      });

      it("marks only the row being saved as busy, and frees it when the save fails", async () => {
        let answer: (response: { status: number; ok: boolean; json: <T>() => Promise<T>; text: () => Promise<string> }) => void = () => undefined;
        const base = checkoutsTransport({}, [flagged, refundFlag]);
        const transport: typeof base = (path, init) =>
          init?.method === "POST" && path.endsWith("/resolve") ? new Promise((resolve) => { answer = resolve; }) : base(path, init);
        renderDetail({ transport, session: testPlatformSession });

        fireEvent.click((await screen.findAllByRole("button", { name: RESOLVE }))[0]!);
        const dialog = screen.getByRole("dialog");
        await decide(dialog, "رُوجعت ولا يلزم إجراء");
        fireEvent.click(within(dialog).getByRole("button", { name: "متابعة" }));
        fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد القرار" }));

        const busy = await screen.findByRole("button", { name: "جارٍ حفظ القرار…" });
        expect(busy).toBeDisabled();
        expect(screen.getAllByRole("button", { name: RESOLVE })).toHaveLength(1);
        expect(screen.getByRole("button", { name: RESOLVE })).toBeEnabled();

        const body = { error: "AUDIT_UNAVAILABLE", message: "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى." };
        answer({ status: 503, ok: false, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)) });

        await waitFor(() => expect(screen.getAllByRole("button", { name: RESOLVE })).toHaveLength(2));
        expect(screen.queryByRole("button", { name: "جارٍ حفظ القرار…" })).not.toBeInTheDocument();
      });

      it("shows what was decided, by whom and why, and offers no second decision", async () => {
        const reviewed: CardCheckoutDTO = { ...flagged, resolution: "REVIEWED", resolvedAt: "2026-09-12T00:00:00.000Z", resolvedBy: "PU-1", resolutionReason: "لا توجد عملية في اللوحة" };
        const refunded: CardCheckoutDTO = { ...refundFlag, status: "refunded", resolution: "REFUNDED", resolvedAt: "2026-09-12T00:00:00.000Z", resolvedBy: "PU-1", resolutionReason: "رُدّ المبلغ" };
        renderDetail({ transport: checkoutsTransport({}, [reviewed, refunded]), session: testPlatformSession });

        expect(await screen.findByText(/رُوجعت ولا يلزم إجراء — لا توجد عملية في اللوحة/)).toBeInTheDocument();
        expect(screen.getByText(/سُجّلت كمستردّة — رُدّ المبلغ/)).toBeInTheDocument();
        expect(screen.getByText("مستردّة")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: RESOLVE })).not.toBeInTheDocument();
      });
    });

    const tally = {
      examined: 9, paid: 1, declined: 0, unapplied: 0, expired: 1, stillPending: 1, alreadySettled: 2,
      needsAttention: 0, unavailable: 0, failed: 0, deferred: 0,
    };

    it("runs the sweep and reports every count, with no warning lines when nothing went wrong", async () => {
      let sweeps = 0;
      const transport = checkoutsTransport({
        "POST /card-checkouts/sweep": () => {
          sweeps += 1;
          return { body: tally };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "مطابقة العمليات المعلّقة مع Paymob" }));

      const outcome = await screen.findByRole("status");
      expect(outcome).toHaveTextContent("رُوجعت 9 عملية: مدفوعة 1، مرفوضة 0، غير مطبّقة 0، منتهية 1، ما زالت معلّقة 1، سبق تسويتها 2.");
      expect(outcome.querySelectorAll("p")).toHaveLength(1);
      expect(sweeps).toBe(1);
    });

    it("says what the sweep could not ask, could not read and did not reach", async () => {
      const transport = checkoutsTransport({
        "POST /card-checkouts/sweep": () => ({ body: { ...tally, needsAttention: 2, unavailable: 3, failed: 1, deferred: 4 } }),
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "مطابقة العمليات المعلّقة مع Paymob" }));

      expect(await screen.findByText("2 عملية لم يتأكّد مصيرها لدى مزوّد الدفع (استرداد، إلغاء، أو ردّ غير مقروء) وتحتاج البتّ فيها من صفحة منشأتها.")).toBeInTheDocument();
      expect(screen.getByText("تعذّر سؤال مزوّد الدفع عن 3 عملية وفشلت تسوية 1، فتُركت كما هي.")).toBeInTheDocument();
      expect(screen.getByText("4 عملية لم يصلها الدور في هذه المرة وتُراجَع في المطابقة التالية.")).toBeInTheDocument();
    });

    it("shows the server's message when a sweep is already running", async () => {
      const transport = checkoutsTransport({
        "POST /card-checkouts/sweep": () => ({
          status: 409,
          body: { error: "CARD_CHECKOUT_SWEEP_RUNNING", message: "مطابقة العمليات المعلّقة جارية بالفعل، انتظر انتهاءها ثم أعد المحاولة" },
        }),
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "مطابقة العمليات المعلّقة مع Paymob" }));

      expect(await screen.findByText("مطابقة العمليات المعلّقة جارية بالفعل، انتظر انتهاءها ثم أعد المحاولة")).toBeInTheDocument();
    });
  });

  describe("accounts locked out of sign-in", () => {
    function lockedTransport(session: PlatformSession, respond: (account: string) => { status?: number; body: unknown } = () => ({ body: { accounts: ["cashier@acme.test"] } })) {
      const asked: string[] = [];
      const unlocked: string[] = [];
      const transport = stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "GET /tenants/tenant-1/locked-accounts": () => {
          asked.push("list");
          return { body: { accounts: ["cashier@acme.test", "owner@acme.test"] } };
        },
        "POST /tenants/tenant-1/unlock-account": (init) => {
          const { account } = JSON.parse(String(init?.body)) as { account: string };
          unlocked.push(account);
          return respond(account);
        },
      });
      renderDetail({ transport, session });
      return { asked, unlocked };
    }

    it("lists them for the platform owner and unlocks the one confirmed, leaving the others listed", async () => {
      const t = lockedTransport(testPlatformSession);

      const row = (await screen.findByText("owner@acme.test")).closest("li")!;
      fireEvent.click(within(row).getByRole("button", { name: "فكّ القفل" }));
      const dialog = await screen.findByRole("dialog", { name: "فكّ قفل هذا الحساب؟" });
      expect(dialog).toHaveTextContent("owner@acme.test");
      expect(t.unlocked).toEqual([]);
      fireEvent.click(within(dialog).getByRole("button", { name: "فكّ القفل" }));

      await waitFor(() => expect(screen.queryByText("owner@acme.test")).not.toBeInTheDocument());
      expect(t.unlocked).toEqual(["owner@acme.test"]);
      expect(screen.getByText("cashier@acme.test")).toBeInTheDocument();
    });

    it("shows the server's Arabic refusal when the unlock cannot be recorded, and keeps the account listed", async () => {
      lockedTransport(testPlatformSession, () => ({ status: 503, body: { error: "AUDIT_UNAVAILABLE", message: "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى." } }));

      const row = (await screen.findByText("owner@acme.test")).closest("li")!;
      fireEvent.click(within(row).getByRole("button", { name: "فكّ القفل" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "فكّ القفل" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تسجيل العملية في سجل التدقيق");
      expect(screen.getByText("owner@acme.test")).toBeInTheDocument();
    });

    it("is not asked for, and not shown, to a support operator", async () => {
      const t = lockedTransport({ ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" } });

      await screen.findByText("شركة أكمي");

      expect(t.asked).toEqual([]);
      expect(screen.queryByText("حسابات مقفلة عن الدخول")).not.toBeInTheDocument();
    });
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
        await screen.findByText("بريد دخول حساب المالك يختلف عن البريد المسجَّل هنا، ولم يثبت بعد أن المالك نفسه هو من غيّره. يبقى البريد المسجَّل كما هو حتى يسجّل المالك دخوله بكلمة مروره، أو تؤكّد أنت مالك المنشأة من هنا."),
      ).toBeInTheDocument();
    });
  });

  describe("the company's books", () => {
    const admins = [
      { id: "U-1", nameAr: "سارة المالكة", email: "owner@acme.test" },
      { id: "U-2", nameAr: "خالد المدير", email: "second@acme.test" },
    ];
    const withBooks = (books: TenantBooksStanding, overrides: Partial<TenantSummaryDTO["tenant"]> = {}): TenantSummaryDTO => ({ ...makeSummary(overrides), books });

    function booksTransport(start: TenantBooksStanding, posts: { route: string; body: unknown }[] = [], lockedAsked: string[] = []) {
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
        "GET /tenants/tenant-1/locked-accounts": () => {
          lockedAsked.push(standing);
          return { body: { accounts: ["cashier@acme.test"] } };
        },
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

    const REASON = "دفاتر هذه المنشأة لا تُفتح الآن، فلا يُعيَّن لها مالك ولا تُعاد تعيين كلمة مروره حتى تعود دفاترها إلى مكانها.";

    it.each([TenantBooksStanding.Disowned, TenantBooksStanding.Foreign, TenantBooksStanding.Missing, TenantBooksStanding.Unreadable])(
      "does not offer to assign an owner or reset the owner's password while the books are %s, and says why in Arabic",
      async (standing) => {
        renderDetail({ transport: booksTransport(standing), session: testPlatformSession });

        const assign = await screen.findByRole("button", { name: "تعيين مالك" });
        const reset = screen.getByRole("button", { name: "إعادة تعيين كلمة مرور المالك" });
        expect(assign).toBeDisabled();
        expect(reset).toBeDisabled();
        expect(assign).toHaveAccessibleDescription(REASON);
        expect(reset).toHaveAccessibleDescription(REASON);
        expect(screen.getByText(REASON)).toBeVisible();
      },
    );

    it.each([TenantBooksStanding.Disowned, TenantBooksStanding.Foreign, TenantBooksStanding.Missing, TenantBooksStanding.Unreadable])(
      "does not ask for the accounts locked out of sign-in while the books are %s: they cannot be opened to answer",
      async (standing) => {
        const lockedAsked: string[] = [];
        renderDetail({ transport: booksTransport(standing, [], lockedAsked), session: testPlatformSession });

        expect(await screen.findByText(REASON)).toBeVisible();
        expect(lockedAsked).toEqual([]);
      },
    );

    it("takes the locked accounts off the page once the books are disowned: an unlock would be refused", async () => {
      const lockedAsked: string[] = [];
      renderDetail({ transport: booksTransport(TenantBooksStanding.Unbound, [], lockedAsked), session: testPlatformSession });
      expect(await screen.findByText("cashier@acme.test")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "ليست دفاتر هذه المنشأة" }));
      const dialog = await screen.findByRole("dialog", { name: "إيقاف العمل على هذه الدفاتر؟" });
      fireEvent.click(within(dialog).getByRole("button", { name: "إيقاف العمل عليها" }));

      expect(await screen.findByText(REASON)).toBeVisible();
      expect(screen.queryByText("cashier@acme.test")).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("دفاتر موقوفة")).toBeInTheDocument());
      expect(lockedAsked).toEqual([TenantBooksStanding.Unbound]);
    });

    it("asks for the accounts locked out of sign-in while the books are served", async () => {
      const lockedAsked: string[] = [];
      renderDetail({ transport: booksTransport(TenantBooksStanding.Unbound, [], lockedAsked), session: testPlatformSession });

      await waitFor(() => expect(lockedAsked).toEqual([TenantBooksStanding.Unbound]));
    });

    it.each([TenantBooksStanding.Unbound, TenantBooksStanding.Bound])("offers to assign an owner and to reset the owner's password while the books are %s", async (standing) => {
      renderDetail({ transport: booksTransport(standing), session: testPlatformSession });

      expect(await screen.findByRole("button", { name: "تعيين مالك" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "إعادة تعيين كلمة مرور المالك" })).toBeEnabled();
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

describe("TenantDetailPage — HR parts", () => {
  it("names a licensed HR part under its module", async () => {
    const summary = { ...makeSummary(), entitlements: { ...entitlementsFixture, activeModules: ["sales", "hr.time"] } };
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1": () => ({ body: summary }),
      "GET /plans": () => ({ body: [plan, plan2] }),
    });
    renderDetail({ transport, session: testPlatformSession });
    expect(await screen.findByText("الموارد البشرية — الدوام والإجازات")).toBeInTheDocument();
  });
});
