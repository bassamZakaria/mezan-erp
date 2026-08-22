/** Raised when a price list fails shape validation (empty name, duplicate line item, negative price). */
export class InvalidPriceListError extends Error {
  readonly code = "INVALID_PRICE_LIST";
  constructor(readonly reasons: string[]) {
    super(`Invalid price list: ${reasons.join("; ")}`);
    this.name = "InvalidPriceListError";
  }
}

/** Raised when an operation references a price list id that does not exist. */
export class PriceListNotFoundError extends Error {
  readonly code = "PRICE_LIST_NOT_FOUND";
  constructor(readonly priceListId: string) {
    super(`Price list "${priceListId}" was not found.`);
    this.name = "PriceListNotFoundError";
  }
}

/** Raised when a price list code already exists (codes are unique across price lists). */
export class DuplicatePriceListError extends Error {
  readonly code = "DUPLICATE_PRICE_LIST_CODE";
  constructor(readonly priceListCode: string) {
    super(`Price list code "${priceListCode}" already exists.`);
    this.name = "DuplicatePriceListError";
  }
}
