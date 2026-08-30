// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { renderWithProviders } from "../data/test-support";
import { AppProviders } from "../data/AppProviders";
import { ExpenseDonut, type DonutSlice } from "./ExpenseDonut";

function withProviders(ui: ReactElement) {
  return (
    <AppProviders>
      <MemoryRouter>{ui}</MemoryRouter>
    </AppProviders>
  );
}

const slices: DonutSlice[] = [
  { key: "cogs", label: "تكلفة البضاعة", value: 3000 },
  { key: "rent", label: "الإيجار", value: 1000 },
];

describe("ExpenseDonut", () => {
  it("renders the empty label when the total is zero or negative", () => {
    renderWithProviders(<ExpenseDonut slices={[]} centreCaption="الإجمالي" emptyLabel="لا توجد مصروفات" />);
    expect(screen.getByText("لا توجد مصروفات")).toBeInTheDocument();
  });

  it("renders the empty label when every slice is zero", () => {
    renderWithProviders(
      <ExpenseDonut slices={[{ key: "a", label: "a", value: 0 }]} centreCaption="الإجمالي" emptyLabel="لا توجد مصروفات" />,
    );
    expect(screen.getByText("لا توجد مصروفات")).toBeInTheDocument();
  });

  it("shows the formatted total in the centre caption area and each slice's label and money figure", () => {
    renderWithProviders(<ExpenseDonut slices={slices} centreCaption="الإجمالي" emptyLabel="لا توجد مصروفات" />);
    expect(screen.getByText("4,000.00")).toBeInTheDocument();
    expect(screen.getByText("تكلفة البضاعة")).toBeInTheDocument();
    expect(screen.getByText("3,000.00")).toBeInTheDocument();
    expect(screen.getByText("الإيجار")).toBeInTheDocument();
    expect(screen.getByText("1,000.00")).toBeInTheDocument();
  });

  it("computes each slice's share percentage of the total", () => {
    renderWithProviders(<ExpenseDonut slices={slices} centreCaption="الإجمالي" emptyLabel="لا توجد مصروفات" />);
    // 3000 / 4000 = 75%, 1000 / 4000 = 25%
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("survives a re-render with new slices", () => {
    const { rerender } = renderWithProviders(
      <ExpenseDonut slices={slices} centreCaption="الإجمالي" emptyLabel="لا توجد مصروفات" />,
    );
    expect(screen.getByText("4,000.00")).toBeInTheDocument();

    rerender(
      withProviders(
        <ExpenseDonut
          slices={[{ key: "new", label: "صيانة", value: 500 }]}
          centreCaption="الإجمالي"
          emptyLabel="لا توجد مصروفات"
        />,
      ),
    );
    // A single slice equal to the total means the figure shows twice (centre + legend row).
    expect(screen.getAllByText("500.00").length).toBe(2);
    expect(screen.queryByText("تكلفة البضاعة")).not.toBeInTheDocument();
  });
});
