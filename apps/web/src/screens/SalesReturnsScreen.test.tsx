// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { CustomerDTO, ItemDTO, SalesReturnDocumentDTO, WarehouseDTO } from "@mezan/contracts";
import type { SalesInvoiceDTO } from "../data/hooks";
import { SalesReturnsScreen } from "./SalesReturnsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const customers: CustomerDTO[] = [
  {
    id: "cust-1", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null, contactPerson: null,
    taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true,
    priceListId: null, creditLimit: "0", taxExempt: false, etaBuyerType: "business", nationalId: null,
  },
];

const warehouses: WarehouseDTO[] = [{ id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الفرع الرئيسي", branchId: "MAIN", type: "MAIN", isDefault: true, active: true }];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

function salesInvoice(overrides: Partial<SalesInvoiceDTO> = {}): SalesInvoiceDTO {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: "INV-000123",
    status: "confirmed",
    date: "2026-08-10",
    dueDate: "2026-09-10",
    customerId: "cust-1",
    customerNameAr: "شركة الأمل للتجارة",
    customerTaxExempt: false,
    warehouseId: "MAIN-WH",
    branchId: "MAIN",
    salespersonId: null,
    salespersonNameAr: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 0 },
    arAccountId: "acc-ar",
    taxAccountId: "acc-tax",
    amountPaid: "0.000000",
    returnedCredit: "0.000000",
    remainingBalance: "1150.000000",
    journalEntryId: "je-1",
    workflowRequestId: null,
    createdAt: "2026-08-10T09:00:00.000Z",
    confirmedAt: "2026-08-10T09:05:00.000Z",
    lines: [
      {
        lineId: "l1", itemId: "item-cement", itemNameAr: "أسمنت بورتلاندي", isStock: true, qty: "10.000000",
        unitPrice: "100.000000", discountPercent: 0, taxRatePercent: 14, revenueAccountId: "acc-rev",
        cogsAccountId: "acc-cogs", inventoryAccountId: "acc-inv", unitCost: "85.000000",
      },
    ],
    totals: { grossTotal: "1000.000000", lineDiscountTotal: "0", promotionDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "1000.000000", taxableTotal: "1000.000000", taxTotal: "140.000000", grandTotal: "1140.000000" },
    ...overrides,
  };
}

function salesReturn(overrides: Partial<SalesReturnDocumentDTO> = {}): SalesReturnDocumentDTO {
  return {
    id: "sr-1",
    docType: "SALES_RETURN",
    docNo: "SR-000001",
    date: "2026-08-20",
    memo: "",
    status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", customerId: "cust-1", sourceInvoiceId: "inv-1",
        sourceInvoiceNumber: "INV-000123", reason: "DEFECTIVE", availableQty: "10.000000", qty: "2.000000",
        unitPrice: "100.000000", unitCost: "85.000000", taxAmount: "28.000000",
      },
    ],
    createdAt: "2026-08-20T09:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    awaitingRefund: false,
    ...overrides,
  };
}

function baseHandlers(returns: SalesReturnDocumentDTO[]) {
  return {
    "GET /sales-invoices": () => ({ body: [salesInvoice()] }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /customers": () => ({ body: customers }),
    "GET /items": () => ({ body: items }),
    "GET /sales-returns": () => ({ body: returns }),
  };
}

describe("SalesReturnsScreen", () => {
  it("shows the empty state when there are no returns", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<SalesReturnsScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "مرتجعات المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeInTheDocument();
  });

  it("lists sales returns from the real API", async () => {
    const transport = stubTransport(baseHandlers([salesReturn()]));
    renderWithProviders(<SalesReturnsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("SR-000001")).toBeInTheDocument();
    expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  it("creates a draft return against a confirmed sales invoice", async () => {
    let current: SalesReturnDocumentDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-returns": () => ({ body: current }),
      "POST /sales-returns": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = salesReturn({ id: body.id, docNo: null, status: "draft" });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<SalesReturnsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getByRole("button", { name: "مرتجع جديد" }));
    const dialog = screen.getByRole("dialog", { name: "مرتجع مبيعات جديد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  it("confirms then cancels a draft return", async () => {
    let current: SalesReturnDocumentDTO[] = [salesReturn()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-returns": () => ({ body: current }),
      "POST /sales-returns/sr-1/confirm": () => {
        current = current.map((d) => (d.id === "sr-1" ? { ...d, status: "confirmed" as const, docNo: "SR-000001", confirmedAt: "2026-08-20T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
      "POST /sales-returns/sr-1/cancel": () => {
        current = current.map((d) => (d.id === "sr-1" ? { ...d, status: "cancelled" as const } : d));
        return { body: current[0] };
      },
    });
    renderWithProviders(<SalesReturnsScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("SR-000001"));
    const dialog = screen.getByRole("dialog", { name: "SR-000001" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد المرتجع" }));
    expect(await within(dialog).findByRole("button", { name: "إلغاء المرتجع" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء المرتجع" }));
    await within(dialog).findByText("ملغي");
  });
});
