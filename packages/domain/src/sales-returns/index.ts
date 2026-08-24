/**
 * Sales Returns (مرتجعات المبيعات، docs/catalog/01) — a document-framework
 * consumer. Restocks at cost, reverses AR/revenue/COGS via one balanced GL
 * entry, never auto-refunds cash (see `isAwaitingRefund`).
 */

export {
  DOC_TYPE as SALES_RETURN_DOC_TYPE,
  SALES_RETURN_REASONS,
  isAwaitingRefund,
  salesReturnGrandTotal,
  salesReturnLineCredit,
  salesReturnCreditByInvoice,
  createSalesReturnDocumentType,
  type SalesReturnReason,
  type SalesReturnLine,
  type SalesReturnDocument,
  type SalesReturnGlAccounts,
} from "./sales-return-document.js";

export {
  buildSalesReturnLinesFromInvoice,
  type SalesReturnRequestedQty,
} from "./from-invoice.js";

export type {
  SourceSalesInvoiceLine,
  SourceSalesInvoice,
  SalesInvoiceLookupPort,
} from "./ports.js";
