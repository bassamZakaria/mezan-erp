// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { renderWithProviders } from "../data/test-support";
import { AppProviders } from "../data/AppProviders";
import { TopItems, type TopItemRow } from "./TopItems";

function withProviders(ui: ReactElement) {
  return (
    <AppProviders>
      <MemoryRouter>{ui}</MemoryRouter>
    </AppProviders>
  );
}

const rows: TopItemRow[] = [
  { key: "i1", rank: 1, name: "قهوة عربية", qty: 120, revenue: 5400.5, sharePercent: 80 },
  { key: "i2", rank: 2, name: "شاي أحمر", qty: 40, revenue: 900, sharePercent: 15 },
];

describe("TopItems", () => {
  it("renders the empty label when there are no rows", () => {
    renderWithProviders(<TopItems rows={[]} qtyUnitLabel="قطعة" emptyLabel="لا توجد بيانات" />);
    expect(screen.getByText("لا توجد بيانات")).toBeInTheDocument();
  });

  it("renders every row's name, quantity and a formatted money figure", () => {
    renderWithProviders(<TopItems rows={rows} qtyUnitLabel="قطعة" emptyLabel="لا توجد بيانات" />);
    expect(screen.getByText("قهوة عربية")).toBeInTheDocument();
    expect(screen.getByText("شاي أحمر")).toBeInTheDocument();
    // format.money renders with two decimals and thousands separators, not the raw number.
    expect(screen.getByText("5,400.50")).toBeInTheDocument();
    expect(screen.getByText("900.00")).toBeInTheDocument();
  });

  it("clamps the share bar width between 2% and 100%", () => {
    const { container } = renderWithProviders(
      <TopItems
        rows={[
          { key: "over", rank: 1, name: "over", qty: 1, revenue: 1, sharePercent: 250 },
          { key: "under", rank: 2, name: "under", qty: 1, revenue: 1, sharePercent: 0 },
        ]}
        qtyUnitLabel="قطعة"
        emptyLabel="لا توجد بيانات"
      />,
    );
    const bars = container.querySelectorAll<HTMLDivElement>(".bg-chart-1");
    expect(bars[0]?.style.width).toBe("100%");
    expect(bars[1]?.style.width).toBe("2%");
  });

  it("keeps showing the formatted figure after a re-render with new rows", () => {
    const { rerender } = renderWithProviders(<TopItems rows={rows} qtyUnitLabel="قطعة" emptyLabel="لا توجد بيانات" />);
    expect(screen.getByText("5,400.50")).toBeInTheDocument();

    rerender(
      withProviders(
        <TopItems
          rows={[{ key: "i3", rank: 1, name: "زيت", qty: 5, revenue: 250, sharePercent: 50 }]}
          qtyUnitLabel="قطعة"
          emptyLabel="لا توجد بيانات"
        />,
      ),
    );
    expect(screen.getByText("250.00")).toBeInTheDocument();
    expect(screen.queryByText("قهوة عربية")).not.toBeInTheDocument();
  });
});
