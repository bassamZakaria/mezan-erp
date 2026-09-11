import { describe, it, expect } from "vitest";
import {
  PurchaseOrderNotFoundError,
  GoodsReceiptNotFoundError,
  PurchaseInvoiceNotFoundError,
  DuplicatePurchaseDocumentError,
  InvalidPurchaseDocumentError,
  PurchaseDocumentNotDraftError,
  PurchaseOrderNotReceivableError,
  ReceiptRequiredError,
  OverReceiptError,
  PurchaseOrderRequiredError,
  PurchaseItemsAlreadyConsumedError,
  GoodsReceiptAlreadyInvoicedError,
  RfqNotFoundError,
  InvalidRfqError,
  RfqNotDraftError,
  RfqNotSentError,
  RfqNotOpenError,
  RfqQuoteNotFoundError,
} from "./errors.js";

describe("purchasing errors", () => {
  it("PurchaseOrderNotFoundError carries the id and a stable code", () => {
    const err = new PurchaseOrderNotFoundError("po-9");
    expect(err.code).toBe("PURCHASE_ORDER_NOT_FOUND");
    expect(err.id).toBe("po-9");
    expect(err.name).toBe("PurchaseOrderNotFoundError");
    expect(err.message).toContain("po-9");
    expect(err).toBeInstanceOf(Error);
  });

  it("GoodsReceiptNotFoundError carries the id", () => {
    const err = new GoodsReceiptNotFoundError("gr-1");
    expect(err.code).toBe("GOODS_RECEIPT_NOT_FOUND");
    expect(err.id).toBe("gr-1");
  });

  it("PurchaseInvoiceNotFoundError carries the id", () => {
    const err = new PurchaseInvoiceNotFoundError("pi-1");
    expect(err.code).toBe("PURCHASE_INVOICE_NOT_FOUND");
    expect(err.id).toBe("pi-1");
  });

  it("DuplicatePurchaseDocumentError names the duplicate id", () => {
    const err = new DuplicatePurchaseDocumentError("doc-1");
    expect(err.code).toBe("DUPLICATE_PURCHASE_DOCUMENT");
    expect(err.message).toContain("doc-1");
  });

  it("InvalidPurchaseDocumentError joins every reason into the message", () => {
    const err = new InvalidPurchaseDocumentError(["reason A", "reason B"]);
    expect(err.code).toBe("INVALID_PURCHASE_DOCUMENT");
    expect(err.reasons).toEqual(["reason A", "reason B"]);
    expect(err.message).toBe("مستند مشتريات غير صالح: reason A، reason B");
  });

  it("PurchaseDocumentNotDraftError names both the id and the current status", () => {
    const err = new PurchaseDocumentNotDraftError("doc-1", "confirmed");
    expect(err.code).toBe("PURCHASE_DOCUMENT_NOT_DRAFT");
    expect(err.status).toBe("confirmed");
    expect(err.message).toContain("confirmed");
  });

  it("PurchaseOrderNotReceivableError names the id and status", () => {
    const err = new PurchaseOrderNotReceivableError("po-1", "cancelled");
    expect(err.code).toBe("PURCHASE_ORDER_NOT_RECEIVABLE");
    expect(err.id).toBe("po-1");
    expect(err.status).toBe("cancelled");
  });

  it("ReceiptRequiredError has a fixed, code-only message", () => {
    const err = new ReceiptRequiredError();
    expect(err.code).toBe("PURCHASE_RECEIPT_REQUIRED");
    expect(err.message).toContain("إلزام إذن الاستلام قبل الفاتورة");
  });

  it("OverReceiptError names the offending item", () => {
    const err = new OverReceiptError("item-A");
    expect(err.code).toBe("PURCHASE_OVER_RECEIPT");
    expect(err.itemId).toBe("item-A");
    expect(err.message).toContain("item-A");
  });

  it("PurchaseOrderRequiredError's message is the exact Arabic sentence the API forwards to the UI", () => {
    const err = new PurchaseOrderRequiredError();
    expect(err.code).toBe("PURCHASE_ORDER_REQUIRED");
    expect(err.message).toBe(
      "سياسة «إلزام أمر الشراء قبل الاستلام» مفعّلة: لا يمكن إنشاء إذن استلام بدون أمر شراء مؤكد.",
    );
  });

  it("PurchaseItemsAlreadyConsumedError names the id", () => {
    const err = new PurchaseItemsAlreadyConsumedError("doc-9");
    expect(err.code).toBe("PURCHASE_ITEMS_ALREADY_CONSUMED");
    expect(err.id).toBe("doc-9");
  });

  it("GoodsReceiptAlreadyInvoicedError names the id", () => {
    const err = new GoodsReceiptAlreadyInvoicedError("gr-2");
    expect(err.code).toBe("GOODS_RECEIPT_ALREADY_INVOICED");
    expect(err.id).toBe("gr-2");
  });

  it("RfqNotFoundError names the id", () => {
    const err = new RfqNotFoundError("rfq-1");
    expect(err.code).toBe("RFQ_NOT_FOUND");
  });

  it("InvalidRfqError joins reasons", () => {
    const err = new InvalidRfqError(["missing supplier"]);
    expect(err.code).toBe("INVALID_RFQ");
    expect(err.message).toBe("طلب عرض سعر غير صالح: missing supplier");
  });

  it("RfqNotDraftError names id and status", () => {
    const err = new RfqNotDraftError("rfq-1", "sent");
    expect(err.code).toBe("RFQ_NOT_DRAFT");
    expect(err.status).toBe("sent");
  });

  it("RfqNotSentError names id and status", () => {
    const err = new RfqNotSentError("rfq-1", "draft");
    expect(err.code).toBe("RFQ_NOT_SENT");
  });

  it("RfqNotOpenError names id and status", () => {
    const err = new RfqNotOpenError("rfq-1", "closed");
    expect(err.code).toBe("RFQ_NOT_OPEN");
  });

  it("RfqQuoteNotFoundError names the id", () => {
    const err = new RfqQuoteNotFoundError("quote-1");
    expect(err.code).toBe("RFQ_QUOTE_NOT_FOUND");
  });
});
