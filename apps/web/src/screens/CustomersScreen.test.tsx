// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CustomersScreen } from "./CustomersScreen";

describe("CustomersScreen", () => {
  it("lists the sample customers", () => {
    render(<CustomersScreen />);
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
    expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.getByText("C000001")).toBeInTheDocument();
  });

  it("opens the customer detail on row click, with an overview tab and statement/attachments stubs", () => {
    render(<CustomersScreen />);
    fireEvent.click(screen.getByText("شركة الأمل للتجارة"));
    expect(screen.getByRole("heading", { name: /شركة الأمل للتجارة/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "كشف حساب" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المرفقات" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));
    expect(screen.getAllByText("قريباً").length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", () => {
    render(<CustomersScreen />);
    fireEvent.click(screen.getByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة العملاء" }));
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
  });

  it("filters by status chip", () => {
    render(<CustomersScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    expect(screen.queryByText("شركة الأمل للتجارة")).not.toBeInTheDocument();
    expect(screen.getByText("مصنع الوادي الأخضر")).toBeInTheDocument();
  });

  it("adds a new customer through the side panel", () => {
    render(<CustomersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(within(dialog).getByLabelText("اسم العميل *"), { target: { value: "عميل تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    expect(screen.getByText("عميل تجريبي")).toBeInTheDocument();
  });

  it("shows an Arabic domain validation error instead of adding an invalid customer", () => {
    render(<CustomersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    // Leave the required Arabic name empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));
    expect(within(dialog).getByText("الاسم بالعربية مطلوب")).toBeInTheDocument();
  });

  it("edits an existing customer from the detail view without clobbering its credit limit", () => {
    render(<CustomersScreen />);
    fireEvent.click(screen.getByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });
    fireEvent.change(within(dialog).getByLabelText("الهاتف"), { target: { value: "01000000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(screen.getByText(/15,000|15000/)).toBeInTheDocument();
  });
});
