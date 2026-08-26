// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ItemDTO, LandedCostDocumentDTO, PurchaseInvoiceDTO, WarehouseDTO } from "@mezan/contracts";
import { LandedCostsScreen } from "./LandedCostsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const warehouses: WarehouseDTO[] = [{ id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الفرع الرئيسي", branchId: "MAIN", type: "MAIN", isDefault: true, active: true }];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
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

function landedCost(overrides: Partial<LandedCostDocumentDTO> = {}): LandedCostDocumentDTO {
  return {
    id: "lc-1",
    docType: "LANDED_COST",
    docNo: "LC-000001",
    date: "2026-08-21",
    memo: "",
    status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", sourceInvoiceId: "pi-1", sourceInvoiceNumber: "PI-000001",
        qty: "20.000000", unitCost: "85.000000", allocatedAmount: "200.000000", newUnitCost: "95.000000",
        distributionMethod: "BY_VALUE", costItems: [{ costType: "SHIPPING", description: "شحن", amount: "200.000000" }],
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

function baseHandlers(docs: LandedCostDocumentDTO[]) {
  return {
    "GET /purchases/invoices": () => ({ body: [purchaseInvoice()] }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /landed-costs": () => ({ body: docs }),
  };
}

describe("LandedCostsScreen", () => {
  it("shows the empty state when there are no landed cost documents", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<LandedCostsScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "التكاليف الإضافية" })).toBeInTheDocument();
    expect(await screen.findByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات")).toBeInTheDocument();
  });

  it("lists landed cost documents from the real API", async () => {
    const transport = stubTransport(baseHandlers([landedCost()]));
    renderWithProviders(<LandedCostsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("LC-000001")).toBeInTheDocument();
    // "حسب القيمة" also labels an option in the (always-mounted, closed) create panel's select, so assert presence via getAllByText rather than a single unique match.
    expect((await screen.findAllByText("حسب القيمة")).length).toBeGreaterThan(0);
  });

  it("creates a draft landed-cost document against a confirmed purchase invoice, with a live allocation preview", async () => {
    let current: LandedCostDocumentDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /landed-costs": () => ({ body: current }),
      "POST /landed-costs": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = landedCost({ id: body.id, docNo: null, status: "draft" });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<LandedCostsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات");
    fireEvent.click(screen.getByRole("button", { name: "مستند تكلفة جديد" }));
    const dialog = screen.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });
    const amountInput = within(dialog).getByLabelText("المبلغ");
    fireEvent.change(amountInput, { target: { value: "200" } });
    expect(await within(dialog).findByText("معاينة التوزيع")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(screen.queryByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات")).not.toBeInTheDocument());
  });

  it("confirms then cancels a draft landed-cost document", async () => {
    let current: LandedCostDocumentDTO[] = [landedCost()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /landed-costs": () => ({ body: current }),
      "POST /landed-costs/lc-1/confirm": () => {
        current = current.map((d) => (d.id === "lc-1" ? { ...d, status: "confirmed" as const, confirmedAt: "2026-08-21T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
      "POST /landed-costs/lc-1/cancel": () => {
        current = current.map((d) => (d.id === "lc-1" ? { ...d, status: "cancelled" as const } : d));
        return { body: current[0] };
      },
    });
    renderWithProviders(<LandedCostsScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("LC-000001"));
    const dialog = screen.getByRole("dialog", { name: "LC-000001" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد التوزيع" }));
    expect(await within(dialog).findByRole("button", { name: "إلغاء المستند" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء المستند" }));
    await within(dialog).findByText("ملغي");
  });
});
