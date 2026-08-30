// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import type { InventoryStockLevelsRow } from "@mezan/domain";
import type { ItemDTO } from "@mezan/contracts";
import { InventoryHubScreen } from "./InventoryHubScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

function makeItem(overrides: Partial<ItemDTO>): ItemDTO {
  return {
    id: "ITEM-1",
    code: "I-0001",
    nameAr: "صنف",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCE",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    seasonId: null,
    description: null,
    defaultSupplierId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
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

// Three items (two active, one inactive) and a single row needing attention —
// counts (3, 2, 1) are deliberately distinct so each stat tile is unambiguous.
const sampleItems: ItemDTO[] = [
  makeItem({ id: "ITEM-1", code: "I-0001", status: "active" }),
  makeItem({ id: "ITEM-2", code: "I-0002", status: "active" }),
  makeItem({ id: "ITEM-3", code: "I-0003", status: "inactive" }),
];

const lowRow: InventoryStockLevelsRow = {
  itemId: "ITEM-3",
  itemNameAr: "سكر",
  itemNameEn: null,
  sku: "I-0003",
  warehouseCount: 1,
  onHand: 4,
  averageCost: 5,
  value: 15,
  status: "low",
};

const outRow: InventoryStockLevelsRow = {
  itemId: "ITEM-1",
  itemNameAr: "زيت طهي",
  itemNameEn: null,
  sku: "I-0001",
  warehouseCount: 1,
  onHand: 0,
  averageCost: 10,
  value: 0,
  status: "out",
};

const sampleRows: InventoryStockLevelsRow[] = [lowRow];

function stockLevelsBody(rows: InventoryStockLevelsRow[]) {
  return {
    rows,
    groups: [],
    grandTotals: { value: 12345.6 },
    reconciliation: null,
  };
}

function baseTransport(overrides: Record<string, () => { status?: number; body: unknown }> = {}) {
  return stubTransport({
    "GET /items": () => ({ body: sampleItems }),
    "GET /reports/inventory/stock-levels": () => ({ body: stockLevelsBody(sampleRows) }),
    ...overrides,
  });
}

function renderScreen(overrides?: Record<string, () => { status?: number; body: unknown }>) {
  const transport = baseTransport(overrides);
  return renderWithProviders(<InventoryHubScreen />, { transport, initialSession: testAdminSession });
}

describe("InventoryHubScreen", () => {
  it("renders stat tiles from the real items list and stock-levels report", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "المخزون" })).toBeInTheDocument();
    expect(await screen.findByText("3")).toBeInTheDocument(); // total items
    expect(await screen.findByText("2")).toBeInTheDocument(); // active items
    expect(await screen.findByText("1")).toBeInTheDocument(); // one item needs attention
    expect(await screen.findByText("12,345.60")).toBeInTheDocument(); // inventory value
    expect(await screen.findByText("ج.م")).toBeInTheDocument();
  });

  it("renders the needs-attention list from the report's rows, with out and low statuses", async () => {
    renderScreen({
      "GET /reports/inventory/stock-levels": () => ({ body: stockLevelsBody([outRow, lowRow]) }),
    });
    expect(await screen.findByText("زيت طهي")).toBeInTheDocument();
    expect(await screen.findByText("سكر")).toBeInTheDocument();
    expect(await screen.findByText("نافد")).toBeInTheDocument();
    expect(await screen.findByText("منخفض")).toBeInTheDocument();
  });

  it("shows the configured empty state when nothing needs attention", async () => {
    renderScreen({
      "GET /reports/inventory/stock-levels": () => ({
        body: stockLevelsBody([{ ...sampleRows[0]!, status: "normal" }]),
      }),
    });
    expect(await screen.findByText("لا توجد أصناف تحتاج انتباهاً حالياً.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails", async () => {
    renderScreen({ "GET /items": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات المخزون.");
    expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument();
  });
});
