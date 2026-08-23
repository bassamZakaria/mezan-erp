/** Errors raised by the stock-ledger / costing engine (docs/catalog/03). */

import { Qty } from "../money/index.js";

/**
 * Raised when an issue/transfer/OUT adjustment would drive on-hand stock below
 * zero and the tenant's `allowNegativeStock` policy is off (docs/catalog/09
 * §"سياسة المخزون"). Carries the numbers so the API can surface them.
 */
export class NegativeStockError extends Error {
  readonly code = "NEGATIVE_STOCK";
  constructor(
    readonly itemId: string,
    readonly warehouseId: string,
    readonly onHand: Qty,
    readonly requested: Qty,
  ) {
    super(
      `Issuing ${requested.toString()} of item "${itemId}" from warehouse "${warehouseId}" ` +
        `would drive on-hand (${onHand.toString()}) below zero; negative stock is disallowed.`,
    );
    this.name = "NegativeStockError";
  }
}

/** Raised when a movement/adjustment/transfer command fails structural validation. */
export class InvalidStockMovementError extends Error {
  readonly code = "INVALID_STOCK_MOVEMENT";
  constructor(reasons: readonly string[]) {
    super(`Invalid stock movement: ${reasons.join("; ")}`);
    this.name = "InvalidStockMovementError";
  }
}

/** Raised when a transfer names the same warehouse as source and destination. */
export class SameWarehouseTransferError extends Error {
  readonly code = "SAME_WAREHOUSE_TRANSFER";
  constructor(readonly warehouseId: string) {
    super(`A transfer's source and destination warehouse must differ ("${warehouseId}").`);
    this.name = "SameWarehouseTransferError";
  }
}

/** Raised when an operation references a write-down run id that does not exist. */
export class WritedownRunNotFoundError extends Error {
  readonly code = "WRITEDOWN_RUN_NOT_FOUND";
  constructor(readonly runId: string) {
    super(`Write-down run "${runId}" was not found.`);
    this.name = "WritedownRunNotFoundError";
  }
}

/** Raised when trying to post a write-down run that is not in the draft state. */
export class WritedownRunNotDraftError extends Error {
  readonly code = "WRITEDOWN_RUN_NOT_DRAFT";
  constructor(
    readonly runId: string,
    readonly status: string,
  ) {
    super(`Write-down run "${runId}" is "${status}", not a draft, and cannot be posted.`);
    this.name = "WritedownRunNotDraftError";
  }
}

/** Raised when a write-down run already exists for a given period + warehouse scope (and isn't cancelled). */
export class DuplicateWritedownPeriodError extends Error {
  readonly code = "DUPLICATE_WRITEDOWN_PERIOD";
  constructor(
    readonly period: string,
    readonly warehouseId: string | null,
  ) {
    super(
      `A write-down run for period "${period}"${warehouseId ? ` / warehouse "${warehouseId}"` : ""} already exists.`,
    );
    this.name = "DuplicateWritedownPeriodError";
  }
}

/** Raised when a new write-down run would contain zero lines (no position meets the aging policy's slow-moving threshold). */
export class NoSlowMovingStockError extends Error {
  readonly code = "NO_SLOW_MOVING_STOCK";
  constructor(readonly period: string) {
    super(`No slow-moving stock positions were found for period "${period}".`);
    this.name = "NoSlowMovingStockError";
  }
}

/** Raised when a product-template code already exists (codes are unique across templates). */
export class DuplicateProductTemplateCodeError extends Error {
  readonly code = "DUPLICATE_PRODUCT_TEMPLATE_CODE";
  constructor(readonly templateCode: string) {
    super(`Product template code "${templateCode}" already exists.`);
    this.name = "DuplicateProductTemplateCodeError";
  }
}

/** Raised when a new/updated product template fails validation. */
export class InvalidProductTemplateError extends Error {
  readonly code = "INVALID_PRODUCT_TEMPLATE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidProductTemplateError";
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

/** Raised when an operation references an attribute id that does not exist on the template. */
export class AttributeNotFoundError extends Error {
  readonly code = "ATTRIBUTE_NOT_FOUND";
  constructor(
    readonly templateId: string,
    readonly attributeId: string,
  ) {
    super(`Attribute "${attributeId}" was not found on product template "${templateId}".`);
    this.name = "AttributeNotFoundError";
  }
}

/** Raised when adding an attribute whose name already exists on the template. */
export class DuplicateAttributeNameError extends Error {
  readonly code = "DUPLICATE_ATTRIBUTE_NAME";
  constructor(readonly nameAr: string) {
    super(`Attribute "${nameAr}" already exists on this template.`);
    this.name = "DuplicateAttributeNameError";
  }
}

/** Raised when adding a value that already exists on the attribute. */
export class DuplicateAttributeValueError extends Error {
  readonly code = "DUPLICATE_ATTRIBUTE_VALUE";
  constructor(readonly value: string) {
    super(`Value "${value}" already exists on this attribute.`);
    this.name = "DuplicateAttributeValueError";
  }
}

/** Raised when trying to delete an attribute that at least one generated variant still uses (docs/catalog/03: "احذف المتغيرات أولاً"). */
export class AttributeInUseError extends Error {
  readonly code = "ATTRIBUTE_IN_USE";
  constructor(
    readonly attributeId: string,
    readonly variantCount: number,
  ) {
    super(`Attribute "${attributeId}" is used by ${variantCount} generated variant(s) — delete the variants first.`);
    this.name = "AttributeInUseError";
  }
}

/** Raised when trying to delete an attribute value that at least one generated variant still uses. */
export class AttributeValueInUseError extends Error {
  readonly code = "ATTRIBUTE_VALUE_IN_USE";
  constructor(
    readonly attributeId: string,
    readonly value: string,
    readonly variantCount: number,
  ) {
    super(`Value "${value}" is used by ${variantCount} generated variant(s) — delete the variants first.`);
    this.name = "AttributeValueInUseError";
  }
}

/** Raised when generating variants for a template with no attributes defined. */
export class NoAttributesDefinedError extends Error {
  readonly code = "NO_ATTRIBUTES_DEFINED";
  constructor(readonly templateId: string) {
    super(`Product template "${templateId}" has no attributes defined.`);
    this.name = "NoAttributesDefinedError";
  }
}

/** Raised when a generate-variants request selects zero combinations. */
export class EmptyVariantSelectionError extends Error {
  readonly code = "EMPTY_VARIANT_SELECTION";
  constructor(readonly templateId: string) {
    super(`No variant combinations were selected for product template "${templateId}".`);
    this.name = "EmptyVariantSelectionError";
  }
}

/** Raised when a variant selection's values don't name exactly the template's attributes (missing/extra/unknown attribute id, or an unknown value). */
export class InvalidVariantSelectionError extends Error {
  readonly code = "INVALID_VARIANT_SELECTION";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidVariantSelectionError";
  }
}
