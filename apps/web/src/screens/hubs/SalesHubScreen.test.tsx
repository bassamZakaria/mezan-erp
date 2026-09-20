// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import type { CustomerDTO } from "@mezan/contracts";
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
    unitCode: "", unitFactor: 1, discountType: "percent", discountAmount: "0.000000", costCenterId: null, baseQty: "1.000000", lineId: "l1", itemId: "item-1", itemNameAr: "أرز أبيض", isStock: true, qty: "1.000000", unitPrice: "185.000000",
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

const customers: CustomerDTO[] = [
  {
    id: "cust-1", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, priceListId: null,
    creditLimit: "15000.00", taxExempt: false, etaBuyerType: "business", commercialRegistrationNumber: null,
  } as CustomerDTO,
];

function renderScreen(
  navigate: (screen: string, intent?: unknown) => void = vi.fn(),
  overrides: { invoices?: SalesInvoiceDTO[]; quotes?: SalesQuoteRecord[]; customers?: CustomerDTO[] } = {},
) {
  const transport = stubTransport({
    "GET /sales-invoices": () => ({ body: overrides.invoices ?? [invoice()] }),
    "GET /sales-quotes": () => ({ body: overrides.quotes ?? [quote()] }),
    "GET /customers": () => ({ body: overrides.customers ?? customers }),
  });
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <SalesHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("SalesHubScreen", () => {
  it("renders stat tiles from the real endpoints, including money formatting", async () => {
    renderScreen(vi.fn(), {
      invoices: [invoice(), invoice({ id: "inv-2", docNo: "INV-000002", date: "2026-08-10", status: "draft", remainingBalance: "0" })], // invoices.length = 2
      quotes: [quote()], // pendingQuotes = 1
      customers: [customers[0]!, { ...customers[0]!, id: "cust-2", code: "C2" }, { ...customers[0]!, id: "cust-3", code: "C3" }], // customers.length = 3
    });
    expect(screen.getByRole("heading", { name: "المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument(); // pending quotes ("sent")
    expect(await screen.findByText("1,210.90")).toBeInTheDocument(); // outstanding receivable, Money-formatted
    await waitFor(() => expect(screen.queryByText("1210.900000")).not.toBeInTheDocument());
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
      "GET /sales-invoices": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /sales-quotes": () => ({ body: [] }),
      "GET /customers": () => ({ body: customers }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <SalesHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات المبيعات.");
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
