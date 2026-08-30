import { describe, it, expect } from "vitest";
import { InvalidPriceListError, PriceListNotFoundError, DuplicatePriceListError } from "./errors.js";

describe("InvalidPriceListError", () => {
  it("carries its reasons and joins them into the Arabic message", () => {
    const err = new InvalidPriceListError(["اسم قائمة الأسعار مطلوب.", "سعر السطر لا يمكن أن يكون سالباً."]);
    expect(err.code).toBe("INVALID_PRICE_LIST");
    expect(err.name).toBe("InvalidPriceListError");
    expect(err.reasons).toEqual(["اسم قائمة الأسعار مطلوب.", "سعر السطر لا يمكن أن يكون سالباً."]);
    expect(err.message).toBe(
      "قائمة أسعار غير صالحة: اسم قائمة الأسعار مطلوب.؛ سعر السطر لا يمكن أن يكون سالباً.",
    );
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PriceListNotFoundError", () => {
  it("carries the missing id and the Arabic message", () => {
    const err = new PriceListNotFoundError("pl-99");
    expect(err.code).toBe("PRICE_LIST_NOT_FOUND");
    expect(err.name).toBe("PriceListNotFoundError");
    expect(err.priceListId).toBe("pl-99");
    expect(err.message).toBe('تعذّر العثور على قائمة الأسعار "pl-99".');
  });
});

describe("DuplicatePriceListError", () => {
  it("carries the duplicated code and the Arabic message", () => {
    const err = new DuplicatePriceListError("WHOLESALE");
    expect(err.code).toBe("DUPLICATE_PRICE_LIST_CODE");
    expect(err.name).toBe("DuplicatePriceListError");
    expect(err.priceListCode).toBe("WHOLESALE");
    expect(err.message).toBe('كود قائمة الأسعار "WHOLESALE" مستخدم بالفعل — اختر كوداً آخر.');
  });
});
