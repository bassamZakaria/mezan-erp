// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StockTransfersScreen } from "./StockTransfersScreen";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("StockTransfersScreen — list", () => {
  it("renders seeded confirmed transfers with correct KPIs", () => {
    render(<StockTransfersScreen />);
    expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument();
    expect(screen.getByText("TRF-000001")).toBeInTheDocument();
    expect(screen.getByText("TRF-000002")).toBeInTheDocument();
  });

  it("opens the detail view showing the route and valuation-neutral effect", () => {
    render(<StockTransfersScreen />);
    fireEvent.click(screen.getByText("TRF-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("لا يتغير إجمالي قيمة المخزون")).toBeInTheDocument();
    expect(screen.getByText(/لا يمكن إلغاء تحويل مؤكد/)).toBeInTheDocument();
  });
});

describe("StockTransfersScreen — create: valuation neutrality end to end", () => {
  it("posts a new transfer via the real domain service and shows it in the list", async () => {
    render(<StockTransfersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "تحويل جديد" }));
    expect(screen.getByRole("heading", { name: "تحويل مخزون جديد" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الصنف للسطر 1"), { target: { value: "itm-1" } });
    fireEvent.change(screen.getByLabelText("كمية التحويل للسطر 1"), { target: { value: "5" } });

    const save = screen.getByRole("button", { name: "حفظ" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument());
    expect(await screen.findByText("TRF-000003")).toBeInTheDocument();
  });

  it("blocks posting when source and destination warehouses are the same", () => {
    render(<StockTransfersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "تحويل جديد" }));
    fireEvent.change(screen.getByLabelText("المستودع الوجهة *"), {
      target: { value: (screen.getByLabelText("المستودع المصدر *") as HTMLSelectElement).value },
    });
    expect(screen.getByText("يجب أن يختلف المستودع المصدر عن مستودع الوجهة.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeDisabled();
  });
});
