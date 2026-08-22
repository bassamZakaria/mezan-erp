// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StockBalanceScreen } from "./StockBalanceScreen";

describe("StockBalanceScreen — cross-warehouse rollup", () => {
  it("renders the rolled-up on-hand qty and value for the seeded items", async () => {
    render(<StockBalanceScreen />);
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
    render(<StockBalanceScreen />);
    await waitFor(() => expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الكود..."), { target: { value: "سكر" } });
    expect(screen.queryByText("أرز أبيض مصري 5 كجم (ITM-000001)")).not.toBeInTheDocument();
    expect(screen.getByText("سكر أبيض 1 كجم (ITM-000008)")).toBeInTheDocument();
  });
});
