/** Raised when an item code already exists (codes are unique across the catalog). */
export class DuplicateItemCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_CODE";
  constructor(readonly itemCode: string) {
    super(`Item code "${itemCode}" already exists.`);
    this.name = "DuplicateItemCodeError";
  }
}

/** Raised when an operation references an item id that does not exist. */
export class ItemNotFoundError extends Error {
  readonly code = "ITEM_NOT_FOUND";
  constructor(readonly itemId: string) {
    super(`Item "${itemId}" was not found.`);
    this.name = "ItemNotFoundError";
  }
}

/**
 * Aggregated field-validation failure — unit-of-measure conversions,
 * costing/tracking-flag mismatches, or GL account mapping refs that don't
 * resolve to a real, postable account. `reasons` lists every violation found,
 * not just the first, so a form can surface them all at once.
 */
export class InvalidItemError extends Error {
  readonly code = "INVALID_ITEM";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid item: ${reasons.join("; ")}`);
    this.name = "InvalidItemError";
  }
}
