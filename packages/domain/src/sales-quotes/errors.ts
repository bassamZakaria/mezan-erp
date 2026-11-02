import { SALES_QUOTE_STATUS_LABELS_AR, SALES_QUOTE_STATUS_LABELS_EN } from "./sales-quote.js";
/** Sales-quote errors. Stable `code`s so the api/UI can branch on them. */

import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import type { SalesQuoteStatus } from "./sales-quote.js";

export class InvalidSalesQuoteError extends Error {
  readonly code = "INVALID_SALES_QUOTE";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`عرض السعر غير صالح: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid sales quote: ${split.en}`;
    this.name = "InvalidSalesQuoteError";
  }
}

export class SalesQuoteNotFoundError extends Error {
  readonly code = "SALES_QUOTE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly quoteId: string) {
    super(`عرض السعر "${quoteId}" غير موجود.`);
    this.messageEn = `Sales quote "${quoteId}" was not found.`;
    this.name = "SalesQuoteNotFoundError";
  }
}

export class InvalidSalesQuoteTransitionError extends Error {
  readonly code = "INVALID_SALES_QUOTE_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly quoteId: string,
    readonly from: SalesQuoteStatus,
    readonly to: SalesQuoteStatus,
  ) {
    super(`لا يمكن نقل عرض السعر ${quoteId} من "${SALES_QUOTE_STATUS_LABELS_AR[from]}" إلى "${SALES_QUOTE_STATUS_LABELS_AR[to]}".`);
    this.messageEn = `Quote ${quoteId} cannot move from "${SALES_QUOTE_STATUS_LABELS_EN[from]}" to "${SALES_QUOTE_STATUS_LABELS_EN[to]}".`;
    this.name = "InvalidSalesQuoteTransitionError";
  }
}
