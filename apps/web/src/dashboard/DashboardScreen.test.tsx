// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DashboardSummaryDTO } from "@mezan/contracts";
import { DashboardScreen } from "./DashboardScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

function summary(overrides: Partial<DashboardSummaryDTO> = {}): DashboardSummaryDTO {
  return {
    generatedAt: "2026-08-22T00:00:00.000Z",
    counts: { accounts: 30, customers: 2, suppliers: 1, items: 4, users: 3, journalEntries: 5 },
    gl: {
      revenue: "86240.00",
      expenses: "61930.00",
      netProfit: "24310.00",
      cash: "338.00",
      receivables: "2782.30",
      payables: "110.00",
      inventoryValue: "604950.90",
    },
    recentActivity: [{ id: "je-1", entryNo: "JE-0001", date: "2026-08-20", memo: "قيد افتتاحي" }],
    ...overrides,
  };
}

/** Default range is "هذا الشهر", which sends a fromDate; "كل الفترات" sends none — lets us prove the range control re-queries real data. */
function rangeAwareTransport() {
  return stubTransport({
    "GET /dashboard/summary": (_init, path) => {
      const scoped = path.includes("fromDate=");
      return { body: summary({ gl: { ...summary().gl, revenue: scoped ? "1000.00" : "9999.00" } }) };
    },
  });
}

describe.each(["light", "dark"] as const)("DashboardScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  function renderDashboard(transport = stubTransport({ "GET /dashboard/summary": () => ({ body: summary() }) })) {
    return renderWithProviders(<DashboardScreen />, { transport, initialSession: testAdminSession });
  }

  it("renders the greeting header, quick actions and real KPI tiles", async () => {
    document.documentElement.setAttribute("data-theme", theme);
    renderDashboard();
    expect(screen.getByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فاتورة جديدة" })).toBeInTheDocument();
    // The revenue label/figure now also appear in the balance-beam hero, so more than one match is expected.
    expect(screen.getAllByText("إجمالي الإيرادات").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("86,240.00")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("24,310.00").length).toBeGreaterThan(0);
  });

  it("renders the company-wide KPI row from real GL figures", async () => {
    renderDashboard();
    expect(screen.getByText("مبالغ لدى العملاء")).toBeInTheDocument();
    expect(await screen.findByText("604,950.90")).toBeInTheDocument();
    expect(screen.getByText("2,782.30")).toBeInTheDocument();
  });

  it("renders the system-data counts and recent activity from real data", async () => {
    renderDashboard();
    expect(screen.getByText("بيانات النظام")).toBeInTheDocument();
    expect(await screen.findByText("قيد افتتاحي")).toBeInTheDocument();
    expect(screen.getByText("النشاط الأخير")).toBeInTheDocument();
  });

  it("shows an empty activity state when there are no posted entries", async () => {
    renderDashboard(stubTransport({ "GET /dashboard/summary": () => ({ body: summary({ recentActivity: [] }) }) }));
    expect(await screen.findByText(/لا يوجد نشاط بعد/)).toBeInTheDocument();
  });

  it("re-queries real data when the period range changes", async () => {
    renderDashboard(rangeAwareTransport());
    // Default range "هذا الشهر" sends a fromDate → scoped figure. The revenue figure
    // also appears in the balance-beam hero, so more than one match is expected.
    expect((await screen.findAllByText("1,000.00")).length).toBeGreaterThan(0);

    const rangeGroup = screen.getByRole("radiogroup", { name: "نطاق الفترة" });
    fireEvent.click(within(rangeGroup).getByRole("radio", { name: "كل الفترات" }));
    // "كل الفترات" sends no dates → all-time figure from the backend.
    expect((await screen.findAllByText("9,999.00")).length).toBeGreaterThan(0);
  });

  it("shows the company-wide footer disclaimer", () => {
    renderDashboard();
    expect(
      screen.getByText("جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة"),
    ).toBeInTheDocument();
  });

  it("shows an error state with a retry when the summary request fails", async () => {
    let calls = 0;
    renderDashboard(
      stubTransport({
        "GET /dashboard/summary": () => {
          calls += 1;
          return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: summary() };
        },
      }),
    );
    const failure = await screen.findByText("تعذّر تحميل بيانات لوحة التحكم.");

    // The owner cockpit sits on the same page with its own error card and its
    // own «إعادة المحاولة», so the retry has to be taken from the summary
    // panel that failed rather than from the page.
    const card = failure.parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findAllByText("86,240.00")).not.toHaveLength(0);
  });
});

describe("DashboardScreen quick actions", () => {
  const EXPECTED: ReadonlyArray<readonly [string, string]> = [
    ["فاتورة جديدة", "sales-invoices"],
    ["سند نقدي", "treasury-vouchers"],
    ["استلام بضاعة", "goods-receipts"],
    ["عرض سعر", "quotes"],
  ];

  it.each(EXPECTED)("%s navigates to %s with a create intent", (label, screenKey) => {
    const navigate = vi.fn();
    renderWithProviders(
      <NavigationProvider value={{ navigate, segments: [], openSubPage: () => {},
        openScreenAt: () => {}, intent: null, clearIntent: () => {} }}>
        <DashboardScreen />
      </NavigationProvider>,
      { transport: stubTransport({ "GET /dashboard/summary": () => ({ body: summary() }) }), initialSession: testAdminSession },
    );

    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(navigate).toHaveBeenCalledWith(screenKey, "create");
  });
});

describe("DashboardScreen — the panels follow the user's own layout (§8.5, §8.7)", () => {
  function preferences(widgets: { kind: string; order: number; visible?: boolean }[]) {
    return {
      userId: "u-admin",
      layoutName: "default",
      numerals: null,
      railCollapsed: false,
      pinnedScreens: [],
      recentRecords: [],
      dashboard: {
        columns: 2,
        widgets: widgets.map((w) => ({
          id: w.kind,
          kind: w.kind,
          column: 0,
          order: w.order,
          size: "md",
          visible: w.visible ?? true,
          settings: {},
        })),
      },
      shortcutTiles: [],
      tableViews: [],
      isDefault: false,
      customized: { dashboard: true },
      stored: true,
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
    };
  }

  function renderWith(prefs: unknown) {
    return renderWithProviders(<DashboardScreen />, {
      transport: stubTransport({
        "GET /dashboard/summary": () => ({ body: summary() }),
        "GET /preferences": () => ({ body: prefs }),
      }),
      initialSession: testAdminSession,
    });
  }

  it("hides a panel the user switched off", async () => {
    renderWith(
      preferences([
        { kind: "aging", order: 0, visible: false },
        { kind: "expenses", order: 1 },
        { kind: "topItems", order: 2 },
        { kind: "activity", order: 3 },
      ]),
    );
    // The panel the user kept renders…
    expect(await screen.findByText("توزيع المصروفات")).toBeInTheDocument();
    // …and the one they switched off goes once the preferences land. The first
    // paint shows the default layout, so this has to be waited OUT rather than
    // asserted on the synchronous render.
    await waitFor(() => expect(screen.queryByText("أعمار الأرصدة")).not.toBeInTheDocument());
  });

  it("still renders the default four when the user has chosen nothing", async () => {
    renderWith(preferences([]));
    expect(await screen.findByText("أعمار الأرصدة")).toBeInTheDocument();
  });
});

describe("DashboardScreen — a branch-restricted session sees no company-wide tile (D111)", () => {
  const TAX_TILE = "ضريبة القيمة المضافة المستحقة";
  const CONTRACTING_TILE = "استثناءات المقاولات";

  function renderAs(session: typeof testAdminSession) {
    const calls: string[] = [];
    const stub = stubTransport({ "GET /dashboard/summary": () => ({ body: summary() }) });
    renderWithProviders(<DashboardScreen />, {
      transport: (path, init) => {
        calls.push(path.split("?")[0]!);
        return stub(path, init);
      },
      initialSession: session,
    });
    return calls;
  }

  it("draws neither the VAT-due tile nor the contracting one, and asks the server for neither", async () => {
    const calls = renderAs({ ...testAdminSession, isCompanyAdmin: false, branchScope: ["BR-ALEX"] });
    expect(await screen.findByText("فواتير مبيعات متأخرة")).toBeInTheDocument();
    expect(screen.queryByText(TAX_TILE)).not.toBeInTheDocument();
    expect(screen.queryByText(CONTRACTING_TILE)).not.toBeInTheDocument();
    expect(calls.filter((path) => path.includes("vat-return") || path.startsWith("/contracting"))).toEqual([]);
  });

  it("draws both for a session that holds every branch", async () => {
    const calls = renderAs(testAdminSession);
    expect(await screen.findByText(TAX_TILE)).toBeInTheDocument();
    expect(screen.getByText(CONTRACTING_TILE)).toBeInTheDocument();
    expect(calls.some((path) => path.includes("vat-return"))).toBe(true);
  });
});
