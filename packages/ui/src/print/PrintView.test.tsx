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
