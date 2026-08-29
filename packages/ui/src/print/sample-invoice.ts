import type { PrintDocumentModel } from "./types";
import { DEFAULT_LOCALE, translate, uiCatalogs, type TranslationParams, type UiTranslationKey } from "../i18n";

type SampleTranslate = (key: UiTranslationKey, params?: TranslationParams) => string;

const defaultT: SampleTranslate = (key, params) => translate(uiCatalogs, DEFAULT_LOCALE, key, params);

/**
 * A realistic sample فاتورة مبيعات (sales invoice) — the "wire ONE example"
 * proof that `PrintTemplateConfig` + `PrintView` render a real document
 * (docs/archive/catalog/09 §"قوالب الطباعة" live-preview: "فاتورة مبيعات (INV-000123)").
 *
 * Kept domain-agnostic on purpose (@mezan/ui doesn't depend on
 * @mezan/domain, same rule as PermissionMatrix.tsx) — `amountInWords` is
 * left for the caller to compute with @mezan/domain's `amountInWords` and
 * pass in via `overrides`, which is what apps/web's wiring does.
 */
export function createSampleInvoiceDocument(overrides: Partial<PrintDocumentModel> = {}, t: SampleTranslate = defaultT): PrintDocumentModel {
  return {
    documentType: "SALES_INVOICE",
    documentTypeLabel: t("sample.invoice.typeLabel"),
    number: "INV-000123",
    date: "2026-08-10",
    dueDate: "2026-09-09",
    statusLabel: t("sample.invoice.status"),
    company: {
      name: t("sample.company.name"),
      address: t("sample.company.address"),
      phone: "0223456789",
      email: "info@cyag-demo.com",
      taxNumber: "300123456700003",
      commercialRegister: "12345",
    },
    branchName: t("sample.branchName"),
    warehouseName: t("sample.warehouseName"),
    party: {
      roleLabel: t("sample.party.role"),
      name: t("sample.party.name"),
      code: "CUST-0042",
      taxNumber: "300987654300003",
      address: t("sample.party.address"),
      phone: "0100000000",
    },
    paymentTerms: t("sample.paymentTerms"),
    notes: t("sample.notes"),
    lines: [
      {
        code: "ITM-2201",
        description: t("sample.line1.description"),
        unit: t("sample.unit.piece"),
        qty: 1,
        unitPrice: 950,
        discount: 0,
        taxPercent: 14,
        taxAmount: 133,
        lineTotal: 1083,
      },
      {
        code: "ITM-3110",
        description: t("sample.line2.description"),
        unit: t("sample.unit.piece"),
        qty: 3,
        unitPrice: 25,
        discount: 7.5,
        taxPercent: 14,
        taxAmount: 9.45,
        lineTotal: 76.95,
      },
    ],
    totals: {
      subtotal: 1025,
      totalDiscount: 7.5,
      taxBreakdown: [{ label: t("sample.tax.vat"), rate: 14, amount: 142.45 }],
      grandTotal: 1159.95,
      currencyLabel: t("ui.currency"),
    },
    ...overrides,
  };
}
