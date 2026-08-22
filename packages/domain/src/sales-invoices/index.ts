/**
 * Sales Invoices (فواتير المبيعات, docs/catalog/01-sales.md) — the document that
 * deducts stock and books a customer receivable. Built on the document framework
 * (lifecycle guards, effects descriptor, GL/stock/numbering/workflow hooks) and
 * the GL + stock-ledger engines; it never re-implements posting.
 */

export {
  type SalesInvoice,
  type SalesInvoiceLine,
  type SalesInvoiceStatus,
  type SalesInvoiceDiscount,
  type SalesInvoiceDiscountType,
  SALES_INVOICE_ACTIVE_STATUSES,
  SALES_INVOICE_TERMINAL_STATUSES,
  SALES_INVOICE_STATUS_LABELS_AR,
  isSalesInvoiceActive,
  isSalesInvoiceTerminal,
  isOverdue,
} from "./sales-invoice.js";

export {
  SALES_INVOICE_TRANSITIONS,
  canTransition as canSalesInvoiceTransition,
  assertTransition as assertSalesInvoiceTransition,
} from "./status.js";

export {
  computeInvoiceTotals,
  INVOICE_ROUNDING_DECIMALS,
  type SalesInvoiceTotals,
  type SalesInvoiceLineTotals,
} from "./totals.js";

export { describeSalesInvoiceEffects } from "./effects.js";

export {
  buildSalesInvoiceGlPosting,
  type SalesInvoiceCogsLine,
} from "./gl.js";

export type {
  SalesInvoiceRepository,
  SalesInvoiceListFilter,
  SalesInvoiceStockHook,
  SalesInvoiceStockIssue,
  SalesInvoiceIssueLine,
  SalesInvoiceStockResult,
  SalesInvoiceIssuedLineCost,
  SalesInvoiceCustomerExposureHook,
} from "./ports.js";

export {
  SalesInvoiceService,
  type SalesInvoiceServiceDeps,
  type SalesInvoiceCreditControlDeps,
  type CreateSalesInvoiceCommand,
  type CreateSalesInvoiceLine,
  type ConfirmSalesInvoiceOptions,
  type ConfirmSalesInvoiceResult,
} from "./service.js";

export {
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  createSalesInvoiceCustomerExposureHook,
} from "./adapters.js";

export {
  InvalidSalesInvoiceError,
  SalesInvoiceNotFoundError,
  DuplicateSalesInvoiceError,
  InvalidSalesInvoiceTransitionError,
  InvalidSalesInvoicePaymentError,
} from "./errors.js";
