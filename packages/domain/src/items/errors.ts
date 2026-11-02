import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

/** Raised when an item code already exists (codes are unique across the catalog). */
export class DuplicateItemCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_CODE";
  readonly messageEn: string;
  constructor(readonly itemCode: string) {
    super(`كود الصنف «${itemCode}» مستخدم بالفعل.`);
    this.messageEn = `Item code "${itemCode}" is already in use.`;
    this.name = "DuplicateItemCodeError";
  }
}

/** Raised when an operation references an item id that does not exist. */
export class ItemNotFoundError extends Error {
  readonly code = "ITEM_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly itemId: string) {
    super(`الصنف "${itemId}" غير موجود.`);
    this.messageEn = `Item "${itemId}" was not found.`;
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
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`بيانات الصنف غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid item: ${split.en}`;
    this.name = "InvalidItemError";
  }
}

/**
 * Raised when a unit-of-measure code already exists (codes are unique across
 * the catalog). Currently unreachable in production: `createItemUnit` in
 * `item-catalog.ts` throws its own, separately-defined `DuplicateItemUnitCodeError`.
 */
export class DuplicateItemUnitCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_UNIT_CODE";
  readonly messageEn: string;
  constructor(readonly unitCode: string) {
    super(`كود وحدة الصنف "${unitCode}" مستخدم من قبل.`);
    this.messageEn = `Item unit code "${unitCode}" already exists.`;
    this.name = "DuplicateItemUnitCodeError";
  }
}

/**
 * Raised when an operation references a unit-of-measure id that does not
 * exist. Currently unreachable in production: `updateItemUnit` in
 * `item-catalog.ts` throws its own, separately-defined `ItemUnitNotFoundError`.
 */
export class ItemUnitNotFoundError extends Error {
  readonly code = "ITEM_UNIT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly unitId: string) {
    super(`وحدة الصنف "${unitId}" غير موجودة.`);
    this.messageEn = `Item unit "${unitId}" was not found.`;
    this.name = "ItemUnitNotFoundError";
  }
}

/** Aggregated field-validation failure for a unit of measure. Currently unreachable in production — no call site constructs it. */
export class InvalidItemUnitError extends Error {
  readonly code = "INVALID_ITEM_UNIT";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`بيانات وحدة الصنف غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid item unit: ${split.en}`;
    this.name = "InvalidItemUnitError";
  }
}

/** Raised when deleting a unit that items or other units still reference. Currently unreachable in production — no call site constructs it. */
export class ItemUnitInUseError extends Error {
  readonly code = "ITEM_UNIT_IN_USE";
  readonly messageEn: string;
  constructor(
    readonly unitCode: string,
    readonly referenceCount: number,
  ) {
    super(`وحدة الصنف "${unitCode}" لا تزال مرتبطة بـ ${referenceCount} سجل؛ لا يمكن حذفها.`);
    this.messageEn = `Item unit "${unitCode}" is still referenced by ${referenceCount} record(s).`;
    this.name = "ItemUnitInUseError";
  }
}

/**
 * Raised when an operation references an item-category id that does not
 * exist. Currently unreachable in production: `item-catalog.ts` throws its
 * own, separately-defined `ItemCategoryNotFoundError`.
 */
export class ItemCategoryNotFoundError extends Error {
  readonly code = "ITEM_CATEGORY_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly categoryId: string) {
    super(`فئة الصنف "${categoryId}" غير موجودة.`);
    this.messageEn = `Item category "${categoryId}" was not found.`;
    this.name = "ItemCategoryNotFoundError";
  }
}

/**
 * Aggregated field-validation failure for an item category. Currently
 * unreachable in production: `item-catalog.ts` throws its own,
 * separately-defined `InvalidItemCategoryError` (single `message`, not `reasons`).
 */
export class InvalidItemCategoryError extends Error {
  readonly code = "INVALID_ITEM_CATEGORY";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`بيانات فئة الصنف غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid item category: ${split.en}`;
    this.name = "InvalidItemCategoryError";
  }
}

/** Raised when deleting a category that items or child categories still reference. Currently unreachable in production — no call site constructs it. */
export class ItemCategoryInUseError extends Error {
  readonly code = "ITEM_CATEGORY_IN_USE";
  readonly messageEn: string;
  constructor(
    readonly categoryCode: string,
    readonly referenceCount: number,
  ) {
    super(`فئة الصنف "${categoryCode}" لا تزال مرتبطة بـ ${referenceCount} سجل؛ لا يمكن حذفها.`);
    this.messageEn = `Item category "${categoryCode}" is still referenced by ${referenceCount} record(s).`;
    this.name = "ItemCategoryInUseError";
  }
}

/** Raised when a specification code already exists (codes are unique across the registry). */
export class DuplicateItemSpecificationCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_SPECIFICATION_CODE";
  readonly messageEn: string;
  constructor(readonly specificationCode: string) {
    super(`كود مواصفة الصنف "${specificationCode}" مستخدم من قبل.`);
    this.messageEn = `Item specification code "${specificationCode}" already exists.`;
    this.name = "DuplicateItemSpecificationCodeError";
  }
}

/** Raised when an operation references a specification code that does not exist. */
export class ItemSpecificationNotFoundError extends Error {
  readonly code = "ITEM_SPECIFICATION_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly specificationCode: string) {
    super(`مواصفة الصنف "${specificationCode}" غير موجودة.`);
    this.messageEn = `Item specification "${specificationCode}" was not found.`;
    this.name = "ItemSpecificationNotFoundError";
  }
}

/** Aggregated field-validation failure for a specification. */
export class InvalidItemSpecificationError extends Error {
  readonly code = "INVALID_ITEM_SPECIFICATION";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`بيانات مواصفة الصنف غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid item specification: ${split.en}`;
    this.name = "InvalidItemSpecificationError";
  }
}

/** Raised when deleting a specification that product templates still bind to. */
export class ItemSpecificationInUseError extends Error {
  readonly code = "ITEM_SPECIFICATION_IN_USE";
  readonly messageEn: string;
  constructor(
    readonly specificationCode: string,
    readonly referenceCount: number,
  ) {
    super(`مواصفة الصنف "${specificationCode}" لا تزال مرتبطة بـ ${referenceCount} سجل؛ لا يمكن حذفها.`);
    this.messageEn = `Item specification "${specificationCode}" is still referenced by ${referenceCount} record(s).`;
    this.name = "ItemSpecificationInUseError";
  }
}

export class ItemPriceRequiredError extends Error {
  readonly code = "ITEM_PRICE_REQUIRED";
  readonly messageEn: string;
  constructor(readonly itemId: string) {
    super("الصنف بانتظار التسعير: حدّد سعر البيع أولاً، ولا يُفعَّل الصنف قبل تسعيره.");
    this.messageEn = "This item is waiting to be priced: set its sale price first.";
    this.name = "ItemPriceRequiredError";
  }
}

export class ItemStatusNotSettableError extends Error {
  readonly code = "ITEM_STATUS_NOT_SETTABLE";
  readonly messageEn: string;
  constructor(readonly itemId: string) {
    super("حالة «بانتظار التسعير» يحددها النظام عند إنشاء الصنف من فرع، ولا يمكن إعادة صنف مُسعَّر إليها.");
    this.messageEn = "“Waiting to be priced” is set by the system when a branch creates an item; a priced item cannot be put back into it.";
    this.name = "ItemStatusNotSettableError";
  }
}

export class ItemPendingPricingError extends Error {
  readonly code = "ITEM_PENDING_PRICING";
  readonly messageEn = "An item waiting to be priced cannot be sold or put on a price list or promotion. It can be bought, received, transferred and counted; it sells once head office prices it.";
  constructor(readonly itemIds: readonly string[]) {
    super("لا يمكن بيع صنف بانتظار التسعير ولا إدراجه في قائمة أسعار أو عرض. يمكن شراؤه واستلامه وتحويله وجرده، ويُتاح للبيع بعد أن تسعّره الإدارة.");
    this.name = "ItemPendingPricingError";
  }
}
