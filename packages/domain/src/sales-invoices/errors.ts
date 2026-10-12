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

export class DuplicateSalesInvoiceError extends Error {
  readonly code = "DUPLICATE_SALES_INVOICE";
  readonly messageEn: string;
  constructor(readonly invoiceId: string) {
    super(`فاتورة المبيعات "${invoiceId}" موجودة بالفعل.`);
    this.messageEn = `Sales invoice "${invoiceId}" already exists.`;
    this.name = "DuplicateSalesInvoiceError";
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

export class SalesInvoiceNotDraftError extends Error {
  readonly code = "SALES_INVOICE_NOT_DRAFT";
  constructor(
    readonly invoiceId: string,
    readonly status: SalesInvoiceStatus,
  ) {
    super(`لا يُعدَّل بند فاتورة في حالة "${SALES_INVOICE_STATUS_LABELS_AR[status]}" — التعديل للمسودة وحدها؛ الفاتورة المرحّلة تُصحَّح بمرتجع.`);
    this.name = "SalesInvoiceNotDraftError";
  }
}

export class SalesInvoiceLineNotFoundError extends Error {
  readonly code = "SALES_INVOICE_LINE_NOT_FOUND";
  constructor(
    readonly invoiceId: string,
    readonly lineId: string,
  ) {
    super(`البند ${lineId} غير موجود على الفاتورة ${invoiceId}.`);
    this.name = "SalesInvoiceLineNotFoundError";
  }
}

/**
 * An approval was given for one set of figures and the invoice would post
 * another: the VAT setting moved while it waited. It is handed back as a draft
 * carrying the recalculated figures, and posts only on a fresh approval.
 */
export class ApprovedSalesInvoiceReratedError extends Error {
  readonly code = "APPROVED_DOCUMENT_RERATED";
  readonly messageEn: string;
  constructor(
    readonly invoiceId: string,
    readonly approvedTotal: string,
    readonly recalculatedTotal: string,
  ) {
    super(
      `تغيّر إعداد ضريبة القيمة المضافة بعد إرسال الفاتورة للموافقة: الإجمالي الموافَق عليه ${approvedTotal} وأصبح بعد إعادة الاحتساب ${recalculatedTotal}. لم تُرحَّل الفاتورة، وأُعيدت مسودةً بالأرقام الجديدة — أرسلها للموافقة من جديد.`,
    );
    this.messageEn = `The VAT setting changed after this invoice was sent for approval: the approved total was ${approvedTotal} and it is now ${recalculatedTotal}. Nothing was posted; the invoice is a draft again with the new figures — send it for approval again.`;
    this.name = "ApprovedSalesInvoiceReratedError";
  }
}
