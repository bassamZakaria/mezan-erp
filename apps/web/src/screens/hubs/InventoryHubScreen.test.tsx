// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor} from "@testing-library/react";
import { StockLevelStatusDTO, type StockLevelsAttentionRowDTO, type StockLevelsSummaryDTO } from "@mezan/contracts";
import { InventoryHubScreen } from "./InventoryHubScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

// Three items (two active) and a single row needing attention — counts
// (3, 2, 1) are deliberately distinct so each stat tile is unambiguous.
const itemCounts = { all: 3, active: 2, inactive: 1 };

const lowRow: StockLevelsAttentionRowDTO = {
  itemId: "ITEM-3",
  itemNameAr: "سكر",
  itemNameEn: null,
  sku: "I-0003",
  onHand: "1250.500000",
  status: StockLevelStatusDTO.Low,
};

const outRow: StockLevelsAttentionRowDTO = {
  itemId: "ITEM-1",
  itemNameAr: "زيت طهي",
  itemNameEn: null,
  sku: "I-0001",
  onHand: "0.000000",
  status: StockLevelStatusDTO.Out,
};

function summaryBody(attention: StockLevelsAttentionRowDTO[]): StockLevelsSummaryDTO {
  const low = attention.filter((row) => row.status === StockLevelStatusDTO.Low);
  return { totalValue: "12345.600000", needsAttentionCount: attention.length, lowCount: low.length, attention, firstLow: low[0] ?? null };
}

const SUMMARY = "GET /reports/inventory/stock-levels/summary";

function baseTransport(overrides: Record<string, () => { status?: number; body: unknown }> = {}) {
  return stubTransport({
    "GET /items/counts": () => ({ body: itemCounts }),
    [SUMMARY]: () => ({ body: summaryBody([lowRow]) }),
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
      [SUMMARY]: () => ({ body: summaryBody([outRow, lowRow]) }),
    });
    expect(await screen.findByText("زيت طهي")).toBeInTheDocument();
    expect(await screen.findByText("سكر")).toBeInTheDocument();
    expect(await screen.findByText("نافد")).toBeInTheDocument();
    expect(await screen.findByText("منخفض")).toBeInTheDocument();
    expect(await screen.findByText("1,250.5")).toBeInTheDocument();
  });

  it("never downloads the item catalogue or the full stock-levels report", async () => {
    const asked: string[] = [];
    const inner = baseTransport();
    renderWithProviders(<InventoryHubScreen />, { transport: (path, init) => (asked.push(path.split("?")[0]!), inner(path, init)), initialSession: testAdminSession });
    expect(await screen.findByText("12,345.60")).toBeInTheDocument();
    expect(asked).toContain("/items/counts");
    expect(asked).not.toContain("/items");
    expect(asked).toContain("/reports/inventory/stock-levels/summary");
    expect(asked).not.toContain("/reports/inventory/stock-levels");
  });

  it("shows the configured empty state when nothing needs attention", async () => {
    renderScreen({
      [SUMMARY]: () => ({ body: summaryBody([]) }),
    });
    expect(await screen.findByText("لا توجد أصناف تحتاج انتباهاً حالياً.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails", async () => {
    renderScreen({ "GET /items/counts": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات المخزون.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });
});
