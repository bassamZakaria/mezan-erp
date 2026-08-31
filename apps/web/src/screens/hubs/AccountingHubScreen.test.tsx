// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import type { AccountDTO, DashboardSummaryDTO, FiscalPeriodDTO } from "@mezan/contracts";
import { AccountingHubScreen } from "./AccountingHubScreen";
import { NavigationProvider } from "../../navigation";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

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

const sampleAccounts: AccountDTO[] = [
  { id: "ACC-1", code: "1000", nameAr: "النقدية", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "ACC-2", code: "2000", nameAr: "الموردون", nameEn: null, type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
];

const samplePeriods: FiscalPeriodDTO[] = [
  { id: "P-1", year: 2026, periodNumber: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "open" },
  { id: "P-2", year: 2026, periodNumber: 2, startDate: "2026-02-01", endDate: "2026-02-28", status: "closed" },
];

const sampleSummary: DashboardSummaryDTO = {
  generatedAt: "2026-08-30T00:00:00.000Z",
  counts: { accounts: 2, customers: 0, suppliers: 0, items: 0, users: 1, journalEntries: 7 },
  gl: { revenue: "50000", expenses: "12000", netProfit: "38000", cash: "0", receivables: "0", payables: "0", inventoryValue: "0" },
  recentActivity: [
    { id: "JE-1", entryNo: "JE-0001", date: "2026-08-20", memo: "قيد افتتاحي" },
    { id: "JE-2", entryNo: "JE-0002", date: "2026-08-21", memo: "" },
  ],
};

function renderScreen(navigate: (screen: string, intent?: unknown) => void = vi.fn()) {
  const transport = stubTransport({
    "GET /dashboard/summary": () => ({ body: sampleSummary }),
    "GET /accounts": () => ({ body: sampleAccounts }),
    "GET /fiscal-periods": () => ({ body: samplePeriods }),
  });
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <AccountingHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("AccountingHubScreen", () => {
  it("renders stat tiles from the stubbed data, including money formatting", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "المحاسبة" })).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument(); // accounts count
    expect(await screen.findByText("7")).toBeInTheDocument(); // journal entries count
    expect(await screen.findByText("38,000.00")).toBeInTheDocument();
    expect(await screen.findByText("ج.م")).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument(); // one open period
  });

  it("renders the recent activity list with real rows", async () => {
    renderScreen();
    expect(await screen.findByText("قيد افتتاحي")).toBeInTheDocument();
    expect(await screen.findByText("JE-0002")).toBeInTheDocument(); // memo falls back to entryNo
  });

  it("shows the configured empty state when recent activity is empty", async () => {
    const transport = stubTransport({
      "GET /dashboard/summary": () => ({ body: { ...sampleSummary, recentActivity: [] } }),
      "GET /accounts": () => ({ body: sampleAccounts }),
      "GET /fiscal-periods": () => ({ body: samplePeriods }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <AccountingHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("لا يوجد نشاط بعد — ستظهر القيود المرحلة هنا.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails", async () => {
    const transport = stubTransport({
      "GET /dashboard/summary": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /accounts": () => ({ body: sampleAccounts }),
      "GET /fiscal-periods": () => ({ body: samplePeriods }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <AccountingHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات المحاسبة.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });

  it("renders the quick action and navigates to the create flow on click", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    const button = await screen.findByRole("button", { name: "قيد محاسبي جديد" });
    fireEvent.click(button);
    expect(navigate).toHaveBeenCalledWith("journals", "create");
  });
});
