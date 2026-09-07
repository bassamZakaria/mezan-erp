// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import type { ChequeDTO, DashboardSummaryDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { TreasuryHubScreen } from "./TreasuryHubScreen";
import { NavigationProvider } from "../../navigation";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import type { VoucherRowDTO } from "../../data/hooks";

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

const accounts: TreasuryAccountDTO[] = [
  { id: "ta-1", code: "CASH-001", name: "صندوق نقدي", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, status: "active" },
  { id: "ta-2", code: "CASH-002", name: "صندوق موقوف", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, status: "inactive" },
];

function voucher(overrides: Partial<VoucherRowDTO> = {}): VoucherRowDTO {
  const row: VoucherRowDTO = {
    id: "cv-1", docNo: "CV-000001", voucherType: "customer_collection", direction: "receipt", status: "confirmed",
    date: "2026-08-07", memo: "تحصيل من عميل", amount: "3500.500000", currency: "EGP", fxRate: null,
    baseAmount: "3500.500000", branchId: "MAIN", paymentMethod: "cash",
    treasuryAccountId: "ta-1", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "1105", counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null, customerId: null, supplierId: null, referenceNo: null, costCenterId: null,
    withholdingAmount: null, withholdingRatePercent: null, netPaidAmount: "3500.500000", journalEntryId: "je-1",
    confirmedAt: "2026-08-07T10:00:00.000Z",
    allocatable: false,
    allocationSummary: { voucherAmount: "3500.500000", allocated: "0", unallocated: "3500.500000", fullyAllocated: false, needsAllocation: false },
    ...overrides,
  };
  return { ...row, baseAmount: overrides.baseAmount ?? row.amount };
}

function cheque(overrides: Partial<ChequeDTO> = {}): ChequeDTO {
  return {
    id: "chq-1", direction: "incoming", status: "pending", effectiveStatus: "pending", chequeNumber: "CHQ-5001",
    bankName: "بنك مصر", bankBranchName: null, bankAccountNumber: null, amount: "1000.000000", currency: "EGP",
    issueDate: "2026-08-01", dueDate: "2026-09-20", branchId: "BR1", notes: null, partyId: "cust-1",
    counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    bankTreasuryAccountId: null, createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as ChequeDTO;
}

const summary: DashboardSummaryDTO = {
  generatedAt: "2026-08-30T00:00:00.000Z",
  counts: { accounts: 0, customers: 0, suppliers: 0, items: 0, users: 1, journalEntries: 0 },
  gl: { revenue: "0", expenses: "0", netProfit: "0", cash: "48250.750000", receivables: "0", payables: "0", inventoryValue: "0" },
  recentActivity: [],
};

function renderScreen(
  navigate: (screen: string, intent?: unknown) => void = vi.fn(),
  overrides: { accounts?: TreasuryAccountDTO[]; vouchers?: VoucherRowDTO[]; cheques?: ChequeDTO[]; summary?: DashboardSummaryDTO } = {},
) {
  const transport = stubTransport({
    "GET /treasury-accounts": () => ({ body: overrides.accounts ?? accounts }),
    "GET /vouchers": () => ({ body: overrides.vouchers ?? [voucher()] }),
    "GET /cheques": () => ({ body: overrides.cheques ?? [cheque()] }),
    "GET /dashboard/summary": () => ({ body: overrides.summary ?? summary }),
  });
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <TreasuryHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("TreasuryHubScreen", () => {
  it("renders stat tiles from the real endpoints, including money formatting", async () => {
    renderScreen(vi.fn(), {
      accounts: [...accounts, { ...accounts[0]!, id: "ta-3", code: "CASH-003" }], // activeAccounts = 2 (ta-1, ta-3)
      vouchers: [voucher(), voucher({ id: "cv-2", docNo: "CV-000002", date: "2026-08-06" }), voucher({ id: "cv-3", docNo: "CV-000003", date: "2026-08-05" })], // vouchers.length = 3
      cheques: [cheque()], // pendingCheques = 1
    });
    expect(screen.getByRole("heading", { name: "الخزينة" })).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument(); // pending cheques
    expect(await screen.findByText("48,250.75")).toBeInTheDocument(); // cash on hand, Money-formatted
    await waitFor(() => expect(screen.queryByText("48250.750000")).not.toBeInTheDocument());
  });

  it("renders the recent-vouchers list with memo, doc number and formatted amount", async () => {
    renderScreen();
    expect(await screen.findByText("تحصيل من عميل")).toBeInTheDocument();
    expect(screen.getByText(/CV-000001/)).toBeInTheDocument();
    expect(screen.getByText("3,500.50")).toBeInTheDocument();
    expect(screen.queryByText("3500.500000")).not.toBeInTheDocument();
  });

  it("shows the configured empty state when there are no vouchers", async () => {
    renderScreen(vi.fn(), { vouchers: [] });
    expect(await screen.findByText("لا توجد سندات بعد — ستظهر هنا فور تسجيل أول سند.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails, never the raw enum", async () => {
    const transport = stubTransport({
      "GET /treasury-accounts": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /cheques": () => ({ body: [] }),
      "GET /dashboard/summary": () => ({ body: summary }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <TreasuryHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات الخزينة.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });

  it("navigates to the create flow for the new-cash-voucher quick action", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    fireEvent.click(await screen.findByRole("button", { name: "سند نقدي جديد" }));
    expect(navigate).toHaveBeenCalledWith("treasury-vouchers", "create");
  });
});
