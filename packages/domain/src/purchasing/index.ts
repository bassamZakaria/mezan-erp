/**
 * purchasing/ — the purchase chain (docs/catalog/02): أوامر الشراء (Purchase
 * Orders) → استلام البضائع (Goods Receipts) → فواتير المشتريات (Purchase
 * Invoices), built on the shared numbering, workflow, costing/stock-ledger and
 * GL engines. Pure domain — ports only.
 */

export {
  DEFAULT_PURCHASE_POLICY,
  type PurchasePolicy,
  type PurchaseOrderStatus,
  type GoodsReceiptStatus,
  type PurchaseInvoiceStatus,
  type PurchaseGlPosting,
  type PurchaseGlPostingLine,
  type PurchaseGlPostingPort,
  type PurchaseGlAccounts,
  type PurchaseStockPostingPort,
} from "./types.js";

export {
  PurchaseOrderNotFoundError,
  GoodsReceiptNotFoundError,
  PurchaseInvoiceNotFoundError,
  DuplicatePurchaseDocumentError,
  InvalidPurchaseDocumentError,
  PurchaseDocumentNotDraftError,
  PurchaseOrderNotReceivableError,
  ReceiptRequiredError,
  OverReceiptError,
} from "./errors.js";

export {
  createPurchaseOrder,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
  applyReceiptToOrder,
  purchaseOrderLineTotal,
  purchaseOrderSubtotal,
  purchaseOrderTotal,
  lineOutstandingQty,
  isFullyReceived,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderRepository,
  type PurchaseOrderLineInput,
  type CreatePurchaseOrderCommand,
  type PurchaseOrderDeps,
} from "./purchase-order.js";

export {
  createGoodsReceipt,
  confirmGoodsReceipt,
  markGoodsReceiptInvoiced,
  buildReceiptLinesFromOrder,
  goodsReceiptTotalCost,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type GoodsReceiptRepository,
  type GoodsReceiptLineInput,
  type CreateGoodsReceiptCommand,
  type CreateGoodsReceiptDeps,
  type ConfirmGoodsReceiptDeps,
} from "./goods-receipt.js";

export {
  createPurchaseInvoice,
  confirmPurchaseInvoice,
  buildInvoicePosting,
  buildInvoiceLinesFromReceipt,
  purchaseInvoiceLineBase,
  purchaseInvoiceLineTax,
  purchaseInvoiceSubtotal,
  purchaseInvoiceInventoryBase,
  purchaseInvoiceFreightBase,
  purchaseInvoiceTax,
  purchaseInvoiceTotal,
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceLineKind,
  type PurchaseInvoiceRepository,
  type PurchaseInvoiceLineInput,
  type CreatePurchaseInvoiceCommand,
  type CreatePurchaseInvoiceDeps,
  type ConfirmPurchaseInvoiceDeps,
  type ConfirmPurchaseInvoiceResult,
} from "./purchase-invoice.js";
