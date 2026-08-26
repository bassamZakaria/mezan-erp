// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { GoodsReceiptDTO, ItemDTO, PurchaseInvoiceDTO, PurchaseOrderDTO, SupplierDTO } from "@mezan/contracts";
import { PurchaseOrdersScreen } from "./PurchaseOrdersScreen";
import { GoodsReceiptsScreen } from "./GoodsReceiptsScreen";
import { PurchaseInvoicesScreen } from "./PurchaseInvoicesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const suppliers: SupplierDTO[] = [
  {
    id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null,
  },
];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

function purchaseOrder(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "po-1",
    number: "PO-000003",
    supplierId: "sup-1",
    date: "2026-08-18",
    expectedDeliveryDate: "2026-08-25",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: "توريد دفعة أسمنت",
    lines: [{ itemId: "item-cement", description: null, qty: "200.000000", unitPrice: "85.000000", receivedQty: "0.000000" }],
    status: "draft",
    subtotal: "17000.000000",
    total: "17000.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-18T09:00:00.000Z",
    ...overrides,
  };
}

function goodsReceipt(overrides: Partial<GoodsReceiptDTO> = {}): GoodsReceiptDTO {
  return {
    id: "gr-1",
    number: "GR-000001",
    purchaseOrderId: "po-2",
    supplierId: "sup-1",
    warehouseId: "MAIN-WH",
    date: "2026-08-19",
    notes: null,
    lines: [{ itemId: "item-cement", description: null, qty: "20.000000", unitCost: "85.000000", batchNo: null, expiryDate: null }],
    status: "confirmed",
    invoiced: false,
    totalCost: "1700.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

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
    lines: [{ itemId: "item-cement", description: null, kind: "inventory", qty: "1.000000", unitCost: "100.000000", taxRatePercent: 0, batchNo: null, expiryDate: null }],
    status: "confirmed",
    subtotal: "100.000000",
    tax: "0.000000",
    total: "100.000000",
    amountPaid: "0.000000",
    remainingBalance: "100.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

describe("PurchaseOrdersScreen", () => {
  function renderScreen(orders: PurchaseOrderDTO[] = [purchaseOrder(), purchaseOrder({ id: "po-3", number: "PO-000001", status: "draft", subtotal: "1200.000000", total: "1200.000000" })]) {
    let current = [...orders];
    const transport = stubTransport({
      "GET /purchases/orders": () => ({ body: current }),
      "GET /suppliers": () => ({ body: suppliers }),
      "GET /items": () => ({ body: items }),
      "POST /purchases/orders/po-3/confirm": () => {
        current = current.map((o) => (o.id === "po-3" ? { ...o, status: "sent" as const } : o));
        return { body: current.find((o) => o.id === "po-3")! };
      },
    });
    return renderWithProviders(<PurchaseOrdersScreen />, { transport, initialSession: testAdminSession });
  }

  it("lists the purchase orders", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "أوامر الشراء" })).toBeInTheDocument();
    expect(await screen.findByText("PO-000003")).toBeInTheDocument();
  });

  it("opens a PO detail with the effects panel and a lines tab", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("PO-000003"));
    expect(screen.getByRole("heading", { name: /أمر شراء PO-000003/ })).toBeInTheDocument();
    expect(screen.getByText(/لا يؤثر أمر الشراء على المخزون/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /البنود/ })).toBeInTheDocument();
  });

  it("confirms a draft PO (draft → sent)", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("PO-000001")); // the draft one
    fireEvent.click(screen.getByRole("button", { name: "تأكيد وإرسال" }));
    expect(await screen.findByText("مرسل")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تأكيد وإرسال" })).not.toBeInTheDocument();
  });

  it("opens the new-PO side panel", async () => {
    renderScreen();
    await screen.findByText("PO-000003");
    fireEvent.click(screen.getByRole("button", { name: "أمر شراء جديد" }));
    expect(screen.getByRole("dialog", { name: "أمر شراء جديد" })).toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen", () => {
  function renderScreen() {
    const transport = stubTransport({
      "GET /purchases/receipts": () => ({ body: [goodsReceipt()] }),
      "GET /purchases/orders": () => ({ body: [purchaseOrder({ id: "po-2", status: "sent" })] }),
      "GET /suppliers": () => ({ body: suppliers }),
      "GET /items": () => ({ body: items }),
    });
    return renderWithProviders(<GoodsReceiptsScreen />, { transport, initialSession: testAdminSession });
  }

  it("lists the receipts and opens a confirmed receipt with stock effects", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "إيصالات الاستلام" })).toBeInTheDocument();
    fireEvent.click(await screen.findByText("GR-000001"));
    expect(screen.getByRole("heading", { name: /إيصال استلام GR-000001/ })).toBeInTheDocument();
    expect(screen.getByText(/تمت زيادة كمية المخزون/)).toBeInTheDocument();
  });

  it("opens the new-receipt panel with the create-from-PO note", async () => {
    renderScreen();
    await screen.findByText("GR-000001");
    fireEvent.click(screen.getByRole("button", { name: "إيصال استلام جديد" }));
    const dialog = screen.getByRole("dialog", { name: "إيصال استلام جديد" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/الاستلام يبدأ دائماً من أمر شراء/)).toBeInTheDocument();
  });
});

describe("PurchaseInvoicesScreen", () => {
  function renderScreen() {
    const transport = stubTransport({
      "GET /purchases/invoices": () => ({ body: [purchaseInvoice(), purchaseInvoice({ id: "pi-2", number: "PI-000002" })] }),
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /suppliers": () => ({ body: suppliers }),
      "GET /items": () => ({ body: items }),
    });
    return renderWithProviders(<PurchaseInvoicesScreen />, { transport, initialSession: testAdminSession });
  }

  it("lists the invoices", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "فواتير المشتريات" })).toBeInTheDocument();
    expect(await screen.findByText("PI-000001")).toBeInTheDocument();
    expect(screen.getByText("PI-000002")).toBeInTheDocument();
  });

  it("opens an invoice detail with the 3-point effects panel", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("PI-000001"));
    expect(screen.getByText(/يزيد المستحق للمورد/)).toBeInTheDocument();
    expect(screen.getByText(/لا يوجد دفع تلقائي/)).toBeInTheDocument();
  });

  it("toggles the creation method between manual and from-receipt", async () => {
    renderScreen();
    await screen.findByText("PI-000001");
    fireEvent.click(screen.getByRole("button", { name: "فاتورة مشتريات جديدة" }));
    expect(screen.getByRole("dialog", { name: "فاتورة مشتريات جديدة" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("من إيصال استلام"));
    expect(await screen.findByText("إيصال الاستلام *")).toBeInTheDocument();
  });
});
