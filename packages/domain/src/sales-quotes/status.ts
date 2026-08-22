/**
 * Sales-quote lifecycle transitions (مسودة → مرسل → مقبول/مرفوض → محول, plus
 * cancel). Mirrors sales-invoices/status.ts's transition-table + assert
 * pattern exactly, with the quote's own (simpler, non-GL) state machine.
 */

import type { SalesQuoteStatus } from "./sales-quote.js";
import { InvalidSalesQuoteTransitionError } from "./errors.js";

export const SALES_QUOTE_TRANSITIONS: Readonly<
  Record<SalesQuoteStatus, readonly SalesQuoteStatus[]>
> = {
  draft: ["sent", "cancelled"],
  sent: ["accepted", "rejected", "cancelled"],
  accepted: ["converted", "cancelled"],
  rejected: [],
  converted: [],
  cancelled: [],
};

export function canTransition(from: SalesQuoteStatus, to: SalesQuoteStatus): boolean {
  return SALES_QUOTE_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  quoteId: string,
  from: SalesQuoteStatus,
  to: SalesQuoteStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidSalesQuoteTransitionError(quoteId, from, to);
  }
}
