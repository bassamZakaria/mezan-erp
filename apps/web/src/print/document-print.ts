import { amountInWords } from "@mezan/domain";
import type { PrintDocumentLine, PrintDocumentModel, PrintPartyInfo } from "@mezan/ui";
import type { TenantSettingsDTO } from "@mezan/contracts";
import { majorOf, scaledOf, toMajorNumber } from "../lib/money";

/**
 * Every printable GOODS document that is not the sales invoice — the quote,
 * the purchase order, the purchase invoice, both returns and the goods
 * receipt — mapped into the print engine's one model (P-6).
 *
 * WHY THIS EXISTS. Only the sales invoice had a compliant template. The rest
 * either called `window.print()` over whatever preview happened to be on
 * screen or offered no print at all, so a supplier's copy of a purchase order
 * carried no tax registration, no VAT breakdown and no total in words —
 * exactly the fields an Egyptian document is judged on.
 *
 * Figures come off each document's own exact decimal strings and are
 * converted once, here, at the display boundary. Tax is grouped by the RATE
 * the line was charged at, never divided out of a total (D28): a 14% line and
 * a zero-rated line print as two rows.
 */

export interface DocumentPrintLineInput {
  readonly code?: string;
  readonly description: string;
  readonly unit?: string;
  /** Exact decimal strings, scale 1e-6, as the API sends them. */
  readonly qty: string;
  readonly unitPrice: string;
  /** Line discount as an exact decimal string; absent means none. */
  readonly discount?: string;
  /** A percentage discount instead — the shape a quote line stores. */
  readonly discountPercent?: number | null;
  readonly taxRatePercent?: number | null;
  /**
   * The tax the document itself recorded for this line, where it stores one
   * (both returns do). Given, it is used verbatim rather than recomputed —
   * a return credits the VAT the source invoice actually charged.
   */
  readonly taxAmount?: string;
}

export interface DocumentPrintInput {
  readonly documentType: string;
  readonly documentTypeLabel: string;
  readonly number: string;
  readonly date: string;
  readonly dueDate?: string;
  readonly statusLabel?: string;
  readonly settings: TenantSettingsDTO | null;
  readonly branchName?: string;
  readonly warehouseName?: string;
  readonly party?: PrintPartyInfo;
  readonly paymentTerms?: string;
  readonly notes?: string | null;
  /** Present only once the authority has ACCEPTED the document — never invented. */
  readonly etaUuid?: string | null;
  readonly currencyLabel: string;
  readonly vatLabel: string;
  readonly lines: readonly DocumentPrintLineInput[];
  /** A discount applied to the document as a whole, exact decimal string. */
  readonly documentDiscount?: string;
}

function lineGrossScaled(line: DocumentPrintLineInput): bigint {
  // qty and unitPrice are both scale 1e-6, so their product is 1e-12.
  return (scaledOf(line.qty) * scaledOf(line.unitPrice)) / 1_000_000n;
}

function lineDiscountScaled(line: DocumentPrintLineInput): bigint {
  if (line.discount !== undefined) return scaledOf(line.discount);
  const percent = BigInt(Math.round((line.discountPercent ?? 0) * 1_000_000));
  return (lineGrossScaled(line) * percent) / 100_000_000n;
}

function lineNetScaled(line: DocumentPrintLineInput): bigint {
  return lineGrossScaled(line) - lineDiscountScaled(line);
}

function lineTaxScaled(line: DocumentPrintLineInput): bigint {
  if (line.taxAmount !== undefined) return scaledOf(line.taxAmount);
  const rate = BigInt(Math.round((line.taxRatePercent ?? 0) * 1_000_000));
  return (lineNetScaled(line) * rate) / 100_000_000n;
}

export function companyOf(settings: TenantSettingsDTO | null) {
  return {
    name: settings?.companyName ?? "",
    address: settings?.address || undefined,
    phone: settings?.phone || undefined,
    email: settings?.email || undefined,
    taxNumber: settings?.taxRegistrationNumber || undefined,
    commercialRegister: settings?.commercialRegistrationNumber || undefined,
  };
}

export function documentPrintModel(input: DocumentPrintInput): PrintDocumentModel {
  const lines: PrintDocumentLine[] = input.lines.map((line) => {
    const net = lineNetScaled(line);
    const tax = lineTaxScaled(line);
    return {
      code: line.code,
      description: line.description,
      unit: line.unit && line.unit !== "" ? line.unit : undefined,
      qty: majorOf(line.qty),
      unitPrice: majorOf(line.unitPrice),
      discount: toMajorNumber(lineDiscountScaled(line)),
      taxPercent: line.taxRatePercent ?? undefined,
      taxAmount: toMajorNumber(tax),
      lineTotal: toMajorNumber(net + tax),
    };
  });

  const byRate = new Map<number, bigint>();
  for (const line of input.lines) {
    const tax = lineTaxScaled(line);
    if (tax === 0n) continue;
    const rate = line.taxRatePercent ?? 0;
    byRate.set(rate, (byRate.get(rate) ?? 0n) + tax);
  }

  const netTotal = input.lines.reduce<bigint>((total, line) => total + lineNetScaled(line), 0n);
  const documentDiscount = scaledOf(input.documentDiscount);
  const taxTotal = input.lines.reduce<bigint>((total, line) => total + lineTaxScaled(line), 0n);
  const lineDiscountTotal = input.lines.reduce<bigint>((total, line) => total + lineDiscountScaled(line), 0n);
  const grandTotalScaled = netTotal - documentDiscount + taxTotal;
  const grandTotal = toMajorNumber(grandTotalScaled);

  return {
    documentType: input.documentType,
    documentTypeLabel: input.documentTypeLabel,
    number: input.number,
    date: input.date,
    dueDate: input.dueDate,
    statusLabel: input.statusLabel,
    company: companyOf(input.settings),
    branchName: input.branchName,
    warehouseName: input.warehouseName,
    party: input.party,
    paymentTerms: input.paymentTerms,
    notes: input.notes ?? undefined,
    etaUuid: input.etaUuid ?? undefined,
    lines,
    totals: {
      subtotal: toMajorNumber(netTotal),
      totalDiscount: toMajorNumber(lineDiscountTotal + documentDiscount),
      taxBreakdown: [...byRate.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([rate, tax]) => ({ label: input.vatLabel, rate, amount: toMajorNumber(tax) })),
      grandTotal,
      currencyLabel: input.currencyLabel,
      // A negative total is a different document type; `amountInWords`
      // refuses one rather than spelling out nonsense.
      amountInWords: grandTotal >= 0 ? amountInWords(grandTotal) : undefined,
    },
  };
}
