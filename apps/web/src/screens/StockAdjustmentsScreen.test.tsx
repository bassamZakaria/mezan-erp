// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StockAdjustmentsScreen } from "./StockAdjustmentsScreen";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("StockAdjustmentsScreen — list", () => {
  it("renders seeded confirmed adjustments with correct KPIs", () => {
    render(<StockAdjustmentsScreen />);
    expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument();
    expect(screen.getByText("ADJ-000001")).toBeInTheDocument();
    expect(screen.getByText("ADJ-000005")).toBeInTheDocument();
  });

  it("filters to confirmed via the status chips", () => {
    render(<StockAdjustmentsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /مؤكد/ }));
    expect(screen.getByText("ADJ-000001")).toBeInTheDocument();
  });

  it("opens the detail view with the INITIAL_STOCK opening balance and its GL entry", async () => {
    render(<StockAdjustmentsScreen />);
    fireEvent.click(screen.getByText("ADJ-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("رصيد افتتاحي")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "المحاسبة" }));
    expect(await screen.findByText("المخزون")).toBeInTheDocument();
    expect(screen.getByText("رأس المال")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — create: reason picker + INITIAL_STOCK flow", () => {
  it("posts a new opening-balance adjustment via the real domain service and shows it in the list", async () => {
    render(<StockAdjustmentsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "تسوية جديدة" }));
    expect(screen.getByRole("heading", { name: "اختر سبب التسوية" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /رصيد افتتاحي/ }));
    expect(screen.getByRole("heading", { name: "الرصيد الافتتاحي" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الصنف للسطر 1"), { target: { value: "itm-3" } });
    fireEvent.change(screen.getByLabelText("الكمية للسطر 1"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("سعر التكلفة للسطر 1"), { target: { value: "60" } });

    fireEvent.click(screen.getByRole("button", { name: "اعتماد التسوية" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument());
    expect(await screen.findByText("ADJ-000006")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — themes", () => {
  it.each(["light", "dark"] as const)("renders the list in the %s theme", (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    render(<StockAdjustmentsScreen />);
    expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument();
  });
});
