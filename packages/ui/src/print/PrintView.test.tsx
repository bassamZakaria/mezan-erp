// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintView } from "./PrintView";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, type PrintTemplateConfig } from "./types";
import { createSampleInvoiceDocument } from "./sample-invoice";

describe("PrintView", () => {
  it("renders the sample invoice: company, document metadata, party, lines and totals", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} />);

    expect(screen.getByText("شركة سياج للتجارة والتوزيع")).toBeInTheDocument();
    expect(screen.getByText("فاتورة مبيعات")).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.getByText("جهاز عرض بيانات (بروجكتور)")).toBeInTheDocument();
    expect(screen.getByText("كابل HDMI — 5 متر")).toBeInTheDocument();
    expect(screen.getByText("1,159.95")).toBeInTheDocument();
  });

  it("shows the amount-in-words line only when totals.showAmountInWords is on and the string is provided", () => {
    const words = "ألف ومائة وتسعة وخمسون جنيه مصري وخمسة وتسعون قرش فقط لا غير";
    const doc = createSampleInvoiceDocument({ totals: { ...createSampleInvoiceDocument().totals, amountInWords: words } });

    const { rerender } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.getByText(words)).toBeInTheDocument();

    const withoutWords: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      totals: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.totals, showAmountInWords: false },
    };
    rerender(<PrintView config={withoutWords} document={doc} />);
    expect(screen.queryByText(words)).not.toBeInTheDocument();
  });

  it("hides the item-code column when columns.showItemCode is off (the default)", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} />);
    expect(screen.queryByText("الكود")).not.toBeInTheDocument();
    expect(screen.queryByText("ITM-2201")).not.toBeInTheDocument();
  });

  it("shows the item-code column when columns.showItemCode is toggled on", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      columns: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.columns, showItemCode: true },
    };
    render(<PrintView config={config} document={createSampleInvoiceDocument()} />);
    expect(screen.getByText("الكود")).toBeInTheDocument();
    expect(screen.getByText("ITM-2201")).toBeInTheDocument();
  });

  it("renders a watermark only when watermark.text is set", () => {
    const { rerender } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} />);
    expect(screen.queryByText("مسودة")).not.toBeInTheDocument();

    const withWatermark: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      watermark: { text: "مسودة", opacity: 0.1 },
    };
    rerender(<PrintView config={withWatermark} document={createSampleInvoiceDocument()} />);
    expect(screen.getByText("مسودة")).toBeInTheDocument();
  });

  it("renders the configured number of signature slots with their labels", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} />);
    expect(screen.getByText("أعده")).toBeInTheDocument();
    expect(screen.getByText("اعتمده")).toBeInTheDocument();
  });

  it("applies a per-document-type override on top of the base config", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      perDocumentOverrides: {
        SALES_INVOICE: { footer: { showSignatures: false } },
      },
    };
    render(<PrintView config={config} document={createSampleInvoiceDocument()} />);
    expect(screen.queryByText("أعده")).not.toBeInTheDocument();
  });

  it("offers a طباعة button that calls window.print()", () => {
    const printSpy = vi.fn();
    window.print = printSpy;
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} />);
    screen.getByText("طباعة").click();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("does not offer a حفظ PDF button in the browser edition (no window.mezan bridge)", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} />);
    expect(screen.queryByText("حفظ PDF")).not.toBeInTheDocument();
  });

  it("hides the toolbar entirely when showToolbar is false", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} showToolbar={false} />);
    expect(screen.queryByText("طباعة")).not.toBeInTheDocument();
  });

  it("prints the ETA identifier without a QR when only the identifier is known", () => {
    const doc = { ...createSampleInvoiceDocument(), etaUuid: "ETA-UUID-1" };
    const { container } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(screen.getByText("ETA-UUID-1")).toBeInTheDocument();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("prints a QR symbol for an e-receipt, which is the only thing scannable at the counter", () => {
    const doc = {
      ...createSampleInvoiceDocument(),
      etaUuid: "ETA-UUID-1",
      etaQrValue: "https://invoicing.eta.gov.eg/receipts/search/ETA-UUID-1/share/2026-09-01T10%3A00%3A00Z",
    };
    const { container } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    const qr = container.querySelector('svg[role="img"]');
    expect(qr).not.toBeNull();
    expect(qr?.getAttribute("aria-label")).toBe("رقم الفاتورة الإلكترونية لدى مصلحة الضرائب:");
    expect(qr?.querySelector("path")?.getAttribute("d")).toBeTruthy();
  });

  it("prints nothing about ETA when the document has neither identifier nor QR", () => {
    const { container } = render(
      <PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} />,
    );
    expect(screen.queryByText("رقم الفاتورة الإلكترونية لدى مصلحة الضرائب:")).not.toBeInTheDocument();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("prints the compliance notice, so a test-mode or unsealed document says so on paper", () => {
    const doc = { ...createSampleInvoiceDocument(), complianceNotice: "وضع الاختبار — لم تُرسل هذه الوثيقة إلى مصلحة الضرائب" };
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(
      screen.getByText("وضع الاختبار — لم تُرسل هذه الوثيقة إلى مصلحة الضرائب"),
    ).toBeInTheDocument();
  });

  it("turns the page sideways on landscape — the @page rule AND the sheet's own dimensions", () => {
    const { container } = render(
      <PrintView
        config={DEFAULT_PRINT_TEMPLATE_CONFIG}
        document={createSampleInvoiceDocument()}
        orientation="landscape"
        showToolbar={false}
      />,
    );
    expect(container.querySelector("style")?.textContent).toContain("size: A4 landscape");
    const sheet = container.querySelector<HTMLElement>("div[dir=\"rtl\"]");
    expect(sheet?.style.width).toBe("297mm");
    expect(sheet?.style.minHeight).toBe("210mm");
  });

  it("matches the rendered structure snapshot for the sample invoice", () => {
    const { container } = render(
      <PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={createSampleInvoiceDocument()} showToolbar={false} />,
    );
    // The preview is embedded inside a screen that already owns the page
    // heading, so the company name is not an <h1> — two of those on one page
    // is the defect this guards.
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.firstChild).toMatchSnapshot();
  });
});

/** guards P-6 — a journal entry, a voucher and a statement have no goods lines. */
describe("PrintView — the ledger body", () => {
  const ledgerDoc = {
    ...createSampleInvoiceDocument(),
    documentType: "CUSTOMER_STATEMENT",
    documentTypeLabel: "كشف حساب عميل",
    lines: [],
    ledger: {
      periodLabel: "عن الفترة من 2026-03-01 إلى 2026-03-31",
      columns: [
        { key: "date", label: "التاريخ" },
        { key: "reference", label: "المرجع" },
        { key: "description", label: "البيان" },
        { key: "debit", label: "مدين", align: "end" as const, money: true },
        { key: "credit", label: "دائن", align: "end" as const, money: true },
        { key: "balance", label: "الرصيد", align: "end" as const, money: true },
      ],
      rows: [
        { key: "a", cells: { date: "2026-03-01", reference: "INV-1", description: "فاتورة", debit: 300, credit: null, balance: 300 } },
        { key: "b", cells: { date: "2026-03-10", reference: "CV-1", description: "سند قبض", debit: null, credit: 100, balance: 200 } },
      ],
      footer: [
        { label: "مدين", value: 300 },
        { label: "دائن", value: 100 },
        { label: "الرصيد الختامي", value: 200, emphasis: true },
      ],
    },
  };

  it("renders debit/credit/balance instead of the qty × price table", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={ledgerDoc} showToolbar={false} />);
    expect(screen.getAllByText("مدين").length).toBeGreaterThan(0);
    expect(screen.getByText("الرصيد")).toBeInTheDocument();
    expect(screen.getByText("عن الفترة من 2026-03-01 إلى 2026-03-31")).toBeInTheDocument();
    expect(screen.getByText("فاتورة")).toBeInTheDocument();
    // The goods table's own headers are gone — no quantity, no unit price.
    expect(screen.queryByText("الكمية")).not.toBeInTheDocument();
    expect(screen.queryByText("السعر")).not.toBeInTheDocument();
  });

  it("still carries the company's legal header — a statement is a company document too", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={ledgerDoc} showToolbar={false} />);
    expect(screen.getByText("شركة سياج للتجارة والتوزيع")).toBeInTheDocument();
    expect(screen.getByText("كشف حساب عميل")).toBeInTheDocument();
  });
});

/** guards P-6 — the QR square appears only where the authority returned a UUID. */
describe("PrintView — the ETA block", () => {
  it("prints nothing about e-invoicing on a document the authority has not accepted", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={{ ...createSampleInvoiceDocument(), etaUuid: undefined }} showToolbar={false} />);
    expect(screen.queryByText("رمز QR للفاتورة الإلكترونية")).not.toBeInTheDocument();
  });

  it("shows a STATED placeholder beside a real UUID rather than an invented code", () => {
    render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={{ ...createSampleInvoiceDocument(), etaUuid: "ETA-UUID-1" }} showToolbar={false} />);
    expect(screen.getByText("رمز QR للفاتورة الإلكترونية")).toBeInTheDocument();
    expect(screen.getByText("ETA-UUID-1")).toBeInTheDocument();
    // Nothing scannable is drawn: the submission this would encode does not exist (P-1).
    expect(document.querySelector("svg[data-qr]")).toBeNull();
  });
});

describe("PrintView — the tax column names the rate (D79)", () => {
  const withTaxPercent: PrintTemplateConfig = {
    ...DEFAULT_PRINT_TEMPLATE_CONFIG,
    columns: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.columns, showLineTaxPercent: true },
  };
  const sample = createSampleInvoiceDocument();
  const [first, second] = sample.lines;

  it("prints the rate's name beside its percent, so two 0% lines are told apart on paper", () => {
    const doc = createSampleInvoiceDocument({
      lines: [
        { ...first!, taxPercent: 0, taxName: "معفى من الضريبة" },
        { ...second!, taxPercent: 0, taxName: "تصدير — نسبة صفر" },
      ],
    });
    render(<PrintView config={withTaxPercent} document={doc} />);
    expect(screen.getByText("معفى من الضريبة")).toBeInTheDocument();
    expect(screen.getByText("تصدير — نسبة صفر")).toBeInTheDocument();
  });

  it("prints the percent alone for a line with no named rate", () => {
    const doc = createSampleInvoiceDocument({ lines: [{ ...first!, taxPercent: 14, taxName: undefined }] });
    const { container } = render(<PrintView config={withTaxPercent} document={doc} />);
    expect(container.querySelector("[data-print-tax-name]")).toBeNull();
  });
});
