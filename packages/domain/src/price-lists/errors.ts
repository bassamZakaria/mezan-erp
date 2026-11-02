/**
 * Messages here reach the UI verbatim: the api serves `message: err.message`
 * and screens render it directly, so every message must be Arabic.
 */
import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
/** Raised when a price list fails shape validation (empty name, duplicate line item, negative price). */
export class InvalidPriceListError extends Error {
  readonly code = "INVALID_PRICE_LIST";
  readonly reasons: string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the details are not valid");
    super(`قائمة أسعار غير صالحة: ${split.ar.join("؛ ")}`);
    this.reasons = [...split.ar];
    this.messageEn = `Invalid price list: ${split.en}`;
    this.name = "InvalidPriceListError";
  }
}

/** Raised when an operation references a price list id that does not exist. */
export class PriceListNotFoundError extends Error {
  readonly code = "PRICE_LIST_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly priceListId: string) {
    super(`تعذّر العثور على قائمة الأسعار "${priceListId}".`);
    this.messageEn = `Price list "${priceListId}" was not found.`;
    this.name = "PriceListNotFoundError";
  }
}

/** Raised when a price list code already exists (codes are unique across price lists). */
export class DuplicatePriceListError extends Error {
  readonly code = "DUPLICATE_PRICE_LIST_CODE";
  readonly messageEn: string;
  constructor(readonly priceListCode: string) {
    super(`كود قائمة الأسعار "${priceListCode}" مستخدم بالفعل — اختر كوداً آخر.`);
    this.messageEn = `Price list code "${priceListCode}" is already in use — choose another code.`;
    this.name = "DuplicatePriceListError";
  }
}
