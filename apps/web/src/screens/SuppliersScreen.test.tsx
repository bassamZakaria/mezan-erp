// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SuppliersScreen } from "./SuppliersScreen";

describe("SuppliersScreen", () => {
  it("lists the sample suppliers", () => {
    render(<SuppliersScreen />);
    expect(screen.getByRole("heading", { name: "الموردون" })).toBeInTheDocument();
    expect(screen.getByText("جاري")).toBeInTheDocument();
    expect(screen.getByText("S000001")).toBeInTheDocument();
  });

  it("opens the supplier detail on row click, with an overview tab and statement/attachments stubs", () => {
    render(<SuppliersScreen />);
    fireEvent.click(screen.getByText("جاري"));
    expect(screen.getByRole("heading", { name: /جاري/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "كشف حساب المورد" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المرفقات" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));
    expect(screen.getAllByText("قريباً").length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", () => {
    render(<SuppliersScreen />);
    fireEvent.click(screen.getByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة الموردين" }));
    expect(screen.getByRole("heading", { name: "الموردون" })).toBeInTheDocument();
  });

  it("filters by status chip", () => {
    render(<SuppliersScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    expect(screen.queryByText("جاري")).not.toBeInTheDocument();
    expect(screen.getByText("مورد قطع الغيار الشرقي")).toBeInTheDocument();
  });

  it("adds a new supplier through the side panel", () => {
    render(<SuppliersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    fireEvent.change(within(dialog).getByLabelText("اسم المورد *"), { target: { value: "مورد تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));

    expect(screen.getByText("مورد تجريبي")).toBeInTheDocument();
  });

  it("shows an Arabic domain validation error instead of adding an invalid supplier", () => {
    render(<SuppliersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    // Leave the required Arabic name empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));
    expect(within(dialog).getByText("الاسم بالعربية مطلوب")).toBeInTheDocument();
  });

  it("edits an existing supplier from the detail view without clobbering its opening balance", () => {
    render(<SuppliersScreen />);
    fireEvent.click(screen.getByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل مورد" });
    fireEvent.change(within(dialog).getByLabelText("الهاتف"), { target: { value: "01000000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(screen.getByText(/3,200|3200/)).toBeInTheDocument();
  });

  it("lets an editing supplier be toggled inactive via the active/inactive switch", () => {
    render(<SuppliersScreen />);
    fireEvent.click(screen.getByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل مورد" });
    expect(within(dialog).getByRole("switch", { name: "نشط" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(screen.getByText("غير نشط")).toBeInTheDocument();
  });
});
