/**
 * Messages here reach the UI verbatim: the api serves `message: err.message`
 * and screens render it directly, so every message must be Arabic.
 */
/** Raised when a price list fails shape validation (empty name, duplicate line item, negative price). */
export class InvalidPriceListError extends Error {
  readonly code = "INVALID_PRICE_LIST";
  constructor(readonly reasons: string[]) {
    super(`قائمة أسعار غير صالحة: ${reasons.join("؛ ")}`);
    this.name = "InvalidPriceListError";
  }
}

/** Raised when an operation references a price list id that does not exist. */
export class PriceListNotFoundError extends Error {
  readonly code = "PRICE_LIST_NOT_FOUND";
  constructor(readonly priceListId: string) {
    super(`تعذّر العثور على قائمة الأسعار "${priceListId}".`);
    this.name = "PriceListNotFoundError";
  }
}

/** Raised when a price list code already exists (codes are unique across price lists). */
export class DuplicatePriceListError extends Error {
  readonly code = "DUPLICATE_PRICE_LIST_CODE";
  constructor(readonly priceListCode: string) {
    super(`كود قائمة الأسعار "${priceListCode}" مستخدم بالفعل — اختر كوداً آخر.`);
    this.name = "DuplicatePriceListError";
  }
}
