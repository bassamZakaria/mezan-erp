// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor} from "@testing-library/react";
import type { InventoryStockLevelsRow } from "@mezan/domain";
import { InventoryHubScreen } from "./InventoryHubScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

// Three items (two active) and a single row needing attention — counts
// (3, 2, 1) are deliberately distinct so each stat tile is unambiguous.
const itemCounts = { all: 3, active: 2, inactive: 1 };

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
    "GET /items/counts": () => ({ body: itemCounts }),
    "GET /reports/inventory/stock-levels": () => ({ body: stockLevelsBody(sampleRows) }),
    ...overrides,
  });
}

function renderScreen(overrides?: Record<string, () => { status?: number; body: unknown }>) {
  const transport = baseTransport(overrides);
  return renderWithProviders(<InventoryHubScreen />, { transport, initialSession: testAdminSession });
}

describe("InventoryHubScreen", () => {
  it("renders stat tiles from the item counts and the stock-levels report", async () => {
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

  it("never downloads the item catalogue", async () => {
    const asked: string[] = [];
    const inner = baseTransport();
    renderWithProviders(<InventoryHubScreen />, { transport: (path, init) => (asked.push(path.split("?")[0]!), inner(path, init)), initialSession: testAdminSession });
    expect(await screen.findByText("12,345.60")).toBeInTheDocument();
    expect(asked).toContain("/items/counts");
    expect(asked).not.toContain("/items");
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
    renderScreen({ "GET /items/counts": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات المخزون.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });
});
