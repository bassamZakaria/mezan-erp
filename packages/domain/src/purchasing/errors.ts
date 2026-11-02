import { statusWord } from "../status-words.js";
import type { Qty } from "../money/index.js";
import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

/** Typed errors for the purchase chain (docs/archive/catalog/02). Each carries a stable
 *  machine `code` the API maps to an HTTP status. */

export class PurchaseOrderNotFoundError extends Error {
  readonly code = "PURCHASE_ORDER_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`أمر الشراء "${id}" غير موجود.`);
    this.messageEn = `Purchase order "${id}" was not found.`;
    this.name = "PurchaseOrderNotFoundError";
  }
}

export class GoodsReceiptNotFoundError extends Error {
  readonly code = "GOODS_RECEIPT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`إذن الاستلام "${id}" غير موجود.`);
    this.messageEn = `Goods receipt "${id}" was not found.`;
    this.name = "GoodsReceiptNotFoundError";
  }
}

export class PurchaseInvoiceNotFoundError extends Error {
  readonly code = "PURCHASE_INVOICE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`فاتورة المشتريات "${id}" غير موجودة.`);
    this.messageEn = `Purchase invoice "${id}" was not found.`;
    this.name = "PurchaseInvoiceNotFoundError";
  }
}

export class InvalidPurchaseDocumentError extends Error {
  readonly code = "INVALID_PURCHASE_DOCUMENT";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`مستند مشتريات غير صالح: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid purchase document: ${split.en}`;
    this.name = "InvalidPurchaseDocumentError";
  }
}

export class PurchaseDocumentNotDraftError extends Error {
  readonly code = "PURCHASE_DOCUMENT_NOT_DRAFT";
  readonly messageEn: string;
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`مستند المشتريات "${id}" حالته "${statusWord(status).ar}" وليس مسودة.`);
    this.messageEn = `Purchase document "${id}" is "${statusWord(status).en}", not a draft.`;
    this.name = "PurchaseDocumentNotDraftError";
  }
}

export class PurchaseOrderNotReceivableError extends Error {
  readonly code = "PURCHASE_ORDER_NOT_RECEIVABLE";
  readonly messageEn: string;
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(
      `أمر الشراء "${id}" حالته "${statusWord(status).ar}" — لا يمكن الاستلام إلا على أمر مُرسَل أو مستلَم جزئياً.`,
    );
    this.messageEn = `Purchase order "${id}" is "${statusWord(status).en}" — goods can only be received against a sent or partially received order.`;
    this.name = "PurchaseOrderNotReceivableError";
  }
}

export class ReceiptRequiredError extends Error {
  readonly code = "PURCHASE_RECEIPT_REQUIRED";
  readonly messageEn: string;
  constructor() {
    super(
      "سياسة «إلزام إذن الاستلام قبل الفاتورة» مفعّلة: لا يمكن إنشاء فاتورة مشتريات بدون إذن استلام مؤكد.",
    );
    this.messageEn = "The \"require a goods receipt before the invoice\" policy is on: a purchase invoice cannot be created without a confirmed goods receipt.";
    this.name = "ReceiptRequiredError";
  }
}

export class OverReceiptError extends Error {
  readonly code = "PURCHASE_OVER_RECEIPT";
  readonly messageEn: string;
  constructor(
    readonly itemId: string,
    readonly wanted: Qty,
    readonly ordered: Qty,
    readonly received: Qty,
    readonly allowedMax: Qty,
    readonly tolerancePercent: number,
  ) {
    const q = (v: Qty) => v.toString().replace(/\.?0+$/, "");
    super(
      `لا يمكن استلام ${q(wanted)} من الصنف "${itemId}": الكمية المطلوبة في أمر الشراء ${q(ordered)}، والمستلم حتى الآن ${q(received)}، والحد الأقصى المسموح باستلامه ${q(allowedMax)} (نسبة السماح بالزيادة ${tolerancePercent}٪). يمكن ضبط نسبة التجاوز المسموح بها في الإعدادات ← المشتريات.`,
    );
    this.messageEn = `Cannot receive ${q(wanted)} of item "${itemId}": the purchase order is for ${q(ordered)}, ${q(received)} has been received so far, and at most ${q(allowedMax)} may be received in all (over-receipt tolerance ${tolerancePercent}%). The allowed over-receipt percentage can be set in Settings → Purchases.`;
    this.name = "OverReceiptError";
  }
}

export class PurchaseOrderRequiredError extends Error {
  readonly code = "PURCHASE_ORDER_REQUIRED";
  readonly messageEn: string;
  constructor() {
    // The message reaches an Arabic UI verbatim (the API forwards `message`),
    // so the refusal names the setting the tenant can change.
    super("سياسة «إلزام أمر الشراء قبل الاستلام» مفعّلة: لا يمكن إنشاء إذن استلام بدون أمر شراء مؤكد.");
    this.messageEn = "The \"require a purchase order before receiving\" policy is on: a goods receipt cannot be created without a confirmed purchase order.";
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

export class GoodsReceiptAccrualAccountMissingError extends Error {
  readonly code = "GOODS_RECEIPT_ACCRUAL_ACCOUNT_MISSING";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`لا يمكن تأكيد إذن الاستلام "${id}": حساب «بضاعة واردة لم تُفوتر» غير مُعرَّف، والبضاعة لا تدخل المخزون بلا قيد محاسبي. عرّف الحساب في إعدادات حسابات المشتريات ثم أعد التأكيد.`);
    this.messageEn = `Goods receipt "${id}" cannot be confirmed: no received-not-invoiced account is configured, and goods do not enter stock without a journal entry. Configure the account in the purchasing account settings, then confirm again.`;
    this.name = "GoodsReceiptAccrualAccountMissingError";
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
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`طلب عرض السعر "${id}" غير موجود.`);
    this.messageEn = `Request for quotation "${id}" was not found.`;
    this.name = "RfqNotFoundError";
  }
}

export class InvalidRfqError extends Error {
  readonly code = "INVALID_RFQ";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`طلب عرض سعر غير صالح: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid request for quotation: ${split.en}`;
    this.name = "InvalidRfqError";
  }
}

export class RfqNotDraftError extends Error {
  readonly code = "RFQ_NOT_DRAFT";
  readonly messageEn: string;
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`طلب عرض السعر "${id}" حالته "${statusWord(status).ar}" وليس مسودة.`);
    this.messageEn = `Request for quotation "${id}" is "${statusWord(status).en}", not a draft.`;
    this.name = "RfqNotDraftError";
  }
}

export class RfqNotSentError extends Error {
  readonly code = "RFQ_NOT_SENT";
  readonly messageEn: string;
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`طلب عرض السعر "${id}" حالته "${statusWord(status).ar}" — لا تُسجَّل العروض إلا على طلب مُرسَل.`);
    this.messageEn = `Request for quotation "${id}" is "${statusWord(status).en}" — quotes can only be recorded against a sent request.`;
    this.name = "RfqNotSentError";
  }
}

export class RfqNotOpenError extends Error {
  readonly code = "RFQ_NOT_OPEN";
  readonly messageEn: string;
  constructor(
    readonly id: string,
    readonly status: string,
  ) {
    super(`طلب عرض السعر "${id}" حالته "${statusWord(status).ar}" ولا يمكن إغلاقه أو إلغاؤه منها.`);
    this.messageEn = `Request for quotation "${id}" is "${statusWord(status).en}" and cannot be closed or cancelled from that status.`;
    this.name = "RfqNotOpenError";
  }
}

export class RfqQuoteNotFoundError extends Error {
  readonly code = "RFQ_QUOTE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`عرض السعر "${id}" غير موجود.`);
    this.messageEn = `Quote "${id}" was not found.`;
    this.name = "RfqQuoteNotFoundError";
  }
}
