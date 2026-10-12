import { SALES_INVOICE_STATUS_LABELS_AR } from "./sales-invoice.js";
/** Sales-invoice errors. Stable `code`s so the api/UI can branch on them. */

import type { SalesInvoiceStatus } from "./sales-invoice.js";

export class InvalidSalesInvoiceError extends Error {
  readonly code = "INVALID_SALES_INVOICE";
  readonly messageEn: string;
  constructor(readonly reasons: readonly string[]) {
    super(`فاتورة المبيعات غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid sales invoice: ${reasons.join("; ")}`;
    this.name = "InvalidSalesInvoiceError";
  }
}

export class SalesInvoiceNotFoundError extends Error {
  readonly code = "SALES_INVOICE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly invoiceId: string) {
    super(`فاتورة المبيعات "${invoiceId}" غير موجودة.`);
    this.messageEn = `Sales invoice "${invoiceId}" was not found.`;
    this.name = "SalesInvoiceNotFoundError";
  }
}

export class InvalidSalesInvoiceTransitionError extends Error {
  readonly code = "INVALID_SALES_INVOICE_TRANSITION";
  constructor(
    readonly invoiceId: string,
    readonly from: SalesInvoiceStatus,
    readonly to: SalesInvoiceStatus,
  ) {
    super(`لا يمكن نقل الفاتورة ${invoiceId} من "${SALES_INVOICE_STATUS_LABELS_AR[from]}" إلى "${SALES_INVOICE_STATUS_LABELS_AR[to]}".`);
    this.name = "InvalidSalesInvoiceTransitionError";
  }
}

/** A payment was recorded that would exceed the invoice's outstanding balance. */
export class InvalidSalesInvoicePaymentError extends Error {
  readonly code = "INVALID_SALES_INVOICE_PAYMENT";
  constructor(message: string) {
    super(message);
    this.name = "InvalidSalesInvoicePaymentError";
  }
}
