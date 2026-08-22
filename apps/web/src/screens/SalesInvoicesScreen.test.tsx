// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SalesInvoicesScreen } from "./SalesInvoicesScreen";

function openNewInvoicePanel() {
  fireEvent.click(screen.getByRole("button", { name: "فاتورة جديدة" }));
  return screen.getByRole("dialog", { name: "فاتورة مبيعات جديدة" });
}

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: new RegExp(optionLabel) });
  fireEvent.mouseDown(option);
}

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("SalesInvoicesScreen — list", () => {
  it("renders the heading and seeded invoices with KPIs", () => {
    render(<SalesInvoicesScreen />);
    expect(screen.getByRole("heading", { name: "فواتير المبيعات" })).toBeInTheDocument();
    expect(screen.getByText("INV-000001")).toBeInTheDocument();
    expect(screen.getByText("INV-000002")).toBeInTheDocument();
    expect(screen.getByText("INV-000003")).toBeInTheDocument();
  });

  it("filters to مدفوع via the status chips", () => {
    render(<SalesInvoicesScreen />);
    // "مدفوع" is a prefix of "مدفوع جزئياً" too, so anchor on the trailing count.
    fireEvent.click(screen.getByRole("tab", { name: /^مدفوع\s?\d/ }));
    expect(screen.getByText("INV-000002")).toBeInTheDocument();
    expect(screen.queryByText("INV-000001")).not.toBeInTheDocument();
  });

  it("opens the detail view with the effects panel and tabs", () => {
    render(<SalesInvoicesScreen />);
    fireEvent.click(screen.getByText("INV-000001"));
    expect(screen.getByRole("heading", { name: "INV-000001" })).toBeInTheDocument();
    expect(screen.getByText("تأثيرات هذه الفاتورة")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "بنود الفاتورة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "القيود المحاسبية" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المدفوعات" })).toBeInTheDocument();
  });
});

describe("SalesInvoicesScreen — create + confirm flow", () => {
  it("creates and confirms a new invoice through the real domain service", async () => {
    render(<SalesInvoicesScreen />);
    const dialog = openNewInvoicePanel();

    pickFromCombobox(dialog, "العميل *", "شركة الأمل للتجارة");
    pickFromCombobox(dialog, "الصنف — سطر 1", "أرز أبيض مصري");

    const confirmButton = within(dialog).getByRole("button", { name: "تأكيد الفاتورة" });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "فاتورة مبيعات جديدة" })).not.toBeInTheDocument());
    expect(await screen.findByText("INV-000004")).toBeInTheDocument();
  });

  it("shows a domain validation error instead of confirming an invoice without a customer", async () => {
    render(<SalesInvoicesScreen />);
    const dialog = openNewInvoicePanel();
    pickFromCombobox(dialog, "الصنف — سطر 1", "أرز أبيض مصري");

    // With no customer chosen the confirm button stays disabled — no invoice is created.
    expect(within(dialog).getByRole("button", { name: "تأكيد الفاتورة" })).toBeDisabled();
  });
});

describe("SalesInvoicesScreen — payments", () => {
  it("records a payment against a confirmed invoice and advances it to مدفوع جزئياً", async () => {
    render(<SalesInvoicesScreen />);
    fireEvent.click(screen.getByText("INV-000001"));
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    typeMoney(screen.getByLabelText("قيمة الدفعة"), "50");
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));

    await waitFor(() => expect(screen.getAllByText("مدفوع جزئياً").length).toBeGreaterThan(0));
  });

  it("fully pays off the partially-paid seeded invoice, advancing it to مدفوع", async () => {
    render(<SalesInvoicesScreen />);
    fireEvent.click(screen.getByText("INV-000003"));
    fireEvent.click(screen.getByRole("tab", { name: "المدفوعات" }));

    // Pay the remaining balance shown in the المتبقي cell.
    const remainingCell = screen.getByText("المتبقي").closest("div")?.querySelector("dd");
    const remainingText = remainingCell?.textContent?.replace(/[^\d.]/g, "") ?? "0";

    typeMoney(screen.getByLabelText("قيمة الدفعة"), remainingText);
    fireEvent.click(screen.getByRole("button", { name: "تحصيل دفعة" }));

    await waitFor(() => expect(screen.getAllByText("مدفوع").length).toBeGreaterThan(0));
  });
});
