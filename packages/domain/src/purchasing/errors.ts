/** Typed errors for the purchase chain (docs/catalog/02). Each carries a stable
 *  machine `code` the API maps to an HTTP status. */

export class PurchaseOrderNotFoundError extends Error {
  readonly code = "PURCHASE_ORDER_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Purchase order "${id}" was not found.`);
    this.name = "PurchaseOrderNotFoundError";
  }
}

export class GoodsReceiptNotFoundError extends Error {
  readonly code = "GOODS_RECEIPT_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Goods receipt "${id}" was not found.`);
    this.name = "GoodsReceiptNotFoundError";
  }
}

export class PurchaseInvoiceNotFoundError extends Error {
  readonly code = "PURCHASE_INVOICE_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Purchase invoice "${id}" was not found.`);
    this.name = "PurchaseInvoiceNotFoundError";
  }
}

export class DuplicatePurchaseDocumentError extends Error {
  readonly code = "DUPLICATE_PURCHASE_DOCUMENT";
  constructor(readonly id: string) {
    super(`A purchase document with id "${id}" already exists.`);
    this.name = "DuplicatePurchaseDocumentError";
  }
}

export class InvalidPurchaseDocumentError extends Error {
  readonly code = "INVALID_PURCHASE_DOCUMENT";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid purchase document: ${reasons.join("; ")}`);
    this.name = "InvalidPurchaseDocumentError";
  }
}

export class PurchaseDocumentNotDraftError extends Error {
  readonly code = "PURCHASE_DOCUMENT_NOT_DRAFT";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`Purchase document "${id}" is "${status}", not a draft.`);
    this.name = "PurchaseDocumentNotDraftError";
  }
}

export class PurchaseOrderNotReceivableError extends Error {
  readonly code = "PURCHASE_ORDER_NOT_RECEIVABLE";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(
      `Purchase order "${id}" is "${status}"; goods can only be received against a sent or partially-received order.`,
    );
    this.name = "PurchaseOrderNotReceivableError";
  }
}

export class ReceiptRequiredError extends Error {
  readonly code = "PURCHASE_RECEIPT_REQUIRED";
  constructor() {
    super(
      "A confirmed goods receipt is required before a purchase invoice may be created (strictness gate is on).",
    );
    this.name = "ReceiptRequiredError";
  }
}

export class OverReceiptError extends Error {
  readonly code = "PURCHASE_OVER_RECEIPT";
  constructor(readonly itemId: string) {
    super(
      `Goods receipt would receive more than the purchase order's outstanding quantity for item "${itemId}" (strictness gate is on).`,
    );
    this.name = "OverReceiptError";
  }
}

export class PurchaseOrderRequiredError extends Error {
  readonly code = "PURCHASE_ORDER_REQUIRED";
  constructor() {
    // The message reaches an Arabic UI verbatim (the API forwards `message`),
    // so the refusal names the setting the tenant can change.
    super("سياسة «إلزام أمر الشراء قبل الاستلام» مفعّلة: لا يمكن إنشاء إذن استلام بدون أمر شراء مؤكد.");
    this.name = "PurchaseOrderRequiredError";
  }
}

export class PurchaseItemsAlreadyConsumedError extends Error {
  readonly code = "PURCHASE_ITEMS_ALREADY_CONSUMED";
  constructor(readonly id: string) {
    super(
      `Purchase document "${id}" cannot be cancelled: some of its goods have already been sold, transferred, or consumed (strictness gate is on).`,
    );
    this.name = "PurchaseItemsAlreadyConsumedError";
  }
}

export class GoodsReceiptAlreadyInvoicedError extends Error {
  readonly code = "GOODS_RECEIPT_ALREADY_INVOICED";
  constructor(readonly id: string) {
    super(`Goods receipt "${id}" has already been invoiced and cannot be cancelled.`);
    this.name = "GoodsReceiptAlreadyInvoicedError";
  }
}

// --- RFQ (طلبات عروض الأسعار) ------------------------------------------------

export class RfqNotFoundError extends Error {
  readonly code = "RFQ_NOT_FOUND";
  constructor(readonly id: string) {
    super(`RFQ "${id}" was not found.`);
    this.name = "RfqNotFoundError";
  }
}

export class InvalidRfqError extends Error {
  readonly code = "INVALID_RFQ";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid RFQ: ${reasons.join("; ")}`);
    this.name = "InvalidRfqError";
  }
}

export class RfqNotDraftError extends Error {
  readonly code = "RFQ_NOT_DRAFT";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`RFQ "${id}" is "${status}", not a draft.`);
    this.name = "RfqNotDraftError";
  }
}

export class RfqNotSentError extends Error {
  readonly code = "RFQ_NOT_SENT";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`RFQ "${id}" is "${status}"; quotes can only be recorded against a sent RFQ.`);
    this.name = "RfqNotSentError";
  }
}

export class RfqNotOpenError extends Error {
  readonly code = "RFQ_NOT_OPEN";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`RFQ "${id}" is "${status}" and cannot be closed/cancelled from this state.`);
    this.name = "RfqNotOpenError";
  }
}

export class RfqQuoteNotFoundError extends Error {
  readonly code = "RFQ_QUOTE_NOT_FOUND";
  constructor(readonly id: string) {
    super(`RFQ quote "${id}" was not found.`);
    this.name = "RfqQuoteNotFoundError";
  }
}
