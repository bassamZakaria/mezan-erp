import { amountInWords } from "@mezan/domain";
import type { PrintDocumentLine, PrintDocumentModel } from "@mezan/ui";
import type { TenantSettingsDTO } from "@mezan/contracts";
import type { SalesInvoiceDTO, SalesInvoiceLineRowDTO } from "../data/hooks";
import { majorOf, scaledOf, toMajorNumber } from "../lib/money";

/**
 * A sales invoice, as the print engine's generic document.
 *
 * WHY THIS EXISTS. The Print button called `window.print()` on a preview
 * panel that showed customer, date, status and total — no seller tax number,
 * no VAT breakdown, no ETA identifier. `PrintView`, which carries all of
 * them and is driven by the nine-tab template designer, was imported by no
 * sales or purchase screen. The one document Egyptian law is specific about
 * was the one that never rendered through the compliant path.
 *
 * The figures come off the invoice's own exact decimal strings and are
 * converted once, here, at the display boundary — never re-derived. In
 * particular the TAX BREAKDOWN is grouped by the rate each line was charged
 * at, from `taxRatePercent` on the line itself, rather than divided out of a
 * total: a printed tax invoice has to state the rate it was actually charged
 * at, and dividing tax by base is what the VAT return had to do for want of
 * that field (D28).
 */

export interface SalesInvoicePrintContext {
  readonly invoice: SalesInvoiceDTO;
  readonly settings: TenantSettingsDTO | null;
  readonly branchName?: string;
  readonly warehouseName?: string;
  readonly customerTaxNumber?: string;
  readonly customerAddress?: string;
  readonly customerPhone?: string;
  readonly customerCode?: string;
  /** The authority's identifier, once ETA has accepted this invoice. */
  readonly etaUuid?: string | null;
  readonly currencyLabel: string;
  readonly documentTypeLabel: string;
  readonly statusLabel?: string;
  readonly customerRoleLabel: string;
  readonly vatLabel: string;
}

function lineGrossScaled(line: SalesInvoiceLineRowDTO): bigint {
  // qty and unitPrice are both scale 1e-6, so their product is 1e-12.
  return (scaledOf(line.qty) * scaledOf(line.unitPrice)) / 1_000_000n;
}

function lineDiscountScaled(line: SalesInvoiceLineRowDTO): bigint {
  if (line.discountType === "amount") return scaledOf(line.discountAmount);
  const percent = BigInt(Math.round((line.discountPercent ?? 0) * 1_000_000));
  return (lineGrossScaled(line) * percent) / 100_000_000n;
}

export function salesInvoicePrintModel(ctx: SalesInvoicePrintContext): PrintDocumentModel {
  const { invoice, settings } = ctx;

  const lines: PrintDocumentLine[] = invoice.lines.map((line: SalesInvoiceLineRowDTO) => {
    const net = lineGrossScaled(line) - lineDiscountScaled(line);
    const rate = BigInt(Math.round((line.taxRatePercent ?? 0) * 1_000_000));
    const tax = (net * rate) / 100_000_000n;
    return {
      code: line.itemId,
      description: line.itemNameAr,
      unit: line.unitCode && line.unitCode !== "" ? line.unitCode : undefined,
      qty: majorOf(line.qty),
      unitPrice: majorOf(line.unitPrice),
      discount: toMajorNumber(lineDiscountScaled(line)),
      taxPercent: line.taxRatePercent,
      taxAmount: toMajorNumber(tax),
      lineTotal: toMajorNumber(net + tax),
    };
  });

  // Grouped by the rate the line carries, so a 14% line and a 0% line print
  // as two rows rather than one blended figure.
  const byRate = new Map<number, bigint>();
  for (const line of invoice.lines) {
    const net = lineGrossScaled(line) - lineDiscountScaled(line);
    const rate = line.taxRatePercent ?? 0;
    const scaledRate = BigInt(Math.round(rate * 1_000_000));
    const tax = (net * scaledRate) / 100_000_000n;
    if (tax === 0n) continue;
    byRate.set(rate, (byRate.get(rate) ?? 0n) + tax);
  }

  const grandTotal = majorOf(invoice.totals.grandTotal);

  return {
    documentType: "SALES_INVOICE",
    documentTypeLabel: ctx.documentTypeLabel,
    number: invoice.docNo ?? invoice.id,
    date: invoice.date,
    dueDate: invoice.dueDate,
    statusLabel: ctx.statusLabel,
    company: {
      name: settings?.companyName ?? "",
      address: settings?.address || undefined,
      phone: settings?.phone || undefined,
      email: settings?.email || undefined,
      taxNumber: settings?.taxRegistrationNumber || undefined,
      commercialRegister: settings?.commercialRegistrationNumber || undefined,
    },
    branchName: ctx.branchName,
    warehouseName: ctx.warehouseName,
    party: {
      roleLabel: ctx.customerRoleLabel,
      name: invoice.customerNameAr,
      code: ctx.customerCode,
      taxNumber: ctx.customerTaxNumber,
      address: ctx.customerAddress,
      phone: ctx.customerPhone,
    },
    notes: invoice.notes ?? undefined,
    etaUuid: ctx.etaUuid ?? undefined,
    lines,
    totals: {
      subtotal: majorOf(invoice.totals.subtotal),
      totalDiscount:
        majorOf(invoice.totals.lineDiscountTotal) +
        majorOf(invoice.totals.invoiceDiscountTotal) +
        majorOf(invoice.totals.promotionDiscountTotal),
      taxBreakdown: [...byRate.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([rate, tax]) => ({ label: ctx.vatLabel, rate, amount: toMajorNumber(tax) })),
      grandTotal,
      currencyLabel: ctx.currencyLabel,
      // A negative total would be a credit note, which is a different document
      // type; `amountInWords` refuses one rather than printing nonsense.
      amountInWords: grandTotal >= 0 ? amountInWords(grandTotal) : undefined,
    },
  };
}
