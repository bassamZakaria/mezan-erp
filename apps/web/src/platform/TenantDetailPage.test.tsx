// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import type { CardCheckoutDTO, PlanDTO, TenantSummaryDTO } from "@mezan/contracts";
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
    expect(await screen.findByRole("alert")).toHaveTextContent("تحقق من الحقول المدخلة.");
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
    const summary = makeSummary({}, { status: "suspended" });
    const resumed = { ...summary.subscription!, status: "active" as const };
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

  describe("card checkouts — operator actions", () => {
    const unapplied: CardCheckoutDTO = {
      id: "chk-1", tenantId: "tenant-1", subscriptionId: "sub-1", provider: "paymob", testMode: false, amount: "500.000000",
      currency: "EGP", status: "unapplied", checkoutUrl: null, providerRef: "574588", paymentId: null, failureReason: "AMOUNT_MISMATCH",
      requestedBy: "tenant:acme:u1", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z",
    };
    const expired: CardCheckoutDTO = { ...unapplied, id: "chk-2", status: "failed", providerRef: null, failureReason: "EXPIRED" };

    function checkoutsTransport(handlers: Parameters<typeof stubPlatformTransport>[0] = {}, checkouts: CardCheckoutDTO[] = [unapplied]) {
      return stubPlatformTransport({
        "GET /tenants/tenant-1": () => ({ body: makeSummary() }),
        "GET /plans": () => ({ body: [plan, plan2] }),
        "GET /tenants/tenant-1/card-checkouts": () => ({ body: { cardCheckout: true, testMode: false, checkouts } }),
        ...handlers,
      });
    }

    it("applies an unapplied payment with the amount and reason the owner typed", async () => {
      let posted: unknown = null;
      const transport = checkoutsTransport({
        "POST /tenants/tenant-1/card-checkouts/chk-1/apply": (init) => {
          posted = JSON.parse(String(init?.body));
          return { body: { ...unapplied, status: "paid" } };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "تطبيق على الاشتراك" }));
      const dialog = screen.getByRole("dialog");
      const amount = within(dialog).getByLabelText("المبلغ المحصَّل فعلًا (جنيه)");
      expect(amount).toHaveValue("500.00");
      fireEvent.change(amount, { target: { value: "480.50" } });
      fireEvent.change(within(dialog).getByLabelText("سبب التطبيق اليدوي"), { target: { value: "  طابقت كشف البنك  " } });
      fireEvent.click(within(dialog).getByRole("button", { name: "تطبيق الدفعة" }));

      await waitFor(() => expect(posted).toEqual({ amount: "480.50", reason: "طابقت كشف البنك" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it.each([
      ["no reason", "480.50", "", "اكتب سبب التطبيق اليدوي (ثلاثة أحرف على الأقل)."],
      ["a zero amount", "0.00", "طابقت كشف البنك", "أدخل مبلغًا أكبر من صفر بحد أقصى خانتين عشريتين."],
      ["an amount that is not a number", "12,5", "طابقت كشف البنك", "أدخل مبلغًا أكبر من صفر بحد أقصى خانتين عشريتين."],
      ["three decimal places", "480.505", "طابقت كشف البنك", "أدخل مبلغًا أكبر من صفر بحد أقصى خانتين عشريتين."],
    ])("refuses %s before anything is posted", async (_label, amount, reason, message) => {
      let posts = 0;
      const transport = checkoutsTransport({
        "POST /tenants/tenant-1/card-checkouts/chk-1/apply": () => {
          posts += 1;
          return { body: unapplied };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "تطبيق على الاشتراك" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("المبلغ المحصَّل فعلًا (جنيه)"), { target: { value: amount } });
      fireEvent.change(within(dialog).getByLabelText("سبب التطبيق اليدوي"), { target: { value: reason } });
      fireEvent.click(within(dialog).getByRole("button", { name: "تطبيق الدفعة" }));

      expect(await within(dialog).findByText(message)).toBeInTheDocument();
      expect(posts).toBe(0);
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
      fireEvent.change(within(dialog).getByLabelText("سبب التطبيق اليدوي"), { target: { value: "طابقت كشف البنك" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "تطبيق الدفعة" }));

      expect(await within(dialog).findByText("تعذّر تطبيق دفعة البطاقة: المرجع مسجَّل كدفعة من قبل")).toBeInTheDocument();
    });

    it("offers neither action to a support operator, and no apply button on a checkout that is not unapplied", async () => {
      renderDetail({ transport: checkoutsTransport({}, [unapplied, expired]), session: supportSession });

      expect(await screen.findByText(/انتهت المهلة دون أن يؤكّد مزوّد الدفع أي عملية/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "تطبيق على الاشتراك" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "مطابقة العمليات المعلّقة مع Paymob" })).not.toBeInTheDocument();
    });

    it("shows one apply button per unapplied checkout only", async () => {
      renderDetail({ transport: checkoutsTransport({}, [unapplied, expired]), session: testPlatformSession });

      expect(await screen.findAllByRole("button", { name: "تطبيق على الاشتراك" })).toHaveLength(1);
    });

    it("runs the sweep and reports what it did, including what could not be asked", async () => {
      let sweeps = 0;
      const transport = checkoutsTransport({
        "POST /card-checkouts/sweep": () => {
          sweeps += 1;
          return { body: { examined: 4, paid: 1, declined: 0, unapplied: 0, expired: 1, stillPending: 1, alreadySettled: 0, unavailable: 1, failed: 0 } };
        },
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "مطابقة العمليات المعلّقة مع Paymob" }));

      expect(await screen.findByText("رُوجعت 4 عملية: مدفوعة 1، مرفوضة 0، غير مطبّقة 0، منتهية 1، ما زالت معلّقة 1.")).toBeInTheDocument();
      expect(screen.getByText("تعذّر سؤال مزوّد الدفع عن 1 عملية، فتُركت كما هي.")).toBeInTheDocument();
      expect(sweeps).toBe(1);
    });

    it("shows the server's message when the sweep fails", async () => {
      const transport = checkoutsTransport({
        "POST /card-checkouts/sweep": () => ({ status: 503, body: { error: "CARD_CHECKOUT_NOT_CONFIGURED", message: "الدفع بالبطاقة غير مُفعّل على هذا الخادم" } }),
      });
      renderDetail({ transport, session: testPlatformSession });

      fireEvent.click(await screen.findByRole("button", { name: "مطابقة العمليات المعلّقة مع Paymob" }));

      expect(await screen.findByText("الدفع بالبطاقة غير مُفعّل على هذا الخادم")).toBeInTheDocument();
    });
  });
});
