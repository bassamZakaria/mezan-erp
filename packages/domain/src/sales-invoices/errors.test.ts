import { describe, it, expect } from "vitest";
import {
  InvalidSalesInvoiceError,
  SalesInvoiceNotFoundError,
  DuplicateSalesInvoiceError,
  InvalidSalesInvoiceTransitionError,
  InvalidSalesInvoicePaymentError,
} from "./errors.js";

describe("InvalidSalesInvoiceError", () => {
  it("carries its reasons and joins them into the message", () => {
    const err = new InvalidSalesInvoiceError(["العميل مطلوب.", "المستودع مطلوب."]);
    expect(err.code).toBe("INVALID_SALES_INVOICE");
    expect(err.name).toBe("InvalidSalesInvoiceError");
    expect(err.reasons).toEqual(["العميل مطلوب.", "المستودع مطلوب."]);
    expect(err.message).toBe("Invalid sales invoice: العميل مطلوب.; المستودع مطلوب.");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("SalesInvoiceNotFoundError", () => {
  it("carries the missing id", () => {
    const err = new SalesInvoiceNotFoundError("inv-99");
    expect(err.code).toBe("SALES_INVOICE_NOT_FOUND");
    expect(err.name).toBe("SalesInvoiceNotFoundError");
    expect(err.invoiceId).toBe("inv-99");
    expect(err.message).toBe('Sales invoice "inv-99" was not found.');
  });
});

describe("DuplicateSalesInvoiceError", () => {
  it("carries the duplicated id", () => {
    const err = new DuplicateSalesInvoiceError("inv-1");
    expect(err.code).toBe("DUPLICATE_SALES_INVOICE");
    expect(err.name).toBe("DuplicateSalesInvoiceError");
    expect(err.invoiceId).toBe("inv-1");
    expect(err.message).toBe('Sales invoice "inv-1" already exists.');
  });
});

describe("InvalidSalesInvoiceTransitionError", () => {
  it("renders the Arabic status labels for both ends of the illegal transition", () => {
    const err = new InvalidSalesInvoiceTransitionError("inv-1", "draft", "paid");
    expect(err.code).toBe("INVALID_SALES_INVOICE_TRANSITION");
    expect(err.name).toBe("InvalidSalesInvoiceTransitionError");
    expect(err.invoiceId).toBe("inv-1");
    expect(err.from).toBe("draft");
    expect(err.to).toBe("paid");
    expect(err.message).toBe('لا يمكن نقل الفاتورة inv-1 من "مسودة" إلى "مدفوع".');
  });

  it("renders a different pair correctly", () => {
    const err = new InvalidSalesInvoiceTransitionError("inv-2", "cancelled", "confirmed");
    expect(err.message).toBe('لا يمكن نقل الفاتورة inv-2 من "ملغي" إلى "مؤكد".');
  });
});

describe("InvalidSalesInvoicePaymentError", () => {
  it("carries the message verbatim", () => {
    const err = new InvalidSalesInvoicePaymentError("الدفعة تتجاوز الرصيد المتبقي للفاتورة.");
    expect(err.code).toBe("INVALID_SALES_INVOICE_PAYMENT");
    expect(err.name).toBe("InvalidSalesInvoicePaymentError");
    expect(err.message).toBe("الدفعة تتجاوز الرصيد المتبقي للفاتورة.");
  });
});
