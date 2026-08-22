// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PurchaseOrdersScreen } from "./PurchaseOrdersScreen";
import { GoodsReceiptsScreen } from "./GoodsReceiptsScreen";
import { PurchaseInvoicesScreen } from "./PurchaseInvoicesScreen";

describe("PurchaseOrdersScreen", () => {
  it("lists the sample purchase orders", () => {
    render(<PurchaseOrdersScreen />);
    expect(screen.getByRole("heading", { name: "أوامر الشراء" })).toBeInTheDocument();
    expect(screen.getByText("PO-000003")).toBeInTheDocument();
  });

  it("opens a PO detail with the effects panel and a lines tab", () => {
    render(<PurchaseOrdersScreen />);
    fireEvent.click(screen.getByText("PO-000003"));
    expect(screen.getByRole("heading", { name: /أمر شراء PO-000003/ })).toBeInTheDocument();
    expect(screen.getByText(/لا يؤثر أمر الشراء على المخزون/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /البنود/ })).toBeInTheDocument();
  });

  it("confirms a draft PO (draft → sent)", () => {
    render(<PurchaseOrdersScreen />);
    fireEvent.click(screen.getByText("PO-000001")); // the draft one
    fireEvent.click(screen.getByRole("button", { name: "تأكيد وإرسال" }));
    expect(screen.getByText("مرسل")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تأكيد وإرسال" })).not.toBeInTheDocument();
  });

  it("opens the new-PO side panel", () => {
    render(<PurchaseOrdersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "أمر شراء جديد" }));
    expect(screen.getByRole("dialog", { name: "أمر شراء جديد" })).toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen", () => {
  it("lists the sample receipts and opens a confirmed receipt with stock effects", () => {
    render(<GoodsReceiptsScreen />);
    expect(screen.getByRole("heading", { name: "إيصالات الاستلام" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("GR-000001"));
    expect(screen.getByRole("heading", { name: /إيصال استلام GR-000001/ })).toBeInTheDocument();
    expect(screen.getByText(/تمت زيادة كمية المخزون/)).toBeInTheDocument();
  });

  it("opens the new-receipt panel with the create-from-PO note", () => {
    render(<GoodsReceiptsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إيصال استلام جديد" }));
    const dialog = screen.getByRole("dialog", { name: "إيصال استلام جديد" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/الاستلام يبدأ دائماً من أمر شراء/)).toBeInTheDocument();
  });
});

describe("PurchaseInvoicesScreen", () => {
  it("lists the sample invoices", () => {
    render(<PurchaseInvoicesScreen />);
    expect(screen.getByRole("heading", { name: "فواتير المشتريات" })).toBeInTheDocument();
    expect(screen.getByText("PI-000001")).toBeInTheDocument();
    expect(screen.getByText("PI-000002")).toBeInTheDocument();
  });

  it("opens an invoice detail with the 3-point effects panel", () => {
    render(<PurchaseInvoicesScreen />);
    fireEvent.click(screen.getByText("PI-000001"));
    expect(screen.getByText(/يزيد المستحق للمورد/)).toBeInTheDocument();
    expect(screen.getByText(/لا يوجد دفع تلقائي/)).toBeInTheDocument();
  });

  it("toggles the creation method between manual and from-receipt", () => {
    render(<PurchaseInvoicesScreen />);
    fireEvent.click(screen.getByRole("button", { name: "فاتورة مشتريات جديدة" }));
    expect(screen.getByRole("dialog", { name: "فاتورة مشتريات جديدة" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("من إيصال استلام"));
    expect(screen.getByText("إيصال الاستلام *")).toBeInTheDocument();
  });
});
