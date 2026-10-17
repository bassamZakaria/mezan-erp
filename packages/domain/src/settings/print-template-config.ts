/**
 * Domain-side duplicate of @mezan/ui's `PrintTemplateConfig`
 * (packages/ui/src/print/types.ts) — the single tenant-wide print-template
 * settings object backing the 9-tab print-template designer (identity/
 * header/content/columns/totals/footer/watermark/posReceipt/
 * perDocumentOverrides).
 *
 * @mezan/ui is deliberately dependency-free of @mezan/domain (see that
 * file's doc comment), so this shape is duplicated here rather than
 * imported — TypeScript structural typing keeps the two assignment-
 * compatible even though they are separate declarations, mirroring how
 * Money/decimal-string duplication already works between domain and
 * contracts elsewhere in this repo.
 */

export type PrintPageSize = "A4" | "A5";
export type LogoPosition = "start" | "end" | "center";
export type LogoSize = "small" | "medium" | "large";

export interface PrintIdentityConfig {
  logoUrl?: string;
  logoPosition: LogoPosition;
  logoSize: LogoSize;
  primaryColor: string;
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
  showBatchExpiry?: boolean;
}

export interface PrintTotalsConfig {
  showSubtotal: boolean;
  showTotalDiscount: boolean;
  showTaxBreakdown: boolean;
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
  opacity: number;
}

export interface PrintPosReceiptConfig {
  showTitle: boolean;
  showTaxNumber: boolean;
  showCustomerName: boolean;
  thankYouText?: string;
}

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
    showBatchExpiry: true,
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

/** Port for the single tenant-wide print-template config (one row per tenant). */
export interface PrintTemplateConfigRepository {
  get(): Promise<PrintTemplateConfig | null>;
  save(config: PrintTemplateConfig): Promise<void>;
}
