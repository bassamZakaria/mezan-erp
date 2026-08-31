// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintView } from "./PrintView";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, type PrintTemplateConfig } from "./types";
import { createSampleInvoiceDocument } from "./sample-invoice";

const baseDoc = () => createSampleInvoiceDocument();

describe("PrintView — currency and page size", () => {
  it("falls back to the ui.currency translation when the document has no currencyLabel", () => {
    const doc = { ...baseDoc(), totals: { ...baseDoc().totals, currencyLabel: undefined } };
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.getAllByText("ج.م").length).toBeGreaterThan(0);
  });

  it("sizes the printed page for A5 instead of the default A4", () => {
    const config: PrintTemplateConfig = { ...DEFAULT_PRINT_TEMPLATE_CONFIG, pageSize: "A5" };
    const { container } = render(<PrintView config={config} document={baseDoc()} />);
    const page = container.querySelector('[style*="width"]') as HTMLElement;
    expect(page.style.width).toBe("148mm");
  });
});

describe("PrintView — identity header layout", () => {
  it("reverses the header row and puts the logo on the start side when logoPosition is start", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, logoPosition: "start", logoUrl: "logo.png" },
    };
    const { container } = render(<PrintView config={config} document={baseDoc()} />);
    const header = container.querySelector("img")!.closest("header");
    expect(header).toHaveClass("flex-row-reverse");
  });

  it("centers the company name block when logoPosition is center", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, logoPosition: "center" },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    const companyName = screen.getByText(baseDoc().company.name);
    expect(companyName.parentElement).toHaveClass("items-center");
  });

  it("shows the subtitle only when identity.subtitle is set", () => {
    const { rerender } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={baseDoc()} />);
    expect(screen.queryByText("خدمات محاسبية ومالية متكاملة")).not.toBeInTheDocument();

    const withSubtitle: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, subtitle: "خدمات محاسبية ومالية متكاملة" },
    };
    rerender(<PrintView config={withSubtitle} document={baseDoc()} />);
    expect(screen.getByText("خدمات محاسبية ومالية متكاملة")).toBeInTheDocument();
  });

  it("renders no logo image when identity.logoUrl is not set", () => {
    const { container } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={baseDoc()} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it.each([
    ["small", "h-[36px]"],
    ["medium", "h-[52px]"],
    ["large", "h-[72px]"],
  ] as const)("sizes the logo image %s as %s", (logoSize, expectedClass) => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, logoUrl: "logo.png", logoSize },
    };
    const { container } = render(<PrintView config={config} document={baseDoc()} />);
    expect(container.querySelector("img")).toHaveClass(expectedClass);
  });
});

describe("PrintView — header contact fields", () => {
  it("hides address, phone, email, tax number and commercial register when their toggles are off", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      header: {
        showAddress: false,
        showPhone: false,
        showEmail: false,
        showTaxNumber: false,
        showCommercialRegister: false,
      },
      content: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.content, showPartyTaxNumber: false },
    };
    const doc = baseDoc();
    render(<PrintView config={config} document={doc} />);
    expect(screen.queryByText(doc.company.address!)).not.toBeInTheDocument();
    expect(screen.queryByText("هاتف: 0223456789")).not.toBeInTheDocument();
    expect(screen.queryByText(doc.company.email!)).not.toBeInTheDocument();
    expect(screen.queryByText("الرقم الضريبي:")).not.toBeInTheDocument();
    expect(screen.queryByText("السجل التجاري:")).not.toBeInTheDocument();
  });

  it("shows the commercial register once its toggle is on and the document carries one", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      header: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.header, showCommercialRegister: true },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.getByText("السجل التجاري:")).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument();
  });

  it("omits address, phone, email, tax number and commercial register when the toggle is on but the company has none", () => {
    const doc = {
      ...baseDoc(),
      company: { name: "شركة بلا بيانات اتصال" },
      party: undefined,
    };
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      header: {
        showAddress: true,
        showPhone: true,
        showEmail: true,
        showTaxNumber: true,
        showCommercialRegister: true,
      },
    };
    render(<PrintView config={config} document={doc} />);
    expect(screen.queryByText("الرقم الضريبي:")).not.toBeInTheDocument();
    expect(screen.queryByText("السجل التجاري:")).not.toBeInTheDocument();
  });
});

describe("PrintView — document metadata", () => {
  it("hides the due-date line when the document has no dueDate", () => {
    const doc = { ...baseDoc(), dueDate: undefined };
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.queryByText("تاريخ الاستحقاق:")).not.toBeInTheDocument();
  });

  it("hides the branch and warehouse lines when their toggles are off and shows them when on", () => {
    const doc = baseDoc();
    const { rerender } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.queryByText(`المستودع: ${doc.warehouseName}`)).not.toBeInTheDocument();

    const bothOn: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      content: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.content, showBranchName: false, showWarehouseName: true },
    };
    rerender(<PrintView config={bothOn} document={doc} />);
    expect(screen.queryByText(`الفرع: ${doc.branchName}`)).not.toBeInTheDocument();
    expect(screen.getByText(`المستودع: ${doc.warehouseName}`)).toBeInTheDocument();
  });

  it("does not show a branch or warehouse line when those toggles are on but the document has no names", () => {
    const doc = { ...baseDoc(), branchName: undefined, warehouseName: undefined };
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      content: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.content, showWarehouseName: true },
    };
    render(<PrintView config={config} document={doc} />);
    expect(screen.queryByText(/الفرع:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/المستودع:/)).not.toBeInTheDocument();
  });

  it("hides the status badge when the document has no statusLabel", () => {
    const doc = { ...baseDoc(), statusLabel: undefined };
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.queryByText("مرحّلة")).not.toBeInTheDocument();
  });
});

describe("PrintView — party block", () => {
  it("renders no party block at all when the document has no party (e.g. an internal transfer)", () => {
    const doc = { ...baseDoc(), party: undefined };
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.queryByText("الكود:")).not.toBeInTheDocument();
  });

  it("omits the party code, tax number, address and phone when the party lacks them", () => {
    const doc = {
      ...baseDoc(),
      party: { roleLabel: "العميل", name: "عميل نقدي" },
      company: { ...baseDoc().company, taxNumber: undefined },
    };
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      content: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.content, showPartyTaxNumber: true },
    };
    render(<PrintView config={config} document={doc} />);
    expect(screen.getByText("عميل نقدي")).toBeInTheDocument();
    expect(screen.queryByText("الكود:")).not.toBeInTheDocument();
    expect(screen.queryByText("الرقم الضريبي:")).not.toBeInTheDocument();
  });

  it("hides the party tax number when its content toggle is off even though the party has one", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      header: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.header, showTaxNumber: false },
      content: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.content, showPartyTaxNumber: false },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.queryAllByText("الرقم الضريبي:")).toHaveLength(0);
  });
});

describe("PrintView — payment terms and notes", () => {
  it("hides payment terms when the toggle is off, and when the toggle is on but the document has none", () => {
    const doc = baseDoc();
    const configOff: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      content: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.content, showPaymentTerms: false },
    };
    const { rerender } = render(<PrintView config={configOff} document={doc} />);
    expect(screen.queryByText(/شروط الدفع:/)).not.toBeInTheDocument();

    const noTerms = { ...doc, paymentTerms: undefined };
    rerender(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={noTerms} />);
    expect(screen.queryByText(/شروط الدفع:/)).not.toBeInTheDocument();
  });

  it("hides notes when the toggle is off, and when the toggle is on but the document has none", () => {
    const doc = baseDoc();
    const configOff: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      content: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.content, showNotes: false },
    };
    const { rerender } = render(<PrintView config={configOff} document={doc} />);
    expect(screen.queryByText(/ملاحظات:/)).not.toBeInTheDocument();

    const noNotes = { ...doc, notes: undefined };
    rerender(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={noNotes} />);
    expect(screen.queryByText(/ملاحظات:/)).not.toBeInTheDocument();
  });
});

describe("PrintView — line item columns", () => {
  it("hides the unit and description columns when their toggles are off", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      columns: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.columns, showUnit: false, showDescription: false },
    };
    const doc = baseDoc();
    render(<PrintView config={config} document={doc} />);
    expect(screen.queryByText("الوحدة")).not.toBeInTheDocument();
    expect(screen.queryByText("الصنف")).not.toBeInTheDocument();
    expect(screen.queryByText(doc.lines[0]!.description)).not.toBeInTheDocument();
  });

  it("hides the discount column when its toggle is off", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      columns: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.columns, showLineDiscount: false },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.queryByText("الخصم")).not.toBeInTheDocument();
  });

  it("shows the tax-percent and tax-amount columns once their toggles are on", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      columns: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.columns, showLineTaxPercent: true, showLineTaxAmount: true },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.getByText("الضريبة %")).toBeInTheDocument();
    expect(screen.getByText("مبلغ الضريبة")).toBeInTheDocument();
  });

  it("prints an empty code, unit, discount, tax-percent and tax-amount cell when a line omits those fields", () => {
    const doc = {
      ...baseDoc(),
      lines: [
        {
          description: "بند بلا تفاصيل إضافية",
          qty: 1,
          unitPrice: 10,
          lineTotal: 10,
        },
      ],
    };
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      columns: {
        showItemCode: true,
        showUnit: true,
        showDescription: true,
        showLineDiscount: true,
        showLineTaxPercent: true,
        showLineTaxAmount: true,
      },
    };
    render(<PrintView config={config} document={doc} />);
    expect(screen.getByText("بند بلا تفاصيل إضافية")).toBeInTheDocument();
    const zeroCells = screen.getAllByText("0.00");
    expect(zeroCells.length).toBeGreaterThanOrEqual(2);
  });
});

describe("PrintView — totals block", () => {
  it("hides the subtotal line when its toggle is off", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      totals: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.totals, showSubtotal: false },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.queryByText("المجموع الفرعي")).not.toBeInTheDocument();
  });

  it("hides the total-discount line when its toggle is off, and when the document has none to show", () => {
    const doc = baseDoc();
    const configOff: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      totals: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.totals, showTotalDiscount: false },
    };
    const { rerender } = render(<PrintView config={configOff} document={doc} />);
    expect(screen.queryByText("إجمالي الخصم")).not.toBeInTheDocument();

    const noDiscount = { ...doc, totals: { ...doc.totals, totalDiscount: 0 } };
    rerender(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={noDiscount} />);
    expect(screen.queryByText("إجمالي الخصم")).not.toBeInTheDocument();
  });

  it("hides the tax breakdown when its toggle is off, and renders nothing when the document has none", () => {
    const doc = baseDoc();
    const configOff: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      totals: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.totals, showTaxBreakdown: false },
    };
    const { rerender } = render(<PrintView config={configOff} document={doc} />);
    expect(screen.queryByText(doc.totals.taxBreakdown![0]!.label)).not.toBeInTheDocument();

    const noBreakdown = { ...doc, totals: { ...doc.totals, taxBreakdown: undefined } };
    rerender(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={noBreakdown} />);
    expect(screen.queryByText(doc.totals.taxBreakdown![0]!.label)).not.toBeInTheDocument();
  });

  it("prints a tax-breakdown row without a percentage suffix when the row has no rate", () => {
    const doc = {
      ...baseDoc(),
      totals: {
        ...baseDoc().totals,
        taxBreakdown: [{ label: "ضريبة الدمغة", amount: 5 }],
      },
    };
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.getByText("ضريبة الدمغة")).toBeInTheDocument();
    expect(screen.queryByText(/ضريبة الدمغة \(/)).not.toBeInTheDocument();
  });
});

describe("PrintView — footer and e-invoice", () => {
  it("hides the signature block when showSignatures is off", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      footer: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.footer, showSignatures: false },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.queryByText("أعده")).not.toBeInTheDocument();
  });

  it("hides the signature block when signatureCount is 0 even though showSignatures is on", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      footer: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.footer, signatureCount: 0, signatureLabels: [] },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.queryByText("أعده")).not.toBeInTheDocument();
  });

  it("pads missing signature labels with blank slots when signatureCount exceeds the configured labels", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      footer: { showSignatures: true, signatureCount: 3, signatureLabels: ["أعده"] },
    };
    const { container } = render(<PrintView config={config} document={baseDoc()} />);
    const grid = screen.getByText("أعده").parentElement!;
    expect(grid.children).toHaveLength(3);
    expect(container.textContent).toContain("أعده");
  });

  it("shows the ETA e-invoice identifier only when the document has one", () => {
    const { rerender } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={baseDoc()} />);
    expect(screen.queryByText("رقم الفاتورة الإلكترونية لدى مصلحة الضرائب:")).not.toBeInTheDocument();

    const withEta = { ...baseDoc(), etaUuid: "AB12CD34-EF56-7890-ABCD-1234567890EF" };
    rerender(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={withEta} />);
    expect(screen.getByText("رقم الفاتورة الإلكترونية لدى مصلحة الضرائب:")).toBeInTheDocument();
    expect(screen.getByText("AB12CD34-EF56-7890-ABCD-1234567890EF")).toBeInTheDocument();
  });

  it("shows the custom footer text only when footer.text is set", () => {
    const { rerender } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={baseDoc()} />);
    expect(screen.queryByText("شكراً لتعاملكم معنا")).not.toBeInTheDocument();

    const withFooterText: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      footer: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.footer, text: "شكراً لتعاملكم معنا" },
    };
    rerender(<PrintView config={withFooterText} document={baseDoc()} />);
    expect(screen.getByText("شكراً لتعاملكم معنا")).toBeInTheDocument();
  });
});

describe("PrintView — per-document-type overrides", () => {
  it("applies identity, header, content, columns, totals and watermark overrides scoped to the matching document type", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      perDocumentOverrides: {
        SALES_INVOICE: {
          identity: { subtitle: "نسخة معتمدة" },
          header: { showCommercialRegister: true },
          content: { showWarehouseName: true },
          columns: { showItemCode: true },
          totals: { showSubtotal: false },
          watermark: { text: "أصل" },
        },
      },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.getByText("نسخة معتمدة")).toBeInTheDocument();
    expect(screen.getByText("السجل التجاري:")).toBeInTheDocument();
    expect(screen.getByText(`المستودع: ${baseDoc().warehouseName}`)).toBeInTheDocument();
    expect(screen.getByText("الكود")).toBeInTheDocument();
    expect(screen.queryByText("المجموع الفرعي")).not.toBeInTheDocument();
    expect(screen.getByText("أصل")).toBeInTheDocument();
  });

  it("leaves the config untouched when the document type has no matching override", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      perDocumentOverrides: { PURCHASE_ORDER: { footer: { showSignatures: false } } },
    };
    render(<PrintView config={config} document={baseDoc()} />);
    expect(screen.getByText("أعده")).toBeInTheDocument();
  });

  it("leaves the config untouched when the document has no documentType at all", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      perDocumentOverrides: { SALES_INVOICE: { footer: { showSignatures: false } } },
    };
    const doc = { ...baseDoc(), documentType: "" };
    render(<PrintView config={config} document={doc} />);
    expect(screen.getByText("أعده")).toBeInTheDocument();
  });
});
