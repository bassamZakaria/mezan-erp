import type { PrintDocumentModel } from "./types";

/**
 * A realistic sample فاتورة مبيعات (sales invoice) — the "wire ONE example"
 * proof that `PrintTemplateConfig` + `PrintView` render a real document
 * (docs/catalog/09 §"قوالب الطباعة" live-preview: "فاتورة مبيعات (INV-000123)").
 *
 * Kept domain-agnostic on purpose (@mezan/ui doesn't depend on
 * @mezan/domain, same rule as PermissionMatrix.tsx) — `amountInWords` is
 * left for the caller to compute with @mezan/domain's `amountInWords` and
 * pass in via `overrides`, which is what apps/web's wiring does.
 */
export function createSampleInvoiceDocument(overrides: Partial<PrintDocumentModel> = {}): PrintDocumentModel {
  return {
    documentType: "SALES_INVOICE",
    documentTypeLabel: "فاتورة مبيعات",
    number: "INV-000123",
    date: "2026-08-10",
    dueDate: "2026-09-09",
    statusLabel: "مؤكدة",
    company: {
      name: "شركة سياج للتجارة والتوزيع",
      address: "القاهرة، مصر — شارع التحرير",
      phone: "0223456789",
      email: "info@cyag-demo.com",
      taxNumber: "300123456700003",
      commercialRegister: "12345",
    },
    branchName: "الفرع الرئيسي",
    warehouseName: "المستودع الرئيسي",
    party: {
      roleLabel: "العميل",
      name: "شركة الأمل للتجارة",
      code: "CUST-0042",
      taxNumber: "300987654300003",
      address: "الجيزة، مصر",
      phone: "0100000000",
    },
    paymentTerms: "30 يوماً من تاريخ الفاتورة",
    notes: "يرجى التأكد من الكمية عند الاستلام.",
    lines: [
      {
        code: "ITM-2201",
        description: "جهاز عرض بيانات (بروجكتور)",
        unit: "قطعة",
        qty: 1,
        unitPrice: 950,
        discount: 0,
        taxPercent: 14,
        taxAmount: 133,
        lineTotal: 1083,
      },
      {
        code: "ITM-3110",
        description: "كابل HDMI — 5 متر",
        unit: "قطعة",
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
      taxBreakdown: [{ label: "ضريبة القيمة المضافة", rate: 14, amount: 142.45 }],
      grandTotal: 1159.95,
      currencyLabel: "ج.م",
    },
    ...overrides,
  };
}
