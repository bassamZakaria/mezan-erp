/** Sales-invoice errors. Stable `code`s so the api/UI can branch on them. */

import type { SalesInvoiceStatus } from "./sales-invoice.js";

export class InvalidSalesInvoiceError extends Error {
  readonly code = "INVALID_SALES_INVOICE";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid sales invoice: ${reasons.join("; ")}`);
    this.name = "InvalidSalesInvoiceError";
  }
}

export class SalesInvoiceNotFoundError extends Error {
  readonly code = "SALES_INVOICE_NOT_FOUND";
  constructor(readonly invoiceId: string) {
    super(`Sales invoice "${invoiceId}" was not found.`);
    this.name = "SalesInvoiceNotFoundError";
  }
}

export class DuplicateSalesInvoiceError extends Error {
  readonly code = "DUPLICATE_SALES_INVOICE";
  constructor(readonly invoiceId: string) {
    super(`Sales invoice "${invoiceId}" already exists.`);
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
    super(`Sales invoice "${invoiceId}" cannot transition ${from} → ${to}.`);
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
