// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ItemDTO, PurchaseInvoiceDTO, PurchaseReturnDocumentDTO, SupplierDTO, WarehouseDTO } from "@mezan/contracts";
import { PurchaseReturnsScreen } from "./PurchaseReturnsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const suppliers: SupplierDTO[] = [
  {
    id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null,
  },
];

const warehouses: WarehouseDTO[] = [{ id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الفرع الرئيسي", branchId: "MAIN", type: "MAIN", isDefault: true, active: true }];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brand: null, costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

function purchaseInvoice(overrides: Partial<PurchaseInvoiceDTO> = {}): PurchaseInvoiceDTO {
  return {
    id: "pi-1",
    number: "PI-000001",
    supplierId: "sup-1",
    date: "2026-08-20",
    dueDate: "2026-09-04",
    supplierInvoiceNumber: null,
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    receiptId: null,
    lines: [{ itemId: "item-cement", description: null, kind: "inventory", qty: "20.000000", unitCost: "85.000000", taxRatePercent: 14, batchNo: null, expiryDate: null }],
    status: "confirmed",
    subtotal: "1700.000000",
    tax: "238.000000",
    total: "1938.000000",
    amountPaid: "0.000000",
    remainingBalance: "1938.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

function purchaseReturn(overrides: Partial<PurchaseReturnDocumentDTO> = {}): PurchaseReturnDocumentDTO {
  return {
    id: "pr-1",
    docType: "PURCHASE_RETURN",
    docNo: "PR-000001",
    date: "2026-08-21",
    memo: "",
    status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", supplierId: "sup-1", sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-000001", reason: "DEFECTIVE", availableQty: "20.000000", qty: "3.000000",
        unitCost: "85.000000", taxAmount: "35.700000",
      },
    ],
    createdAt: "2026-08-21T09:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

function baseHandlers(returns: PurchaseReturnDocumentDTO[]) {
  return {
    "GET /purchases/invoices": () => ({ body: [purchaseInvoice()] }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /suppliers": () => ({ body: suppliers }),
    "GET /items": () => ({ body: items }),
    "GET /purchase-returns": () => ({ body: returns }),
  };
}

describe("PurchaseReturnsScreen", () => {
  it("shows the empty state when there are no returns", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "مرتجعات المشتريات" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeInTheDocument();
  });

  it("lists purchase returns from the real API, sourced from a real confirmed purchase invoice", async () => {
    const transport = stubTransport(baseHandlers([purchaseReturn()]));
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("PR-000001")).toBeInTheDocument();
    expect(screen.getByText("شركة النيل للتوريدات")).toBeInTheDocument();
  });

  it("creates a draft return against a confirmed purchase invoice", async () => {
    let current: PurchaseReturnDocumentDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /purchase-returns": () => ({ body: current }),
      "POST /purchase-returns": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = purchaseReturn({ id: body.id, docNo: null, status: "draft" });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getByRole("button", { name: "مرتجع جديد" }));
    const dialog = screen.getByRole("dialog", { name: "مرتجع مشتريات جديد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("شركة النيل للتوريدات")).toBeInTheDocument();
  });

  it("confirms then cancels a draft return", async () => {
    let current: PurchaseReturnDocumentDTO[] = [purchaseReturn()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /purchase-returns": () => ({ body: current }),
      "POST /purchase-returns/pr-1/confirm": () => {
        current = current.map((d) => (d.id === "pr-1" ? { ...d, status: "confirmed" as const, confirmedAt: "2026-08-21T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
      "POST /purchase-returns/pr-1/cancel": () => {
        current = current.map((d) => (d.id === "pr-1" ? { ...d, status: "cancelled" as const } : d));
        return { body: current[0] };
      },
    });
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("PR-000001"));
    const dialog = screen.getByRole("dialog", { name: "PR-000001" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد المرتجع" }));
    expect(await within(dialog).findByRole("button", { name: "إلغاء المرتجع" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء المرتجع" }));
    await within(dialog).findByText("ملغي");
  });
});
