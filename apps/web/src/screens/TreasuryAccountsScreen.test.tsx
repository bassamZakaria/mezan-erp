// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TreasuryAccountsScreen } from "./TreasuryAccountsScreen";

describe("TreasuryAccountsScreen", () => {
  it("lists the sample treasury accounts (2 cash + 1 bank)", () => {
    render(<TreasuryAccountsScreen />);
    expect(screen.getByRole("heading", { name: "حسابات الخزينة" })).toBeInTheDocument();
    expect(screen.getByText("صندوق نقدي")).toBeInTheDocument();
    expect(screen.getByText("صندوق نقدي الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("البنك الأهلي المصري — جاري")).toBeInTheDocument();
  });

  it("filters the list by type via the chip row", () => {
    render(<TreasuryAccountsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "بنكي" }));
    expect(screen.getByText("البنك الأهلي المصري — جاري")).toBeInTheDocument();
    expect(screen.queryByText("صندوق نقدي")).not.toBeInTheDocument();
  });

  it("adds a new treasury account through the side panel", () => {
    render(<TreasuryAccountsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة حساب" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    fireEvent.change(within(dialog).getByLabelText("اسم الحساب *"), { target: { value: "صندوق تجريبي" } });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CASH-099" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.getByText("صندوق تجريبي")).toBeInTheDocument();
  });

  it("rejects a duplicate treasury account code with an inline error", () => {
    render(<TreasuryAccountsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة حساب" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    fireEvent.change(within(dialog).getByLabelText("اسم الحساب *"), { target: { value: "نسخة" } });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CASH-001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.getByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("opens the account statement panel on row click", () => {
    render(<TreasuryAccountsScreen />);
    fireEvent.click(screen.getByText("صندوق نقدي الفرع الرئيسي"));
    expect(screen.getByRole("dialog", { name: /كشف حساب/ })).toBeInTheDocument();
  });

  it("edits an existing treasury account from the detail panel, including toggling it inactive", () => {
    render(<TreasuryAccountsScreen />);
    fireEvent.click(screen.getByText("صندوق نقدي الفرع الرئيسي"));
    fireEvent.click(within(screen.getByRole("dialog", { name: /كشف حساب/ })).getByRole("button", { name: "تعديل" }));

    const editDialog = screen.getByRole("dialog", { name: "تعديل حساب" });
    fireEvent.change(within(editDialog).getByLabelText("اسم الحساب *"), { target: { value: "صندوق الفرع الرئيسي المحدّث" } });
    fireEvent.click(within(editDialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(editDialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(screen.getByText("صندوق الفرع الرئيسي المحدّث")).toBeInTheDocument();
    expect(screen.queryByText("صندوق نقدي الفرع الرئيسي")).not.toBeInTheDocument();
    expect(screen.getAllByText("غير نشط").length).toBeGreaterThan(0);
  });
});
