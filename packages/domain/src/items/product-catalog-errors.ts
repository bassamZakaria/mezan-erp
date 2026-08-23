/** Raised when a specification code already exists (codes are unique across the registry). */
export class DuplicateItemSpecificationCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_SPECIFICATION_CODE";
  constructor(readonly specificationCode: string) {
    super(`Item specification code "${specificationCode}" already exists.`);
    this.name = "DuplicateItemSpecificationCodeError";
  }
}

/** Raised when an operation references a specification id that does not exist. */
export class ItemSpecificationNotFoundError extends Error {
  readonly code = "ITEM_SPECIFICATION_NOT_FOUND";
  constructor(readonly specificationId: string) {
    super(`Item specification "${specificationId}" was not found.`);
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

/** Raised when deleting a specification that product templates still reference. */
export class ItemSpecificationInUseError extends Error {
  readonly code = "ITEM_SPECIFICATION_IN_USE";
  constructor(
    readonly specificationCode: string,
    readonly referenceCount: number,
  ) {
    super(`Item specification "${specificationCode}" is used by ${referenceCount} product template(s).`);
    this.name = "ItemSpecificationInUseError";
  }
}

/** Raised when a product-template code already exists (codes are unique and seed every SKU). */
export class DuplicateProductTemplateCodeError extends Error {
  readonly code = "DUPLICATE_PRODUCT_TEMPLATE_CODE";
  constructor(readonly templateCode: string) {
    super(`Product template code "${templateCode}" already exists.`);
    this.name = "DuplicateProductTemplateCodeError";
  }
}

/** Raised when an operation references a product-template id that does not exist. */
export class ProductTemplateNotFoundError extends Error {
  readonly code = "PRODUCT_TEMPLATE_NOT_FOUND";
  constructor(readonly templateId: string) {
    super(`Product template "${templateId}" was not found.`);
    this.name = "ProductTemplateNotFoundError";
  }
}

/** Aggregated field-validation failure for a product template. */
export class InvalidProductTemplateError extends Error {
  readonly code = "INVALID_PRODUCT_TEMPLATE";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid product template: ${reasons.join("; ")}`);
    this.name = "InvalidProductTemplateError";
  }
}

/**
 * Raised when an operation that only a draft template allows (re-generating,
 * changing the option matrix, deleting) is attempted after generation — the
 * variants are real catalog items by then.
 */
export class ProductTemplateAlreadyGeneratedError extends Error {
  readonly code = "PRODUCT_TEMPLATE_ALREADY_GENERATED";
  constructor(
    readonly templateCode: string,
    readonly variantCount: number,
  ) {
    super(`Product template "${templateCode}" already generated ${variantCount} variant(s).`);
    this.name = "ProductTemplateAlreadyGeneratedError";
  }
}

/** Raised when an operation references a variant SKU the template did not generate. */
export class ProductTemplateVariantNotFoundError extends Error {
  readonly code = "PRODUCT_TEMPLATE_VARIANT_NOT_FOUND";
  constructor(
    readonly templateId: string,
    readonly sku: string,
  ) {
    super(`Product template "${templateId}" has no variant "${sku}".`);
    this.name = "ProductTemplateVariantNotFoundError";
  }
}
