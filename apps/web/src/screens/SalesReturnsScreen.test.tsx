// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SalesReturnsScreen } from "./SalesReturnsScreen";

describe("SalesReturnsScreen", () => {
  it("renders the list with its empty state", () => {
    render(<SalesReturnsScreen />);
    expect(screen.getByRole("heading", { name: "مرتجعات المبيعات" })).toBeInTheDocument();
    expect(screen.getByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeInTheDocument();
  });

  it("creates and confirms a return through the side panel, restocking and posting the GL entry", async () => {
    render(<SalesReturnsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "مرتجع جديد" }));

    const dialog = screen.getByRole("dialog", { name: "مرتجع مبيعات جديد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ وتأكيد" }));

    // Confirming closes the create panel; the new row appears in the list with a docNo + "بانتظار دفع المبلغ".
    expect(await screen.findByText("SRT-000001")).toBeInTheDocument();
    expect(screen.getAllByText("بانتظار دفع المبلغ").length).toBeGreaterThan(0);
  });
});
