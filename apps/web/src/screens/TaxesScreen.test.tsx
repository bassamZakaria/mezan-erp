// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TaxesScreen } from "./TaxesScreen";

describe("TaxesScreen", () => {
  it("lists the sample tax rates with the default badge", () => {
    render(<TaxesScreen />);
    expect(screen.getByRole("heading", { name: "الضرائب" })).toBeInTheDocument();
    expect(screen.getByText("ضريبة القيمة المضافة 14%")).toBeInTheDocument();
    expect(screen.getByText("الافتراضي")).toBeInTheDocument();
    expect(screen.getByText("14.00%")).toBeInTheDocument();
  });

  it("adds a new tax rate through the side panel", () => {
    render(<TaxesScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة ضريبة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة ضريبة" });
    fireEvent.change(within(dialog).getByLabelText("اسم الضريبة *"), { target: { value: "ضريبة تجريبية" } });
    fireEvent.change(within(dialog).getByLabelText("رمز الضريبة *"), { target: { value: "TEST5" } });
    fireEvent.change(within(dialog).getByLabelText("نسبة الضريبة (%) *"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.getByText("ضريبة تجريبية")).toBeInTheDocument();
  });

  it("rejects a duplicate tax code with an inline error", () => {
    render(<TaxesScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة ضريبة" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة ضريبة" });
    fireEvent.change(within(dialog).getByLabelText("اسم الضريبة *"), { target: { value: "نسخة" } });
    fireEvent.change(within(dialog).getByLabelText("رمز الضريبة *"), { target: { value: "VAT14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.getByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("edits an existing tax rate and flips off the previous default when a new one is marked default", () => {
    render(<TaxesScreen />);
    const row = screen.getByText("ضريبة خصم وإضافة 1%").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل ضريبة" });
    fireEvent.click(within(dialog).getByRole("switch", { name: "ضريبة افتراضية" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    // Only one "الافتراضي" badge should remain, now on the edited row.
    expect(screen.getAllByText("الافتراضي")).toHaveLength(1);
  });
});
