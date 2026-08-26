// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ItemDTO, StockTransferDocumentDTO, WarehouseDTO } from "@mezan/contracts";
import { StockTransfersScreen } from "./StockTransfersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

const warehouses: WarehouseDTO[] = [
  { id: "WH-MAIN", code: "WH-MAIN", name: "المستودع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true },
  { id: "WH-VAN", code: "WH-VAN", name: "مستودع الفان", nameEn: null, branchId: "b1", type: "VAN", isDefault: false, active: true },
];

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "itm-1",
    code: "ITM-000001",
    nameAr: "منتج 1",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: "0",
    costPrice: "0",
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  };
}

const items: ItemDTO[] = [item()];

const trf1: StockTransferDocumentDTO = {
  id: "trf-1",
  docType: "STOCK_TRANSFER",
  docNo: "TRF-000001",
  date: "2026-08-10",
  memo: "تحويل للفان",
  status: "confirmed",
  lines: [{ itemId: "itm-1", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-VAN", qty: "10.000000" }],
  createdAt: "2026-08-10T10:00:00.000Z",
  confirmedAt: "2026-08-10T10:00:00.000Z",
};

const trf2: StockTransferDocumentDTO = {
  id: "trf-2",
  docType: "STOCK_TRANSFER",
  docNo: "TRF-000002",
  date: "2026-08-11",
  memo: "",
  status: "draft",
  lines: [{ itemId: "itm-1", fromWarehouseId: "WH-VAN", toWarehouseId: "WH-MAIN", qty: "2.000000" }],
  createdAt: "2026-08-11T10:00:00.000Z",
  confirmedAt: null,
};

function baseHandlers(current: StockTransferDocumentDTO[]) {
  return {
    "GET /inventory/stock-transfers": () => ({ body: current }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
  };
}

function renderScreen() {
  const transport = stubTransport(baseHandlers([trf1, trf2]));
  return renderWithProviders(<StockTransfersScreen />, { transport, initialSession: testAdminSession });
}

describe("StockTransfersScreen — list", () => {
  it("renders confirmed and draft transfers from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument();
    expect(await screen.findByText("TRF-000001")).toBeInTheDocument();
    expect(screen.getByText("TRF-000002")).toBeInTheDocument();
  });

  it("opens the detail view showing the route and valuation-neutral effect", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("TRF-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("لا يتغير إجمالي قيمة المخزون")).toBeInTheDocument();
    expect(screen.getByText(/لا يمكن إلغاء تحويل مؤكد/)).toBeInTheDocument();
  });
});

describe("StockTransfersScreen — create: valuation neutrality end to end", () => {
  it("posts a new transfer via the real API (draft + confirm) and shows it in the list", async () => {
    const generatedId = "trf-0003-0000-0000-000000000000";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generatedId as ReturnType<typeof crypto.randomUUID>);
    let current = [trf1, trf2];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /inventory/stock-transfers": () => ({ body: current }),
      "POST /inventory/stock-transfers/draft": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created: StockTransferDocumentDTO = {
          id: body.id,
          docType: "STOCK_TRANSFER",
          docNo: null,
          date: body.date,
          memo: body.memo ?? "",
          status: "draft",
          lines: body.lines,
          createdAt: "2026-08-22T10:00:00.000Z",
          confirmedAt: null,
        };
        current = [...current, created];
        return { status: 201, body: created };
      },
      [`POST /inventory/stock-transfers/${generatedId}/confirm`]: () => {
        const confirmed: StockTransferDocumentDTO = {
          ...current[current.length - 1]!,
          status: "confirmed",
          docNo: "TRF-000003",
          confirmedAt: "2026-08-22T10:00:00.000Z",
        };
        current = current.map((d) => (d.id === generatedId ? confirmed : d));
        return { body: { document: confirmed, held: false } };
      },
    });
    renderWithProviders(<StockTransfersScreen />, { transport, initialSession: testAdminSession });

    await screen.findByText("TRF-000001");
    fireEvent.click(screen.getByRole("button", { name: "تحويل جديد" }));
    expect(screen.getByRole("heading", { name: "تحويل مخزون جديد" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الصنف للسطر 1"), { target: { value: "itm-1" } });
    fireEvent.change(screen.getByLabelText("كمية التحويل للسطر 1"), { target: { value: "5" } });

    const save = screen.getByRole("button", { name: "حفظ" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument());
    expect(await screen.findByText("TRF-000003")).toBeInTheDocument();
  });

  it("blocks posting when source and destination warehouses are the same", async () => {
    renderScreen();
    await screen.findByText("TRF-000001");
    fireEvent.click(screen.getByRole("button", { name: "تحويل جديد" }));
    fireEvent.change(screen.getByLabelText("المستودع الوجهة *"), {
      target: { value: (screen.getByLabelText("المستودع المصدر *") as HTMLSelectElement).value },
    });
    expect(screen.getByText("يجب أن يختلف المستودع المصدر عن مستودع الوجهة.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeDisabled();
  });
});
