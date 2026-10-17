import { z } from "zod";

/**
 * Wire contracts for the tenant-wide Print Template Config (docs/archive/catalog/09
 * §"قوالب الطباعة"). Mirrors @mezan/domain's `PrintTemplateConfig`
 * (packages/domain/src/settings/print-template-config.ts), which itself
 * duplicates @mezan/ui's `PrintTemplateConfig` shape (packages/ui/src/print/
 * types.ts) — same independent-re-derivation pattern as historical-import.ts.
 */

export const printPageSizeSchema = z.enum(["A4", "A5"]);
export const LOGO_MAX_CHARS = 250_000;

export const logoPositionSchema = z.enum(["start", "end", "center"]);
export const logoSizeSchema = z.enum(["small", "medium", "large"]);

export const printIdentityConfigSchema = z.object({
  logoUrl: z.string().max(LOGO_MAX_CHARS).optional(),
  logoPosition: logoPositionSchema,
  logoSize: logoSizeSchema,
  primaryColor: z.string().min(1),
  subtitle: z.string().optional(),
});

export const printHeaderConfigSchema = z.object({
  showAddress: z.boolean(),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showTaxNumber: z.boolean(),
  showCommercialRegister: z.boolean(),
});

export const printContentConfigSchema = z.object({
  showBranchName: z.boolean(),
  showWarehouseName: z.boolean(),
  showPartyTaxNumber: z.boolean(),
  showPaymentTerms: z.boolean(),
  showNotes: z.boolean(),
});

export const printColumnsConfigSchema = z.object({
  showItemCode: z.boolean(),
  showUnit: z.boolean(),
  showDescription: z.boolean(),
  showLineDiscount: z.boolean(),
  showLineTaxPercent: z.boolean(),
  showLineTaxAmount: z.boolean(),
  showBatchExpiry: z.boolean().optional(),
});

export const printTotalsConfigSchema = z.object({
  showSubtotal: z.boolean(),
  showTotalDiscount: z.boolean(),
  showTaxBreakdown: z.boolean(),
  showAmountInWords: z.boolean(),
});

export const printFooterConfigSchema = z.object({
  text: z.string().optional(),
  showSignatures: z.boolean(),
  signatureCount: z.number().int().min(0),
  signatureLabels: z.array(z.string()),
});

export const printWatermarkConfigSchema = z.object({
  text: z.string().optional(),
  opacity: z.number().min(0).max(1),
});

export const printPosReceiptConfigSchema = z.object({
  showTitle: z.boolean(),
  showTaxNumber: z.boolean(),
  showCustomerName: z.boolean(),
  thankYouText: z.string().optional(),
});

/** A sparse, per-tab override layer scoped to one document type — every field optional/partial. */
export const printTemplateOverrideSchema = z.object({
  identity: printIdentityConfigSchema.partial().optional(),
  header: printHeaderConfigSchema.partial().optional(),
  content: printContentConfigSchema.partial().optional(),
  columns: printColumnsConfigSchema.partial().optional(),
  totals: printTotalsConfigSchema.partial().optional(),
  footer: printFooterConfigSchema.partial().optional(),
  watermark: printWatermarkConfigSchema.partial().optional(),
});

export const printTemplateConfigSchema = z.object({
  version: z.number().int(),
  pageSize: printPageSizeSchema,
  identity: printIdentityConfigSchema,
  header: printHeaderConfigSchema,
  content: printContentConfigSchema,
  columns: printColumnsConfigSchema,
  totals: printTotalsConfigSchema,
  footer: printFooterConfigSchema,
  watermark: printWatermarkConfigSchema,
  posReceipt: printPosReceiptConfigSchema,
  perDocumentOverrides: z.record(z.string(), printTemplateOverrideSchema),
});

export type PrintPageSizeDTO = z.infer<typeof printPageSizeSchema>;
export type LogoPositionDTO = z.infer<typeof logoPositionSchema>;
export type LogoSizeDTO = z.infer<typeof logoSizeSchema>;
export type PrintIdentityConfigDTO = z.infer<typeof printIdentityConfigSchema>;
export type PrintHeaderConfigDTO = z.infer<typeof printHeaderConfigSchema>;
export type PrintContentConfigDTO = z.infer<typeof printContentConfigSchema>;
export type PrintColumnsConfigDTO = z.infer<typeof printColumnsConfigSchema>;
export type PrintTotalsConfigDTO = z.infer<typeof printTotalsConfigSchema>;
export type PrintFooterConfigDTO = z.infer<typeof printFooterConfigSchema>;
export type PrintWatermarkConfigDTO = z.infer<typeof printWatermarkConfigSchema>;
export type PrintPosReceiptConfigDTO = z.infer<typeof printPosReceiptConfigSchema>;
export type PrintTemplateOverrideDTO = z.infer<typeof printTemplateOverrideSchema>;
export type PrintTemplateConfigDTO = z.infer<typeof printTemplateConfigSchema>;
