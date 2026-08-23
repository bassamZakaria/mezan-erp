// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { StockBalanceRowDTO } from "@mezan/contracts";
import { StockBalanceScreen } from "./StockBalanceScreen";
import { TEST_ITEMS } from "./inventory-ops-test-fixtures";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const ROWS: StockBalanceRowDTO[] = [
  { itemId: "itm-1", onHand: "100.000000", totalValue: "3200.000000", averageCost: "32.000000", warehouseCount: 2 },
  { itemId: "itm-2", onHand: "195.000000", totalValue: "5850.000000", averageCost: "30.000000", warehouseCount: 1 },
  { itemId: "itm-8", onHand: "147.000000", totalValue: "2205.000000", averageCost: "15.000000", warehouseCount: 1 },
];

function renderScreen() {
  return renderWithProviders(<StockBalanceScreen />, {
    transport: stubTransport({
      "GET /inventory/stock-balance": () => ({ body: { rows: ROWS } }),
      "GET /items": () => ({ body: TEST_ITEMS }),
    }),
    initialSession: testAdminSession,
  });
}

describe("StockBalanceScreen — cross-warehouse rollup", () => {
  it("renders the rolled-up on-hand qty and value the API returns", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "أرصدة المخزون" })).toBeInTheDocument();

    expect(await screen.findByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument();
    expect(screen.getByText("100.000000")).toBeInTheDocument();

    expect(screen.getByText("زيت عباد الشمس 1 لتر (ITM-000002)")).toBeInTheDocument();
    expect(screen.getByText("195.000000")).toBeInTheDocument();

    expect(screen.getByText("سكر أبيض 1 كجم (ITM-000008)")).toBeInTheDocument();
    expect(screen.getByText("147.000000")).toBeInTheDocument();
  });

  it("filters by item name via the search box", async () => {
    renderScreen();
    expect(await screen.findByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الكود..."), { target: { value: "سكر" } });
    expect(screen.queryByText("أرز أبيض مصري 5 كجم (ITM-000001)")).not.toBeInTheDocument();
    expect(screen.getByText("سكر أبيض 1 كجم (ITM-000008)")).toBeInTheDocument();
  });
});
