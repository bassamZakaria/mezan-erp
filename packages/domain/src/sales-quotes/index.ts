/**
 * Sales Quotations (عروض الأسعار, docs/archive/catalog/01-sales.md) — the pre-sale
 * document a customer is quoted before any invoice exists. Mirrors the
 * sales-invoice document shape but never posts to the GL and never moves
 * stock; conversion to a sales invoice is implemented outside this module.
 */

export {
  type SalesQuote,
  type SalesQuoteLine,
  type SalesQuoteStatus,
  type SalesQuoteDiscount,
  type SalesQuoteDiscountType,
  SALES_QUOTE_STATUS_LABELS_AR,
  isQuoteExpired,
} from "./sales-quote.js";

export {
  SALES_QUOTE_TRANSITIONS,
  canTransition as canSalesQuoteTransition,
  assertTransition as assertSalesQuoteTransition,
} from "./status.js";

export {
  computeQuoteTotals,
  QUOTE_ROUNDING_DECIMALS,
  type SalesQuoteTotals,
  type SalesQuoteLineTotals,
} from "./totals.js";

export { describeQuoteEffects } from "./effects.js";

export type { SalesQuoteRepository, SalesQuoteListFilter } from "./ports.js";

export {
  SalesQuoteService,
  type SalesQuoteServiceDeps,
  type CreateSalesQuoteCommand,
  type CreateSalesQuoteLine,
} from "./service.js";

export {
  InvalidSalesQuoteError,
  SalesQuoteNotFoundError,
  InvalidSalesQuoteTransitionError,
} from "./errors.js";
