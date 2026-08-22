// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildHistoricalImportTemplate } from "@mezan/ui";
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

  it("imports a historical invoice: parses the uploaded template, previews it (dry-run), then archives it", async () => {
    render(<PurchaseInvoicesScreen />);
    fireEvent.click(screen.getByRole("button", { name: "استيراد فواتير سابقة" }));
    expect(screen.getByRole("dialog", { name: "استيراد فواتير سابقة" })).toBeInTheDocument();

    const template = await buildHistoricalImportTemplate();
    const file = new File([template.data], template.filename, { type: template.mimeType });
    const input = screen.getByLabelText("اختيار ملف");
    fireEvent.change(input, { target: { files: [file] } });

    // Dry-run preview: the template's one example row (qty 10 × 85.00 = 850.00, amountPaid 500.00) groups
    // into one document with an unsettled remaining balance (350.00).
    await waitFor(() => expect(screen.getByText("INV-1001")).toBeInTheDocument());
    expect(screen.getByText("بها رصيد متبقٍ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استيراد 1 مستند" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "استيراد 1 مستند" }));
    await waitFor(() => expect(screen.getByText(/تم استيراد 1 مستند بنجاح/)).toBeInTheDocument());
  });

  it("reports a duplicate documentNumber on re-import without archiving it twice", async () => {
    render(<PurchaseInvoicesScreen />);
    fireEvent.click(screen.getByRole("button", { name: "استيراد فواتير سابقة" }));

    const template = await buildHistoricalImportTemplate();
    const upload = () => {
      const file = new File([template.data], template.filename, { type: template.mimeType });
      fireEvent.change(screen.getByLabelText("اختيار ملف"), { target: { files: [file] } });
    };

    upload();
    await waitFor(() => expect(screen.getByText("INV-1001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "استيراد 1 مستند" }));
    await waitFor(() => expect(screen.getByText(/تم استيراد 1 مستند بنجاح/)).toBeInTheDocument());

    upload();
    await waitFor(() => expect(screen.getByText("INV-1001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "استيراد 1 مستند" }));
    await waitFor(() => expect(screen.getByText(/تم استيراد 0 مستند بنجاح/)).toBeInTheDocument());
    expect(screen.getByText(/already imported/)).toBeInTheDocument();
  });
});
