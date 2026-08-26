// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ItemDTO, StockBalanceRowDTO } from "@mezan/contracts";
import { StockBalanceScreen } from "./StockBalanceScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "itm-1",
    code: "ITM-000001",
    nameAr: "أرز أبيض مصري 5 كجم",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: "0",
    costPrice: "0",
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
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

const items: ItemDTO[] = [
  item(),
  item({ id: "itm-2", code: "ITM-000002", nameAr: "زيت عباد الشمس 1 لتر", nameEn: "Sunflower Oil 1L" }),
  item({ id: "itm-8", code: "ITM-000008", nameAr: "سكر أبيض 1 كجم" }),
];

const rows: StockBalanceRowDTO[] = [
  { itemId: "itm-1", onHand: "100.000000", totalValue: "1000.000000", averageCost: "10.000000", warehouseCount: 2, reserved: "0.000000", available: "100.000000", warehouses: [] },
  { itemId: "itm-2", onHand: "195.000000", totalValue: "1950.000000", averageCost: "10.000000", warehouseCount: 1, reserved: "0.000000", available: "195.000000", warehouses: [] },
  { itemId: "itm-8", onHand: "147.000000", totalValue: "735.000000", averageCost: "5.000000", warehouseCount: 1, reserved: "0.000000", available: "147.000000", warehouses: [] },
];

function renderScreen() {
  const transport = stubTransport({
    "GET /inventory/stock-balance": () => ({ body: { rows } }),
    "GET /items": () => ({ body: items }),
  });
  return renderWithProviders(<StockBalanceScreen />, { transport, initialSession: testAdminSession });
}

describe("StockBalanceScreen — cross-warehouse rollup", () => {
  it("renders the rolled-up on-hand qty and value from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "أرصدة المخزون" })).toBeInTheDocument();

    // itm-1: 100 opening balance, transferred (not consumed) — total on-hand stays 100 across warehouses.
    await waitFor(() => expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument());
    expect(screen.getByText("100.000000")).toBeInTheDocument();

    // itm-2: 200 opening balance − 5 damaged = 195, unaffected by the later transfer.
    expect(screen.getByText("زيت عباد الشمس 1 لتر (ITM-000002)")).toBeInTheDocument();
    expect(screen.getByText("195.000000")).toBeInTheDocument();

    // itm-8: 150 opening balance − 3 physical-count correction = 147.
    expect(screen.getByText("سكر أبيض 1 كجم (ITM-000008)")).toBeInTheDocument();
    expect(screen.getByText("147.000000")).toBeInTheDocument();
  });

  it("filters by item name via the search box", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الكود..."), { target: { value: "سكر" } });
    expect(screen.queryByText("أرز أبيض مصري 5 كجم (ITM-000001)")).not.toBeInTheDocument();
    expect(screen.getByText("سكر أبيض 1 كجم (ITM-000008)")).toBeInTheDocument();
  });
});
