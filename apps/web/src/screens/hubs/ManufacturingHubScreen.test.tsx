// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import { ManufacturingHubScreen } from "./ManufacturingHubScreen";
import { NavigationProvider } from "../../navigation";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import type { ProductionActiveOrderDTO, ProductionDashboardDTO } from "../../data/hub-hooks";

function TestNavigation({ navigate, children }: { navigate: (screen: string, intent?: unknown) => void; children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: navigate as never,
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

function order(overrides: Partial<ProductionActiveOrderDTO> = {}): ProductionActiveOrderDTO {
  return {
    id: "wo-1",
    number: "WO-000001",
    productItemId: "item-1",
    producedQty: "20.000000",
    plannedQty: "50.000000",
    progress: 0.4,
    priority: "high",
    overdue: false,
    scheduledEndDate: "2026-09-05",
    stage: "started",
    nextAction: "issue",
    ...overrides,
  };
}

const sampleDashboard: ProductionDashboardDTO = {
  overdueCount: 1,
  kpis: {
    activeWorkOrders: 3,
    wipValue: "12500.500000",
    unitsProducedThisMonth: "480.000000",
    avgCostPerUnit: "26.040000",
  },
  buckets: {
    notStarted: [],
    awaitingMaterialIssue: [],
    awaitingProductReceipt: [],
    readyToComplete: [],
  },
  activeOrders: [order(), order({ id: "wo-2", number: "WO-000002", overdue: true, priority: "normal", producedQty: "0", plannedQty: "10" })],
};

function renderScreen(navigate: (screen: string, intent?: unknown) => void = vi.fn(), dashboard: ProductionDashboardDTO = sampleDashboard) {
  const transport = stubTransport({
    "GET /manufacturing/dashboard": () => ({ body: dashboard }),
  });
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <ManufacturingHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("ManufacturingHubScreen", () => {
  it("renders stat tiles from the real dashboard, including money formatting", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "التصنيع" })).toBeInTheDocument();
    expect(await screen.findByText("3")).toBeInTheDocument(); // activeWorkOrders
    expect(await screen.findByText("12,500.50")).toBeInTheDocument(); // wip Money, never "12500.500000"
    expect(await screen.findByText("480")).toBeInTheDocument(); // unitsProducedThisMonth
    expect(await screen.findByText("26.04")).toBeInTheDocument(); // avgCostPerUnit Money
    await waitFor(() => expect(screen.queryByText("12500.500000")).not.toBeInTheDocument());
    expect(screen.queryByText("26.040000")).not.toBeInTheDocument();
  });

  it("renders the active-orders list rows with priority, quantities and overdue state", async () => {
    renderScreen();
    expect(await screen.findByText("WO-000001")).toBeInTheDocument();
    expect(screen.getByText("WO-000002")).toBeInTheDocument();
    expect(screen.getByText("متأخر")).toBeInTheDocument(); // the overdue pill on WO-000002
    expect(screen.getByText("40%")).toBeInTheDocument(); // WO-000001's non-overdue progress pill
  });

  it("shows the configured empty state when there are no active orders", async () => {
    const transport = stubTransport({
      "GET /manufacturing/dashboard": () => ({ body: { ...sampleDashboard, activeOrders: [] } }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <ManufacturingHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("لا توجد أوامر تصنيع نشطة حالياً.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when the dashboard query fails, never the raw enum", async () => {
    const transport = stubTransport({
      "GET /manufacturing/dashboard": () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <ManufacturingHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل لوحة الإنتاج. (رمز 500)");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });

  it("opens the full production dashboard from the list action button", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    const button = await screen.findByRole("button", { name: "عرض لوحة الإنتاج الكاملة" });
    fireEvent.click(button);
    expect(navigate).toHaveBeenCalledWith("production-dashboard");
  });
});
