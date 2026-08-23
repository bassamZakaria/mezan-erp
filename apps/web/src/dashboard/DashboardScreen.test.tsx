// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
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

    const rangeGroup = screen.getByRole("group", { name: "نطاق الفترة" });
    fireEvent.click(within(rangeGroup).getByRole("button", { name: "كل الفترات" }));
    // "كل الفترات" sends no dates → all-time figure from the backend.
    expect((await screen.findAllByText("9,999.00")).length).toBeGreaterThan(0);
  });

  it("shows the company-wide footer disclaimer", () => {
    renderDashboard();
    expect(
      screen.getByText("جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة"),
    ).toBeInTheDocument();
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
      <NavigationProvider value={{ navigate, intent: null, clearIntent: () => {} }}>
        <DashboardScreen />
      </NavigationProvider>,
      { transport: stubTransport({ "GET /dashboard/summary": () => ({ body: summary() }) }), initialSession: testAdminSession },
    );

    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(navigate).toHaveBeenCalledWith(screenKey, "create");
  });
});
