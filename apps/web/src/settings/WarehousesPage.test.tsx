// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { WarehousesPage } from "./WarehousesPage";

describe("WarehousesPage", () => {
  it("lists the sample warehouses across the 5 catalog types", () => {
    render(<WarehousesPage />);
    expect(screen.getByRole("heading", { name: "المستودعات" })).toBeInTheDocument();
    expect(screen.getByText("مستودع الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("سياره نقل ١")).toBeInTheDocument();
    // The 5 type filter chips are rendered.
    for (const label of ["رئيسي", "مستودع وسيط", "مرتجعات", "إنتاج", "ڤان (سيارة توزيع)"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("filters the list by warehouse type", () => {
    render(<WarehousesPage />);
    fireEvent.click(screen.getByRole("button", { name: "ڤان (سيارة توزيع)" }));
    expect(screen.getByText("سياره نقل ١")).toBeInTheDocument();
    expect(screen.queryByText("مستودع الفرع الرئيسي")).not.toBeInTheDocument();
  });

  it("adds a new warehouse through the side panel, defaulting to type MAIN", () => {
    render(<WarehousesPage />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة مستودع" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مستودع" });
    fireEvent.change(within(dialog).getByLabelText("اسم المستودع"), { target: { value: "مستودع تجريبي" } });
    fireEvent.change(within(dialog).getByLabelText("رمز المستودع"), { target: { value: "WH-TEST" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ المستودع" }));

    expect(screen.getByText("مستودع تجريبي")).toBeInTheDocument();
  });
});
