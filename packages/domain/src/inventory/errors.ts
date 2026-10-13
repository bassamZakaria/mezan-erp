/**
 * Messages here reach the UI verbatim: the api serves `message: err.message`
 * and screens render it directly, so every message must be Arabic.
 */
/** Errors raised by the stock-ledger / costing engine (docs/archive/catalog/03). */

import { Qty } from "../money/index.js";

/**
 * Raised when an issue/transfer/OUT adjustment would drive on-hand stock below
 * zero and the tenant's `allowNegativeStock` policy is off (docs/archive/catalog/09
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
      `صرف ${requested.toString()} من الصنف "${itemId}" من المستودع "${warehouseId}" ` +
        `سيجعل الرصيد المتاح (${onHand.toString()}) سالباً، والرصيد السالب غير مسموح به.`,
    );
    this.name = "NegativeStockError";
  }
}

/**
 * Raised when an issue would drive a position negative and there is NO
 * defensible cost to write it at — the position holds nothing, the item was
 * never received anywhere, and no fallback cost is configured.
 *
 * The alternative was writing the movement at zero, which understated COGS by
 * the whole deficit and said nothing on any screen (D101). A refusal at least
 * says which item has no cost basis.
 */
export class UncostedDeficitIssueError extends Error {
  readonly code = "UNCOSTED_DEFICIT_ISSUE";
  constructor(
    readonly itemId: string,
    readonly warehouseId: string,
    readonly requested: Qty,
  ) {
    super(
      `صرف ${requested.toString()} من الصنف "${itemId}" من المستودع "${warehouseId}" ` +
        `يتجاوز الرصيد المتاح، ولا توجد تكلفة معروفة لهذا الصنف تُسعَّر بها الكمية الناقصة.`,
    );
    this.name = "UncostedDeficitIssueError";
  }
}

/**
 * Raised when an issue would draw on stock that has already expired.
 *
 * Only issues are blocked. Writing expired goods OFF — an adjustment with the
 * EXPIRY reason, or a return to the supplier — must stay possible, and that is
 * the whole point of catching it here rather than at the ledger.
 */
export class ExpiredStockError extends Error {
  readonly code = "EXPIRED_STOCK";
  constructor(
    readonly itemId: string,
    readonly warehouseId: string,
    readonly batchNo: string | null,
    readonly expiryDate: string,
  ) {
    super(
      `الصنف "${itemId}" في المستودع "${warehouseId}" له رصيد منتهي الصلاحية` +
        `${batchNo ? ` (التشغيلة "${batchNo}")` : ""} بتاريخ ${expiryDate}، فلا يمكن صرفه. ` +
        `استخدم تسوية مخزون بسبب "انتهاء الصلاحية" أو مرتجع مورد.`,
    );
    this.name = "ExpiredStockError";
  }
}

/** Raised when a movement/adjustment/transfer command fails structural validation. */
export class InvalidStockMovementError extends Error {
  readonly code = "INVALID_STOCK_MOVEMENT";
  constructor(reasons: readonly string[]) {
    super(`حركة مخزون غير صالحة: ${reasons.join("؛ ")}`);
    this.name = "InvalidStockMovementError";
  }
}

/** Raised when a transfer names the same warehouse as source and destination. */
export class SameWarehouseTransferError extends Error {
  readonly code = "SAME_WAREHOUSE_TRANSFER";
  constructor(readonly warehouseId: string) {
    super(`لا يمكن أن يكون مستودع المصدر هو نفس مستودع الوجهة ("${warehouseId}").`);
    this.name = "SameWarehouseTransferError";
  }
}

/** Raised when an operation references a write-down run id that does not exist. */
export class WritedownRunNotFoundError extends Error {
  readonly code = "WRITEDOWN_RUN_NOT_FOUND";
  constructor(readonly runId: string) {
    super(`تعذّر العثور على دفعة إهلاك المخزون "${runId}".`);
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
    super(`دفعة إهلاك المخزون "${runId}" حالتها "${status}" وليست مسودة، فلا يمكن ترحيلها.`);
    this.name = "WritedownRunNotDraftError";
  }
}

export class WritedownRunNotPostedError extends Error {
  readonly code = "WRITEDOWN_RUN_NOT_POSTED";
  readonly messageEn: string;
  constructor(
    readonly runId: string,
    readonly status: string,
  ) {
    super(`دفعة مخصص هبوط المخزون "${runId}" حالتها "${status}" وليست مُرحَّلة، فلا يمكن عكسها.`);
    this.messageEn = `Inventory write-down run "${runId}" is "${status}", not posted, so it cannot be reversed.`;
    this.name = "WritedownRunNotPostedError";
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
      `توجد بالفعل دفعة إهلاك مخزون للفترة "${period}"${warehouseId ? ` وللمستودع "${warehouseId}"` : ""}.`,
    );
    this.name = "DuplicateWritedownPeriodError";
  }
}

/** Raised when a new write-down run would contain zero lines (no position meets the aging policy's slow-moving threshold). */
export class NoSlowMovingStockError extends Error {
  readonly code = "NO_SLOW_MOVING_STOCK";
  constructor(readonly period: string) {
    super(`لا توجد أرصدة راكدة تنطبق عليها سياسة الإهلاك في الفترة "${period}".`);
    this.name = "NoSlowMovingStockError";
  }
}

/** Raised when a product-template code already exists (codes are unique across templates). */
export class DuplicateProductTemplateCodeError extends Error {
  readonly code = "DUPLICATE_PRODUCT_TEMPLATE_CODE";
  constructor(readonly templateCode: string) {
    super(`كود قالب المنتج "${templateCode}" مستخدم بالفعل — اختر كوداً آخر.`);
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
    super(`تعذّر العثور على قالب المنتج "${templateId}".`);
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
    super(`الخاصية "${attributeId}" غير موجودة في قالب المنتج "${templateId}".`);
    this.name = "AttributeNotFoundError";
  }
}

/** Raised when adding an attribute whose name already exists on the template. */
export class DuplicateAttributeNameError extends Error {
  readonly code = "DUPLICATE_ATTRIBUTE_NAME";
  constructor(readonly nameAr: string) {
    super(`الخاصية "${nameAr}" موجودة بالفعل في هذا القالب.`);
    this.name = "DuplicateAttributeNameError";
  }
}

/** Raised when adding a value that already exists on the attribute. */
export class DuplicateAttributeValueError extends Error {
  readonly code = "DUPLICATE_ATTRIBUTE_VALUE";
  constructor(readonly value: string) {
    super(`القيمة "${value}" موجودة بالفعل في هذه الخاصية.`);
    this.name = "DuplicateAttributeValueError";
  }
}

/** Raised when trying to delete an attribute that at least one generated variant still uses (docs/archive/catalog/03: "احذف المتغيرات أولاً"). */
export class AttributeInUseError extends Error {
  readonly code = "ATTRIBUTE_IN_USE";
  constructor(
    readonly attributeId: string,
    readonly variantCount: number,
  ) {
    super(`الخاصية "${attributeId}" مستخدمة في متغيرات مولّدة عددها ${variantCount} — احذف المتغيرات أولاً.`);
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
    super(`القيمة "${value}" مستخدمة في متغيرات مولّدة عددها ${variantCount} — احذف المتغيرات أولاً.`);
    this.name = "AttributeValueInUseError";
  }
}

/** Raised when generating variants for a template with no attributes defined. */
export class NoAttributesDefinedError extends Error {
  readonly code = "NO_ATTRIBUTES_DEFINED";
  constructor(readonly templateId: string) {
    super(`قالب المنتج "${templateId}" لا يحتوي على أي خصائص معرّفة.`);
    this.name = "NoAttributesDefinedError";
  }
}

/** Raised when a generate-variants request selects zero combinations. */
export class EmptyVariantSelectionError extends Error {
  readonly code = "EMPTY_VARIANT_SELECTION";
  constructor(readonly templateId: string) {
    super(`لم يتم اختيار أي تركيبة متغيرات لقالب المنتج "${templateId}".`);
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

export class StockAdjustmentNotFoundError extends Error {
  readonly code = "STOCK_ADJUSTMENT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly adjustmentId: string) {
    super(`تسوية المخزون "${adjustmentId}" غير موجودة.`);
    this.messageEn = `Stock adjustment "${adjustmentId}" was not found.`;
    this.name = "StockAdjustmentNotFoundError";
  }
}

export class StockAdjustmentAlreadyReversedError extends Error {
  readonly code = "STOCK_ADJUSTMENT_ALREADY_REVERSED";
  readonly messageEn: string;
  constructor(readonly adjustmentId: string) {
    super(`تسوية المخزون "${adjustmentId}" سبق عكسها.`);
    this.messageEn = `Stock adjustment "${adjustmentId}" has already been reversed.`;
    this.name = "StockAdjustmentAlreadyReversedError";
  }
}
