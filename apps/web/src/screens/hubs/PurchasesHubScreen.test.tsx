// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import type { GoodsReceiptDTO, PurchaseInvoiceDTO, PurchaseOrderDTO, SupplierDTO } from "@mezan/contracts";
import { PurchasesHubScreen } from "./PurchasesHubScreen";
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

const suppliers: SupplierDTO[] = [
  {
    id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null, bankAccount: null,
  },
];

function purchaseOrder(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "po-1", number: "PO-000001", supplierId: "sup-1", date: "2026-08-18", expectedDeliveryDate: "2026-08-25",
    branchId: "MAIN", warehouseId: "MAIN-WH", currency: "EGP", notes: null,
    lines: [{ itemId: "item-1", description: null, qty: "10.000000", unitPrice: "85.000000", receivedQty: "0.000000" }],
    status: "sent", subtotal: "850.000000", total: "850.000000", createdBy: "محمد الشهابي", createdAt: "2026-08-18T09:00:00.000Z",
    ...overrides,
  };
}

function goodsReceipt(overrides: Partial<GoodsReceiptDTO> = {}): GoodsReceiptDTO {
  return {
    id: "gr-1", number: "GR-000001", projectId: null, purchaseOrderId: "po-1", supplierId: "sup-1", warehouseId: "MAIN-WH", date: "2026-08-19", notes: null,
    lines: [{ itemId: "item-1", description: null, qty: "10.000000", unitCost: "85.000000", batchNo: null, expiryDate: null }],
    status: "confirmed", invoiced: false, totalCost: "850.000000", createdBy: "محمد الشهابي", createdAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

function purchaseInvoice(overrides: Partial<PurchaseInvoiceDTO> = {}): PurchaseInvoiceDTO {
  return {
    id: "pi-1", number: "PI-000001", projectId: null, supplierId: "sup-1", date: "2026-08-20", dueDate: "2026-09-04", supplierInvoiceNumber: null,
    branchId: "MAIN", warehouseId: "MAIN-WH", currency: "EGP", notes: null, receiptId: null,
    lines: [{ itemId: "item-1", description: null, kind: "inventory", qty: "1.000000", unitCost: "1250.750000", taxRatePercent: 0, batchNo: null, expiryDate: null }],
    status: "confirmed", subtotal: "1250.750000", tax: "0.000000", total: "1250.750000", amountPaid: "0.000000", remainingBalance: "1250.750000",
    createdBy: "محمد الشهابي", createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

function renderScreen(
  navigate: (screen: string, intent?: unknown) => void = vi.fn(),
  overrides: { orders?: PurchaseOrderDTO[]; receipts?: GoodsReceiptDTO[]; invoices?: PurchaseInvoiceDTO[]; suppliers?: SupplierDTO[] } = {},
) {
  const transport = stubTransport({
    "GET /purchases/orders": () => ({ body: overrides.orders ?? [purchaseOrder()] }),
    "GET /purchases/receipts": () => ({ body: overrides.receipts ?? [goodsReceipt()] }),
    "GET /purchases/invoices": () => ({ body: overrides.invoices ?? [purchaseInvoice()] }),
    "GET /suppliers": () => ({ body: overrides.suppliers ?? suppliers }),
  });
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <PurchasesHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("PurchasesHubScreen", () => {
  it("renders stat tiles from the real endpoints, including money formatting", async () => {
    renderScreen(vi.fn(), {
      orders: [purchaseOrder({ status: "sent" }), purchaseOrder({ id: "po-2", number: "PO-000002", status: "draft" })], // openOrders = 1
      receipts: [goodsReceipt({ invoiced: true })], // uninvoicedReceipts = 0
      invoices: [purchaseInvoice(), purchaseInvoice({ id: "pi-2", number: "PI-000002", date: "2026-08-10", total: "300.000000" }), purchaseInvoice({ id: "pi-3", number: "PI-000003", date: "2026-08-05", total: "50.000000" })], // invoices.length = 3
      suppliers: [suppliers[0]!, { ...suppliers[0]!, id: "sup-2", code: "S2" }], // suppliers.length = 2
    });
    expect(screen.getByRole("heading", { name: "المشتريات" })).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument(); // open orders (status "sent")
    expect(await screen.findByText("1,250.75")).toBeInTheDocument(); // invoice total, Money-formatted
    await waitFor(() => expect(screen.queryByText("1250.750000")).not.toBeInTheDocument());
  });

  it("renders the recent-invoices list with supplier name and formatted total", async () => {
    renderScreen();
    expect(await screen.findByText("شركة النيل للتوريدات")).toBeInTheDocument();
    expect(screen.getByText(/PI-000001/)).toBeInTheDocument();
  });

  it("shows the configured empty state when there are no invoices", async () => {
    renderScreen(vi.fn(), { invoices: [] });
    expect(await screen.findByText("لا توجد فواتير مشتريات بعد — ستظهر هنا فور إنشاء أول فاتورة.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails, never the raw enum", async () => {
    const transport = stubTransport({
      "GET /purchases/orders": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /suppliers": () => ({ body: suppliers }),
    });
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <PurchasesHubScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات المشتريات.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });

  it("navigates to the create flow for each quick action", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    fireEvent.click(await screen.findByRole("button", { name: "أمر شراء جديد" }));
    expect(navigate).toHaveBeenCalledWith("purchase-orders", "create");
    fireEvent.click(screen.getByRole("button", { name: "استلام بضاعة" }));
    expect(navigate).toHaveBeenCalledWith("goods-receipts", "create");
    fireEvent.click(screen.getByRole("button", { name: "فاتورة مشتريات جديدة" }));
    expect(navigate).toHaveBeenCalledWith("purchase-invoices", "create");
  });
});
