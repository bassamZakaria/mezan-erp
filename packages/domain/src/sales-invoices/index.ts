/**
 * Sales Invoices (فواتير المبيعات, docs/archive/catalog/01-sales.md) — the document that
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
  type SalesInvoiceLineDiscountType,
  type AppliedSalesInvoicePromotion,
  type AppliedPromotionLineDiscount,
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
  salesInvoiceTotals,
  salesInvoiceBaseGrandTotal,
  salesInvoiceBaseTotals,
  INVOICE_ROUNDING_DECIMALS,
  type SalesInvoiceTotals,
  type SalesInvoiceLineTotals,
  type SalesInvoiceBaseTotals,
} from "./totals.js";

export { describeSalesInvoiceEffects } from "./effects.js";

export {
  buildSalesInvoiceGlPosting,
  type SalesInvoiceCogsLine,
  type SalesInvoiceFxContext,
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
  SalesInvoicePromotionHook,
  SalesInvoicePromotionRequest,
  SalesInvoiceWritePrecondition,
} from "./ports.js";
export { SalesInvoiceField } from "./ports.js";

export { salesTaxPolicyFromSettings, salesTaxPolicySource, type SalesTaxPolicySource } from "./tax-policy.js";

export {
  SalesInvoiceService,
  applyAllocatedSettlement,
  type SalesInvoiceServiceDeps,
  type SalesInvoicePricingDeps,
  type ContractBillingRouting,
  type ContractBillingRoutingPort,
  type SalesInvoiceTaxPolicy,
  type PricingVariance,
  type SalesInvoiceCreditControlDeps,
  type CreateSalesInvoiceCommand,
  type CreateSalesInvoiceLine,
  type ConfirmSalesInvoiceOptions,
  type ConfirmSalesInvoiceResult,
  type ClassifySalesInvoiceLineTaxResult,
  type SalesInvoiceTaxFilingPort,
} from "./service.js";

export {
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  type CrossWarehouseSourceResolver,
  createSalesInvoiceCustomerExposureHook,
} from "./adapters.js";

export {
  createSalesInvoicePromotionHook,
  type SalesInvoicePromotionHookOptions,
} from "./promotion-adapter.js";

export {
  InvalidSalesInvoiceError,
  SalesInvoiceNotFoundError,
  DuplicateSalesInvoiceError,
  InvalidSalesInvoiceTransitionError,
  InvalidSalesInvoicePaymentError,
} from "./errors.js";

export {
  previewHistoricalSalesImport,
  importHistoricalSalesDocuments,
  assertHistoricalSalesImportBatchNotEmpty,
  type HistoricalSalesDocType,
  type HistoricalSalesImportRowInput,
  type HistoricalSalesImportRowError,
  type HistoricalSalesArchiveLine,
  type HistoricalSalesArchive,
  type HistoricalSalesArchiveRepository,
  type HistoricalSalesImportGlPostingLine,
  type HistoricalSalesImportGlPosting,
  type HistoricalSalesImportGlPostingPort,
  type HistoricalSalesImportGlAccounts,
  type HistoricalSalesImportGroup,
  type HistoricalSalesImportPreview,
  type ImportHistoricalSalesDocumentsCommand,
  type ImportHistoricalSalesDocumentsDeps,
  type ImportHistoricalSalesDocumentsResult,
} from "./historical-import.js";
