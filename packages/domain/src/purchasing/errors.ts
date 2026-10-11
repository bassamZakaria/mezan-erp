/** Typed errors for the purchase chain (docs/archive/catalog/02). Each carries a stable
 *  machine `code` the API maps to an HTTP status. */

export class PurchaseOrderNotFoundError extends Error {
  readonly code = "PURCHASE_ORDER_NOT_FOUND";
  constructor(readonly id: string) {
    super(`أمر الشراء "${id}" غير موجود.`);
    this.name = "PurchaseOrderNotFoundError";
  }
}

export class GoodsReceiptNotFoundError extends Error {
  readonly code = "GOODS_RECEIPT_NOT_FOUND";
  constructor(readonly id: string) {
    super(`إذن الاستلام "${id}" غير موجود.`);
    this.name = "GoodsReceiptNotFoundError";
  }
}

export class PurchaseInvoiceNotFoundError extends Error {
  readonly code = "PURCHASE_INVOICE_NOT_FOUND";
  constructor(readonly id: string) {
    super(`فاتورة المشتريات "${id}" غير موجودة.`);
    this.name = "PurchaseInvoiceNotFoundError";
  }
}

export class DuplicatePurchaseDocumentError extends Error {
  readonly code = "DUPLICATE_PURCHASE_DOCUMENT";
  constructor(readonly id: string) {
    super(`يوجد مستند مشتريات بالمعرّف "${id}" بالفعل.`);
    this.name = "DuplicatePurchaseDocumentError";
  }
}

export class InvalidPurchaseDocumentError extends Error {
  readonly code = "INVALID_PURCHASE_DOCUMENT";
  constructor(readonly reasons: readonly string[]) {
    super(`مستند مشتريات غير صالح: ${reasons.join("، ")}`);
    this.name = "InvalidPurchaseDocumentError";
  }
}

export class PurchaseDocumentNotDraftError extends Error {
  readonly code = "PURCHASE_DOCUMENT_NOT_DRAFT";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`مستند المشتريات "${id}" حالته "${status}" وليس مسودة.`);
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
      `أمر الشراء "${id}" حالته "${status}" — لا يمكن الاستلام إلا على أمر مُرسَل أو مستلَم جزئياً.`,
    );
    this.name = "PurchaseOrderNotReceivableError";
  }
}

export class ReceiptRequiredError extends Error {
  readonly code = "PURCHASE_RECEIPT_REQUIRED";
  constructor() {
    super(
      "سياسة «إلزام إذن الاستلام قبل الفاتورة» مفعّلة: لا يمكن إنشاء فاتورة مشتريات بدون إذن استلام مؤكد.",
    );
    this.name = "ReceiptRequiredError";
  }
}

export class OverReceiptError extends Error {
  readonly code = "PURCHASE_OVER_RECEIPT";
  constructor(readonly itemId: string) {
    super(
      `الكمية المستلمة للصنف "${itemId}" تتجاوز المتبقي على أمر الشراء، وسياسة منع الاستلام الزائد مفعّلة.`,
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
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(
      `لا يمكن إلغاء مستند المشتريات "${id}": جزء من بضاعته بيع أو نُقل أو استُهلك بالفعل. سجّل مرتجع مشتريات بالكمية الباقية في المخزن بدلاً من الإلغاء.`,
    );
    this.messageEn = `Purchase document "${id}" cannot be cancelled: some of its goods have already been sold, transferred or consumed. Record a purchase return for what is still on hand instead.`;
    this.name = "PurchaseItemsAlreadyConsumedError";
  }
}

export enum GoodsReceiptInvoicedRefusal {
  Cancel = "cancel",
  SecondInvoice = "second_invoice",
}

export class GoodsReceiptAlreadyInvoicedError extends Error {
  readonly code = "GOODS_RECEIPT_ALREADY_INVOICED";
  readonly messageEn: string;
  constructor(
    readonly id: string,
    readonly refusal: GoodsReceiptInvoicedRefusal = GoodsReceiptInvoicedRefusal.Cancel,
  ) {
    super(
      refusal === GoodsReceiptInvoicedRefusal.Cancel
        ? `إذن الاستلام "${id}" تمت فوترته ولا يمكن إلغاؤه.`
        : `إذن الاستلام "${id}" فُوترت كل كمياته بفواتير مشتريات مؤكدة، ولا تُؤكَّد عليه فاتورة أخرى. ألغِ الفاتورة القائمة أولاً إن كانت هذه هي الصحيحة.`,
    );
    this.messageEn =
      refusal === GoodsReceiptInvoicedRefusal.Cancel
        ? `Goods receipt "${id}" has been invoiced and cannot be cancelled.`
        : `Goods receipt "${id}" is already fully billed by confirmed purchase invoices; another one cannot be confirmed against it. Cancel the standing invoice first if this is the right one.`;
    this.name = "GoodsReceiptAlreadyInvoicedError";
  }
}

export class InvoiceDoesNotMatchReceiptError extends Error {
  readonly code = "INVOICE_DOES_NOT_MATCH_RECEIPT";
  readonly messageEn: string;
  constructor(
    readonly receiptId: string,
    readonly reasons: readonly { readonly ar: string; readonly en: string }[],
  ) {
    super(`فاتورة المشتريات لا تطابق إذن الاستلام "${receiptId}": ${reasons.map((r) => r.ar).join("، ")}.`);
    this.messageEn = `The purchase invoice does not match goods receipt "${receiptId}": ${reasons.map((r) => r.en).join("; ")}.`;
    this.name = "InvoiceDoesNotMatchReceiptError";
  }
}

export class InvoiceExceedsReceiptError extends Error {
  readonly code = "INVOICE_EXCEEDS_RECEIPT";
  readonly messageEn: string;
  constructor(
    readonly receiptId: string,
    readonly excess: readonly { readonly itemId: string; readonly requested: string; readonly remaining: string }[],
  ) {
    super(
      `فاتورة المشتريات تتجاوز الكمية المتبقية بدون فوترة في إذن الاستلام "${receiptId}": ${excess
        .map((e) => `الصنف "${e.itemId}" مطلوب فوترة ${e.requested} والمتبقي ${e.remaining}`)
        .join("، ")}.`,
    );
    this.messageEn = `The purchase invoice bills more than goods receipt "${receiptId}" still has uninvoiced: ${excess
      .map((e) => `item "${e.itemId}" requested ${e.requested}, remaining ${e.remaining}`)
      .join("; ")}.`;
    this.name = "InvoiceExceedsReceiptError";
  }
}

// --- RFQ (طلبات عروض الأسعار) ------------------------------------------------

export class RfqNotFoundError extends Error {
  readonly code = "RFQ_NOT_FOUND";
  constructor(readonly id: string) {
    super(`طلب عرض السعر "${id}" غير موجود.`);
    this.name = "RfqNotFoundError";
  }
}

export class InvalidRfqError extends Error {
  readonly code = "INVALID_RFQ";
  constructor(readonly reasons: readonly string[]) {
    super(`طلب عرض سعر غير صالح: ${reasons.join("، ")}`);
    this.name = "InvalidRfqError";
  }
}

export class RfqNotDraftError extends Error {
  readonly code = "RFQ_NOT_DRAFT";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`طلب عرض السعر "${id}" حالته "${status}" وليس مسودة.`);
    this.name = "RfqNotDraftError";
  }
}

export class RfqNotSentError extends Error {
  readonly code = "RFQ_NOT_SENT";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`طلب عرض السعر "${id}" حالته "${status}" — لا تُسجَّل العروض إلا على طلب مُرسَل.`);
    this.name = "RfqNotSentError";
  }
}

export class RfqNotOpenError extends Error {
  readonly code = "RFQ_NOT_OPEN";
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`طلب عرض السعر "${id}" حالته "${status}" ولا يمكن إغلاقه أو إلغاؤه منها.`);
    this.name = "RfqNotOpenError";
  }
}

export class RfqQuoteNotFoundError extends Error {
  readonly code = "RFQ_QUOTE_NOT_FOUND";
  constructor(readonly id: string) {
    super(`عرض السعر "${id}" غير موجود.`);
    this.name = "RfqQuoteNotFoundError";
  }
}
