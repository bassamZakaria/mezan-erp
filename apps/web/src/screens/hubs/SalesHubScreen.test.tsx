// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import { SalesHubScreen } from "./SalesHubScreen";
import { NavigationProvider } from "../../navigation";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import type { SalesInvoiceDTO, SalesQuoteRecord } from "../../data/hooks";

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

function invoiceLine(): SalesInvoiceDTO["lines"][number] {
  return {
    unitCode: "", unitFactor: 1, discountType: "percent", discountAmount: "0.000000", costCenterId: null, taxRateId: null, baseQty: "1.000000", lineId: "l1", itemId: "item-1", itemNameAr: "أرز أبيض", isStock: true, qty: "1.000000", unitPrice: "185.000000",
    discountPercent: 0, taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", unitCost: "150.000000",
  };
}

function invoice(overrides: Partial<SalesInvoiceDTO> = {}): SalesInvoiceDTO {
  return {
    id: "inv-1", docType: "SALES_INVOICE", docNo: "INV-000001", status: "confirmed", date: "2026-08-20", dueDate: "2026-09-20",
    customerId: "cust-1", customerNameAr: "شركة الأمل للتجارة", customerTaxExempt: false, taxInclusive: false,
    warehouseId: "wh-1", branchId: "MAIN", salespersonId: null, salespersonNameAr: null, couponCode: null, appliedPromotion: null,
    currency: "EGP", notes: null, internalNotes: null, discount: { type: "amount", amount: "0.000000" },
    arAccountId: "1105", taxAccountId: "2200", amountPaid: "0.000000", returnedCredit: "0.000000", remainingBalance: "1210.900000",
    journalEntryId: "je-1", workflowRequestId: null, createdAt: "2026-08-20T09:00:00.000Z", confirmedAt: "2026-08-20T09:00:00.000Z",
    projectId: null,
    fxRate: null,
    lines: [invoiceLine()],
    totals: { taxInclusive: false, grossTotal: "185.00", lineDiscountTotal: "0.00", promotionDiscountTotal: "0.00", invoiceDiscountTotal: "0.00", subtotal: "185.00", taxableTotal: "185.00", taxTotal: "25.90", grandTotal: "1310.900000" },
    ...overrides,
    baseGrandTotal: overrides.baseGrandTotal ?? overrides.totals?.grandTotal ?? "1310.900000",
  };
}

function quote(overrides: Partial<SalesQuoteRecord> = {}): SalesQuoteRecord {
  return {
    id: "q-1", docType: "SALES_QUOTE", docNo: "QT-000001", status: "sent", date: "2026-08-15", expiryDate: "2026-08-29",
    customerId: "cust-1", customerNameAr: "شركة الأمل للتجارة", branchId: "MAIN", currency: "EGP", customerTaxExempt: false,
    notes: null, internalNotes: null, discount: { type: "amount", amount: "0" }, priceListId: null, couponCode: null,
    createdAt: "2026-08-15T09:00:00.000Z", sentAt: "2026-08-15T09:05:00.000Z", respondedAt: null, convertedAt: null, convertedInvoiceId: null,
    lines: [],
    totals: { grossTotal: "0", lineDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "0", taxableTotal: "0", taxTotal: "0", grandTotal: "0" },
    ...overrides,
  };
}

const STATS = { count: 1, sales: "1310.900000", collected: "100.000000", returned: "0.000000", remaining: "1210.900000", overdueCount: 0, overdue: "0", dueSoonCount: 0, dueSoon: "0" };

function renderScreen(
  navigate: (screen: string, intent?: unknown) => void = vi.fn(),
  overrides: { invoices?: SalesInvoiceDTO[]; quotes?: SalesQuoteRecord[]; invoiceCount?: number; customerCount?: number; asked?: string[] } = {},
) {
  const transport = stubTransport({
    "GET /sales-invoices": (_init, path) => (overrides.asked?.push(path), { body: overrides.invoices ?? [invoice()] }),
    "GET /sales-invoices/counts": () => ({ body: { all: overrides.invoiceCount ?? 1 } }),
    "GET /sales-invoices/stats": () => ({ body: STATS }),
    "GET /sales-quotes/counts": () => ({ body: { all: 1, sent: (overrides.quotes ?? [quote()]).filter((q) => q.status === "sent").length } }),
    "GET /customers/counts": () => ({ body: { all: overrides.customerCount ?? 1 } }),
  });
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <SalesHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("SalesHubScreen", () => {
  it("renders stat tiles from the server's counts and stats, never from a downloaded list", async () => {
    renderScreen(vi.fn(), { quotes: [quote()], invoiceCount: 4321, customerCount: 987 });
    expect(screen.getByRole("heading", { name: "المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("4321")).toBeInTheDocument();
    expect(screen.getByText("987")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // pending quotes ("sent")
    expect(screen.getByText("1,210.90")).toBeInTheDocument(); // outstanding receivable = stats.remaining
    await waitFor(() => expect(screen.queryByText("1210.900000")).not.toBeInTheDocument());
  });

  it("asks for one page of the five newest invoices, never the whole table", async () => {
    const asked: string[] = [];
    renderScreen(vi.fn(), { asked });
    await screen.findByText("شركة الأمل للتجارة");
    expect(asked).toHaveLength(1);
    const query = new URLSearchParams(asked[0]!.split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({ page: "1", pageSize: "5", sort: "docNo", sortDir: "desc" });
  });

  it("leaves the customers tile out for a seat that may not read customers", async () => {
    const transport = stubTransport({
      "GET /sales-invoices": () => ({ body: [invoice()] }),
      "GET /sales-invoices/counts": () => ({ body: { all: 1 } }),
      "GET /sales-invoices/stats": () => ({ body: STATS }),
      "GET /sales-quotes/counts": () => ({ body: { all: 0, sent: 0 } }),
      "GET /customers/counts": () => ({ status: 403, body: { error: "PERMISSION_DENIED" } }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <SalesHubScreen />
      </TestNavigation>,
      { transport, initialSession: { ...testAdminSession, isCompanyAdmin: false, permissions: ["sales.invoice.view"] } },
    );
    expect(await screen.findByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("عدد العملاء")).toBeNull();
  });

  it("renders the recent-invoices list with customer name and formatted total", async () => {
    renderScreen();
    expect(await screen.findByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.getByText(/INV-000001/)).toBeInTheDocument();
  });

  it("shows the configured empty state when there are no invoices", async () => {
    renderScreen(vi.fn(), { invoices: [] });
    expect(await screen.findByText("لا توجد فواتير مبيعات بعد — ستظهر هنا فور إنشاء أول فاتورة.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails, never the raw enum", async () => {
    const transport = stubTransport({
      "GET /sales-invoices": () => ({ body: [] }),
      "GET /sales-invoices/counts": () => ({ body: { all: 0 } }),
      "GET /sales-invoices/stats": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /sales-quotes/counts": () => ({ body: { all: 0, sent: 0 } }),
      "GET /customers/counts": () => ({ body: { all: 0 } }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <SalesHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل فواتير المبيعات. (رمز 500)");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });

  it("navigates to the create flow for each quick action", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    fireEvent.click(await screen.findByRole("button", { name: "فاتورة مبيعات جديدة" }));
    expect(navigate).toHaveBeenCalledWith("sales-invoices", "create");
    fireEvent.click(screen.getByRole("button", { name: "عرض سعر جديد" }));
    expect(navigate).toHaveBeenCalledWith("quotes", "create");
  });
});
