import { describe, it, expect } from "vitest";
import {
  InvalidSalesQuoteError,
  SalesQuoteNotFoundError,
  DuplicateSalesQuoteError,
  InvalidSalesQuoteTransitionError,
} from "./errors.js";

describe("InvalidSalesQuoteError", () => {
  it("carries its reasons and joins them into the message", () => {
    const err = new InvalidSalesQuoteError(["العميل مطلوب.", "الفرع مطلوب."]);
    expect(err.code).toBe("INVALID_SALES_QUOTE");
    expect(err.name).toBe("InvalidSalesQuoteError");
    expect(err.reasons).toEqual(["العميل مطلوب.", "الفرع مطلوب."]);
    expect(err.message).toBe("عرض السعر غير صالح: العميل مطلوب.، الفرع مطلوب.");
    expect(err.messageEn).toBe("Invalid sales quote: العميل مطلوب.; الفرع مطلوب.");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("SalesQuoteNotFoundError", () => {
  it("carries the missing id", () => {
    const err = new SalesQuoteNotFoundError("qt-99");
    expect(err.code).toBe("SALES_QUOTE_NOT_FOUND");
    expect(err.name).toBe("SalesQuoteNotFoundError");
    expect(err.quoteId).toBe("qt-99");
    expect(err.message).toBe('عرض السعر "qt-99" غير موجود.');
    expect(err.messageEn).toBe('Sales quote "qt-99" was not found.');
  });
});

describe("DuplicateSalesQuoteError", () => {
  it("carries the duplicated id", () => {
    const err = new DuplicateSalesQuoteError("qt-1");
    expect(err.code).toBe("DUPLICATE_SALES_QUOTE");
    expect(err.name).toBe("DuplicateSalesQuoteError");
    expect(err.quoteId).toBe("qt-1");
    expect(err.message).toBe('عرض السعر "qt-1" موجود بالفعل.');
    expect(err.messageEn).toBe('Sales quote "qt-1" already exists.');
  });
});

describe("InvalidSalesQuoteTransitionError", () => {
  it("renders the Arabic status labels for both ends of the illegal transition", () => {
    const err = new InvalidSalesQuoteTransitionError("qt-1", "draft", "accepted");
    expect(err.code).toBe("INVALID_SALES_QUOTE_TRANSITION");
    expect(err.name).toBe("InvalidSalesQuoteTransitionError");
    expect(err.quoteId).toBe("qt-1");
    expect(err.from).toBe("draft");
    expect(err.to).toBe("accepted");
    expect(err.message).toBe('لا يمكن نقل عرض السعر qt-1 من "مسودة" إلى "مقبول".');
  });

  it("renders a different pair correctly", () => {
    const err = new InvalidSalesQuoteTransitionError("qt-2", "converted", "cancelled");
    expect(err.message).toBe('لا يمكن نقل عرض السعر qt-2 من "محول" إلى "ملغي".');
  });
});
