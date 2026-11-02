import { SALES_INVOICE_STATUS_LABELS_AR, SALES_INVOICE_STATUS_LABELS_EN } from "./sales-invoice.js";
/** Sales-invoice errors. Stable `code`s so the api/UI can branch on them. */

import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import type { SalesInvoiceStatus } from "./sales-invoice.js";

export class InvalidSalesInvoiceError extends Error {
  readonly code = "INVALID_SALES_INVOICE";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`فاتورة المبيعات غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid sales invoice: ${split.en}`;
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
  readonly messageEn: string;
  constructor(
    readonly invoiceId: string,
    readonly from: SalesInvoiceStatus,
    readonly to: SalesInvoiceStatus,
  ) {
    super(`لا يمكن نقل الفاتورة ${invoiceId} من "${SALES_INVOICE_STATUS_LABELS_AR[from]}" إلى "${SALES_INVOICE_STATUS_LABELS_AR[to]}".`);
    this.messageEn = `Invoice ${invoiceId} cannot move from "${SALES_INVOICE_STATUS_LABELS_EN[from]}" to "${SALES_INVOICE_STATUS_LABELS_EN[to]}".`;
    this.name = "InvalidSalesInvoiceTransitionError";
  }
}

/** A payment was recorded that would exceed the invoice's outstanding balance. */
export class InvalidSalesInvoicePaymentError extends Error {
  readonly code = "INVALID_SALES_INVOICE_PAYMENT";
  readonly messageEn: string;
  constructor(message: string, messageEn = "The payment on this invoice is not valid.") {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidSalesInvoicePaymentError";
  }
}

export class SalesInvoiceNotDraftError extends Error {
  readonly code = "SALES_INVOICE_NOT_DRAFT";
  readonly messageEn: string;
  constructor(
    readonly invoiceId: string,
    readonly status: SalesInvoiceStatus,
  ) {
    super(`لا يُعدَّل بند فاتورة في حالة "${SALES_INVOICE_STATUS_LABELS_AR[status]}" — التعديل للمسودة وحدها؛ الفاتورة المرحّلة تُصحَّح بمرتجع.`);
    this.messageEn = `A sales invoice line cannot be edited when the invoice is "${SALES_INVOICE_STATUS_LABELS_EN[status]}" — only drafts can be edited; correct a posted invoice with a return.`;
    this.name = "SalesInvoiceNotDraftError";
  }
}

export class SalesInvoiceLineNotFoundError extends Error {
  readonly code = "SALES_INVOICE_LINE_NOT_FOUND";
  readonly messageEn: string;
  constructor(
    readonly invoiceId: string,
    readonly lineId: string,
  ) {
    super(`البند ${lineId} غير موجود على الفاتورة ${invoiceId}.`);
    this.messageEn = `Line ${lineId} was not found on invoice ${invoiceId}.`;
    this.name = "SalesInvoiceLineNotFoundError";
  }
}

export class SalesTaxRecalculationUnacknowledgedError extends Error {
  readonly code = "TAX_RECALCULATION_NOT_ACKNOWLEDGED";
  readonly messageEn: string;
  constructor(
    readonly invoiceId: string,
    readonly shownTotal: string,
    readonly recalculatedTotal: string,
  ) {
    super(
      `تغيّر إعداد ضريبة القيمة المضافة منذ إنشاء هذه المسودة: الإجمالي المعروض ${shownTotal} وسيُرحَّل ${recalculatedTotal}. راجع الإجمالي الجديد ثم أكّد من جديد.`,
    );
    this.messageEn = `The VAT setting changed since this draft was raised: it shows ${shownTotal} and would post ${recalculatedTotal}. Review the new total, then confirm again.`;
    this.name = "SalesTaxRecalculationUnacknowledgedError";
  }
}

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
