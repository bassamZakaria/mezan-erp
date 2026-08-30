// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

const items: ItemDTO[] = [
  item(),
  item({ id: "itm-2", code: "ITM-000002", nameAr: "زيت عباد الشمس 1 لتر", nameEn: "Sunflower Oil 1L" }),
  item({ id: "itm-8", code: "ITM-000008", nameAr: "سكر أبيض 1 كجم" }),
];

const rows: StockBalanceRowDTO[] = [
  { itemId: "itm-1", onHand: "100.000000", totalValue: "1000.000000", averageCost: "10.000000", warehouseCount: 2, reserved: "15.000000", available: "85.000000", warehouses: [] },
  { itemId: "itm-2", onHand: "195.000000", totalValue: "1950.000000", averageCost: "10.000000", warehouseCount: 1, reserved: "0.000000", available: "195.000000", warehouses: [] },
  { itemId: "itm-8", onHand: "147.000000", totalValue: "735.000000", averageCost: "5.000000", warehouseCount: 1, reserved: "0.000000", available: "147.000000", warehouses: [] },
];

function rowFor(itemLabel: string): HTMLElement {
  const cell = screen.getByText(itemLabel).closest("tr");
  if (!cell) throw new Error(`no <tr> ancestor for "${itemLabel}"`);
  return cell as HTMLElement;
}

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

    // itm-1: 100 on-hand across warehouses, 15 reserved leaves 85 available.
    // Qty trims the API's six-decimal string down to a bare integer for display.
    await waitFor(() => expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument());
    const itm1Row = within(rowFor("أرز أبيض مصري 5 كجم (ITM-000001)"));
    expect(itm1Row.getByText("100")).toBeInTheDocument();
    expect(itm1Row.getByText("15")).toBeInTheDocument();
    expect(itm1Row.getByText("85")).toBeInTheDocument();

    // itm-2: 200 opening balance − 5 damaged = 195, unaffected by the later transfer.
    // No reservation, so on-hand and available both render "195" in this row.
    expect(screen.getByText("زيت عباد الشمس 1 لتر (ITM-000002)")).toBeInTheDocument();
    expect(within(rowFor("زيت عباد الشمس 1 لتر (ITM-000002)")).getAllByText("195")).toHaveLength(2);

    // itm-8: 150 opening balance − 3 physical-count correction = 147.
    expect(screen.getByText("سكر أبيض 1 كجم (ITM-000008)")).toBeInTheDocument();
    expect(within(rowFor("سكر أبيض 1 كجم (ITM-000008)")).getAllByText("147")).toHaveLength(2);
  });

  it("filters by item name via the search box", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الكود..."), { target: { value: "سكر" } });
    // The search box settles into the URL (and the filter) after a 300ms debounce.
    await waitFor(() => expect(screen.queryByText("أرز أبيض مصري 5 كجم (ITM-000001)")).not.toBeInTheDocument());
    expect(screen.getByText("سكر أبيض 1 كجم (ITM-000008)")).toBeInTheDocument();
  });

  it("shows a retry control when the balance rollup fails to load", async () => {
    const transport = stubTransport({
      "GET /inventory/stock-balance": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /items": () => ({ body: items }),
    });
    renderWithProviders(<StockBalanceScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل أرصدة المخزون.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("shows the empty state when no balance rows are returned", async () => {
    const transport = stubTransport({
      "GET /inventory/stock-balance": () => ({ body: { rows: [] } }),
      "GET /items": () => ({ body: items }),
    });
    renderWithProviders(<StockBalanceScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("لا توجد أصناف مطابقة")).toBeInTheDocument();
  });
});
