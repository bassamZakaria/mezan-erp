/**
 * Purchase Returns (مرتجعات المشتريات، docs/archive/catalog/02) — a document-framework
 * consumer. Removes stock at cost, reduces the supplier payable via one
 * balanced GL entry.
 */

export {
  DOC_TYPE as PURCHASE_RETURN_DOC_TYPE,
  PURCHASE_RETURN_REASONS,
  createPurchaseReturnDocumentType,
  purchaseReturnGrandTotal,
  type PurchaseReturnReason,
  type PurchaseReturnLine,
  type PurchaseReturnDocument,
  type PurchaseReturnGlAccounts,
} from "./purchase-return-document.js";

export {
  buildPurchaseReturnLinesFromInvoice,
  type PurchaseReturnRequestedQty,
} from "./from-invoice.js";

export type {
  SourcePurchaseInvoiceLine,
  SourcePurchaseInvoice,
  PurchaseInvoiceLookupPort,
} from "./ports.js";
