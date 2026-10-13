import type { SettingsRepository } from "../settings/ports.js";
import { createDefaultSettings, TaxCalculationModeCode, type TenantSettings } from "../settings/settings.js";

export interface SalesInvoiceTaxPolicy {
  readonly enabled: boolean;
  readonly defaultRatePercent: number;
  readonly inclusive: boolean;
}

export enum SalesPricingMode {
  TaxExclusive = "tax_exclusive",
  TaxInclusive = "tax_inclusive",
}

export type SalesTaxPolicySource = () => Promise<SalesInvoiceTaxPolicy> | SalesInvoiceTaxPolicy;

// INVARIANT: the ONE reading of the VAT switch. Every path that raises or
// confirms a sale — an invoice, a quote, a quote's conversion, a certificate
// invoice, a held document's approval — takes its policy from here, so none
// can price a sale as if the switch were on.
export function salesTaxPolicyFromSettings(settings: Pick<TenantSettings, "taxEnabled" | "defaultTaxRate" | "taxCalculation">): SalesInvoiceTaxPolicy {
  return {
    enabled: settings.taxEnabled,
    defaultRatePercent: settings.defaultTaxRate,
    inclusive: settings.taxCalculation === TaxCalculationModeCode.Inclusive,
  };
}

export function salesTaxPolicySource(settings: Pick<SettingsRepository, "get">): SalesTaxPolicySource {
  return async () => salesTaxPolicyFromSettings((await settings.get()) ?? createDefaultSettings());
}

export const SALES_TAX_RECALCULATED_NOTICE_AR =
  "أُعيد احتساب الضريبة على بنود الفاتورة وفق إعداد ضريبة القيمة المضافة الحالي — راجع الإجمالي قبل تسليمها للعميل.";
