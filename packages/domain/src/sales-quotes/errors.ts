import { SALES_QUOTE_STATUS_LABELS_AR } from "./sales-quote.js";
/** Sales-quote errors. Stable `code`s so the api/UI can branch on them. */

import type { SalesQuoteStatus } from "./sales-quote.js";

export class InvalidSalesQuoteError extends Error {
  readonly code = "INVALID_SALES_QUOTE";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid sales quote: ${reasons.join("; ")}`);
    this.name = "InvalidSalesQuoteError";
  }
}

export class SalesQuoteNotFoundError extends Error {
  readonly code = "SALES_QUOTE_NOT_FOUND";
  constructor(readonly quoteId: string) {
    super(`Sales quote "${quoteId}" was not found.`);
    this.name = "SalesQuoteNotFoundError";
  }
}

export class DuplicateSalesQuoteError extends Error {
  readonly code = "DUPLICATE_SALES_QUOTE";
  constructor(readonly quoteId: string) {
    super(`Sales quote "${quoteId}" already exists.`);
    this.name = "DuplicateSalesQuoteError";
  }
}

export class InvalidSalesQuoteTransitionError extends Error {
  readonly code = "INVALID_SALES_QUOTE_TRANSITION";
  constructor(
    readonly quoteId: string,
    readonly from: SalesQuoteStatus,
    readonly to: SalesQuoteStatus,
  ) {
    super(`لا يمكن نقل عرض السعر ${quoteId} من "${SALES_QUOTE_STATUS_LABELS_AR[from]}" إلى "${SALES_QUOTE_STATUS_LABELS_AR[to]}".`);
    this.name = "InvalidSalesQuoteTransitionError";
  }
}
