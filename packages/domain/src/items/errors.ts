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

/** Raised when a unit-of-measure code already exists (codes are unique across the catalog). */
export class DuplicateItemUnitCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_UNIT_CODE";
  constructor(readonly unitCode: string) {
    super(`Item unit code "${unitCode}" already exists.`);
    this.name = "DuplicateItemUnitCodeError";
  }
}

/** Raised when an operation references a unit-of-measure id that does not exist. */
export class ItemUnitNotFoundError extends Error {
  readonly code = "ITEM_UNIT_NOT_FOUND";
  constructor(readonly unitId: string) {
    super(`Item unit "${unitId}" was not found.`);
    this.name = "ItemUnitNotFoundError";
  }
}

/** Aggregated field-validation failure for a unit of measure. */
export class InvalidItemUnitError extends Error {
  readonly code = "INVALID_ITEM_UNIT";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid item unit: ${reasons.join("; ")}`);
    this.name = "InvalidItemUnitError";
  }
}

/** Raised when deleting a unit that items or other units still reference. */
export class ItemUnitInUseError extends Error {
  readonly code = "ITEM_UNIT_IN_USE";
  constructor(
    readonly unitCode: string,
    readonly referenceCount: number,
  ) {
    super(`Item unit "${unitCode}" is still referenced by ${referenceCount} record(s).`);
    this.name = "ItemUnitInUseError";
  }
}

/** Raised when an item-category code already exists (codes are unique across the catalog). */
export class DuplicateItemCategoryCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_CATEGORY_CODE";
  constructor(readonly categoryCode: string) {
    super(`Item category code "${categoryCode}" already exists.`);
    this.name = "DuplicateItemCategoryCodeError";
  }
}

/** Raised when an operation references an item-category id that does not exist. */
export class ItemCategoryNotFoundError extends Error {
  readonly code = "ITEM_CATEGORY_NOT_FOUND";
  constructor(readonly categoryId: string) {
    super(`Item category "${categoryId}" was not found.`);
    this.name = "ItemCategoryNotFoundError";
  }
}

/** Aggregated field-validation failure for an item category. */
export class InvalidItemCategoryError extends Error {
  readonly code = "INVALID_ITEM_CATEGORY";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid item category: ${reasons.join("; ")}`);
    this.name = "InvalidItemCategoryError";
  }
}

/** Raised when deleting a category that items or child categories still reference. */
export class ItemCategoryInUseError extends Error {
  readonly code = "ITEM_CATEGORY_IN_USE";
  constructor(
    readonly categoryCode: string,
    readonly referenceCount: number,
  ) {
    super(`Item category "${categoryCode}" is still referenced by ${referenceCount} record(s).`);
    this.name = "ItemCategoryInUseError";
  }
}

/** Raised when a specification code already exists (codes are unique across the registry). */
export class DuplicateItemSpecificationCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_SPECIFICATION_CODE";
  constructor(readonly specificationCode: string) {
    super(`Item specification code "${specificationCode}" already exists.`);
    this.name = "DuplicateItemSpecificationCodeError";
  }
}

/** Raised when an operation references a specification code that does not exist. */
export class ItemSpecificationNotFoundError extends Error {
  readonly code = "ITEM_SPECIFICATION_NOT_FOUND";
  constructor(readonly specificationCode: string) {
    super(`Item specification "${specificationCode}" was not found.`);
    this.name = "ItemSpecificationNotFoundError";
  }
}

/** Aggregated field-validation failure for a specification. */
export class InvalidItemSpecificationError extends Error {
  readonly code = "INVALID_ITEM_SPECIFICATION";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid item specification: ${reasons.join("; ")}`);
    this.name = "InvalidItemSpecificationError";
  }
}

/** Raised when deleting a specification that product templates still bind to. */
export class ItemSpecificationInUseError extends Error {
  readonly code = "ITEM_SPECIFICATION_IN_USE";
  constructor(
    readonly specificationCode: string,
    readonly referenceCount: number,
  ) {
    super(`Item specification "${specificationCode}" is still referenced by ${referenceCount} record(s).`);
    this.name = "ItemSpecificationInUseError";
  }
}
