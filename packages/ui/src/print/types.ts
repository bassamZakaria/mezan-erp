/**
 * The 9-tab print-template designer, modeled as data (docs/archive/catalog/09
 * §"قوالب الطباعة" — identity/header/content/columns/totals/footer/
 * watermark/POS-receipt/per-document override; docs/archive/plan.md §2.4). One
 * `PrintTemplateConfig` is stored per tenant; `PrintView` (see PrintView.tsx)
 * is the single renderer every document type reuses.
 *
 * `documentType` fields are plain strings rather than an imported domain
 * union so @mezan/ui stays dependency-free of @mezan/domain (see
 * PermissionMatrix.tsx) — callers pass their own sequence/document-type
 * codes, e.g. "SALES_INVOICE" (@mezan/domain's `SequenceCode`).
 */

export type PrintPageSize = "A4" | "A5";
export type LogoPosition = "start" | "end" | "center";
export type LogoSize = "small" | "medium" | "large";

export interface PrintIdentityConfig {
  logoUrl?: string;
  logoPosition: LogoPosition;
  logoSize: LogoSize;
  /** Hex color used for the document title, header border and table borders. */
  primaryColor: string;
  /** Sub-tagline rendered under the company name, e.g. "خدمات محاسبية ومالية متكاملة". */
  subtitle?: string;
}

export interface PrintHeaderConfig {
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showTaxNumber: boolean;
  showCommercialRegister: boolean;
}

export interface PrintContentConfig {
  showBranchName: boolean;
  showWarehouseName: boolean;
  showPartyTaxNumber: boolean;
  showPaymentTerms: boolean;
  showNotes: boolean;
}

export interface PrintColumnsConfig {
  showItemCode: boolean;
  showUnit: boolean;
  showDescription: boolean;
  showLineDiscount: boolean;
  showLineTaxPercent: boolean;
  showLineTaxAmount: boolean;
}

export interface PrintTotalsConfig {
  showSubtotal: boolean;
  showTotalDiscount: boolean;
  showTaxBreakdown: boolean;
  /** كتابة المبلغ بالحروف — spell out the grand total in Arabic words. */
  showAmountInWords: boolean;
}

export interface PrintFooterConfig {
  text?: string;
  showSignatures: boolean;
  signatureCount: number;
  signatureLabels: string[];
}

export interface PrintWatermarkConfig {
  text?: string;
  /** 0-1. Disabled when `text` is empty regardless of opacity. */
  opacity: number;
}

export interface PrintPosReceiptConfig {
  showTitle: boolean;
  showTaxNumber: boolean;
  showCustomerName: boolean;
  thankYouText?: string;
}

/** A sparse, per-tab override layer scoped to one document type — merged over the tenant-wide defaults. */
export interface PrintTemplateOverride {
  identity?: Partial<PrintIdentityConfig>;
  header?: Partial<PrintHeaderConfig>;
  content?: Partial<PrintContentConfig>;
  columns?: Partial<PrintColumnsConfig>;
  totals?: Partial<PrintTotalsConfig>;
  footer?: Partial<PrintFooterConfig>;
  watermark?: Partial<PrintWatermarkConfig>;
}

export interface PrintTemplateConfig {
  /** Bumped whenever the shape of this config changes, so stored tenant configs can be migrated. */
  version: number;
  pageSize: PrintPageSize;
  identity: PrintIdentityConfig;
  header: PrintHeaderConfig;
  content: PrintContentConfig;
  columns: PrintColumnsConfig;
  totals: PrintTotalsConfig;
  footer: PrintFooterConfig;
  watermark: PrintWatermarkConfig;
  posReceipt: PrintPosReceiptConfig;
  /** تخصيص حسب الوثيقة — keyed by document-type code, e.g. "SALES_INVOICE". */
  perDocumentOverrides: Record<string, PrintTemplateOverride>;
}

export const DEFAULT_PRINT_TEMPLATE_CONFIG: PrintTemplateConfig = {
  version: 1,
  pageSize: "A4",
  identity: {
    logoPosition: "end",
    logoSize: "medium",
    primaryColor: "#1f2937",
  },
  header: {
    showAddress: true,
    showPhone: true,
    showEmail: true,
    showTaxNumber: true,
    showCommercialRegister: false,
  },
  content: {
    showBranchName: true,
    showWarehouseName: false,
    showPartyTaxNumber: true,
    showPaymentTerms: true,
    showNotes: true,
  },
  columns: {
    showItemCode: false,
    showUnit: true,
    showDescription: true,
    showLineDiscount: true,
    showLineTaxPercent: false,
    showLineTaxAmount: false,
  },
  totals: {
    showSubtotal: true,
    showTotalDiscount: true,
    showTaxBreakdown: true,
    showAmountInWords: true,
  },
  footer: {
    showSignatures: true,
    signatureCount: 2,
    signatureLabels: ["أعده", "اعتمده"],
  },
  watermark: {
    opacity: 0.08,
  },
  posReceipt: {
    showTitle: true,
    showTaxNumber: true,
    showCustomerName: false,
    thankYouText: "شكراً لزيارتكم",
  },
  perDocumentOverrides: {},
};

/** Merges the tenant-wide config with the per-document-type override (if any), one tab at a time. */
export function resolvePrintTemplateConfig(
  config: PrintTemplateConfig,
  documentType?: string,
): PrintTemplateConfig {
  const override = documentType ? config.perDocumentOverrides[documentType] : undefined;
  if (!override) return config;

  return {
    ...config,
    identity: override.identity ? { ...config.identity, ...override.identity } : config.identity,
    header: override.header ? { ...config.header, ...override.header } : config.header,
    content: override.content ? { ...config.content, ...override.content } : config.content,
    columns: override.columns ? { ...config.columns, ...override.columns } : config.columns,
    totals: override.totals ? { ...config.totals, ...override.totals } : config.totals,
    footer: override.footer ? { ...config.footer, ...override.footer } : config.footer,
    watermark: override.watermark ? { ...config.watermark, ...override.watermark } : config.watermark,
  };
}

/* ------------------------------------------------------------------ */
/* Generic printable document model — one shape every document type   */
/* (invoice, quote, PO, GRN, voucher, ...) maps into.                  */
/* ------------------------------------------------------------------ */

export interface PrintCompanyInfo {
  name: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
  commercialRegister?: string;
}

export interface PrintPartyInfo {
  /** "العميل" / "المورد" / ... */
  roleLabel: string;
  name: string;
  code?: string;
  taxNumber?: string;
  address?: string;
  phone?: string;
}

export interface PrintDocumentLine {
  code?: string;
  description: string;
  unit?: string;
  qty: number;
  unitPrice: number;
  discount?: number;
  taxPercent?: number;
  taxAmount?: number;
  lineTotal: number;
}

export interface PrintTaxBreakdownRow {
  label: string;
  rate?: number;
  amount: number;
}

export interface PrintDocumentTotals {
  subtotal: number;
  totalDiscount?: number;
  taxBreakdown?: PrintTaxBreakdownRow[];
  grandTotal: number;
  /** Currency label appended after figures, e.g. "ج.م". Defaults to "ج.م". */
  currencyLabel?: string;
  /** Pre-rendered Arabic amount-in-words for `grandTotal` — see @mezan/domain's `amountInWords`. */
  amountInWords?: string;
}

/**
 * A ledger-style body — debit/credit/balance columns instead of qty × price.
 *
 * A journal entry, a treasury voucher and a customer statement are printable
 * documents that have no quantities and no unit prices; forcing them through
 * the goods table printed a column of 1s beside a column of totals. When a
 * document carries `ledger`, `PrintView` renders THAT table and its own
 * footer figures instead of the goods table and the invoice totals block.
 */
export interface PrintLedgerColumn {
  key: string;
  label: string;
  align?: "start" | "end";
  /** Rendered through the money formatter rather than as text. */
  money?: boolean;
}

export interface PrintLedgerRow {
  key: string;
  cells: Record<string, string | number | null>;
}

export interface PrintLedgerFooterRow {
  label: string;
  value: number;
  emphasis?: boolean;
}

export interface PrintLedgerBody {
  columns: PrintLedgerColumn[];
  rows: PrintLedgerRow[];
  /** The figures under the table — totals, a closing balance, a net movement. */
  footer: PrintLedgerFooterRow[];
  /** Stated above the table when the document covers a period rather than a day. */
  periodLabel?: string;
}

export interface PrintDocumentModel {
  /** Document-type code, e.g. "SALES_INVOICE" — used to resolve per-document overrides. */
  documentType: string;
  documentTypeLabel: string;
  number: string;
  date: string;
  dueDate?: string;
  statusLabel?: string;
  company: PrintCompanyInfo;
  branchName?: string;
  warehouseName?: string;
  party?: PrintPartyInfo;
  paymentTerms?: string;
  notes?: string;
  /**
   * The authority's own identifier for an accepted e-invoice.
   *
   * It exists in the domain the moment ETA accepts a submission, and it never
   * reached the printed page — so a correctly wired print still omitted the
   * one field that makes the paper copy traceable to the filing. Absent for a
   * document that has not been accepted, which is most of them, and the block
   * is simply not rendered then rather than printing an empty label.
   */
  etaUuid?: string;
  /**
   * What the QR on the paper encodes — for an e-receipt, the authority's own
   * share URL (see @mezan/domain's `etaReceiptQrValue`). A B2C receipt is
   * reported AFTER the sale, so this is the only thing the customer or an
   * inspector can check the receipt against at the counter. Passed in rather
   * than built here: @mezan/ui must not decide what a tax document says.
   */
  etaQrValue?: string;
  /**
   * A compliance state the printed copy must not hide — «وضع الاختبار» while
   * filing against the pre-production environment, or «في انتظار الختم
   * الإلكتروني» for a document that has been queued but not sealed. Printing a
   * document that looks filed when it is not is how this is discovered at an
   * audit instead of at the till.
   */
  complianceNotice?: string;
  lines: PrintDocumentLine[];
  totals: PrintDocumentTotals;
  /** Present on a document with no goods lines — see `PrintLedgerBody`. */
  ledger?: PrintLedgerBody;
}
