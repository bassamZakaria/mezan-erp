/**
 * Fixed-assets domain errors (Asset Register, Asset Categories, Depreciation Runs). Stable `code`s so the api/UI can branch.
 * `message` is Arabic because the client shows it verbatim (D280); `messageEn` carries the English.
 */

const RUN_STATUS_AR: Readonly<Record<string, string>> = {
  draft: "مسودة",
  posted: "مُرحَّل",
  reversed: "معكوس",
  cancelled: "ملغى",
};

function runStatusAr(status: string): string {
  return RUN_STATUS_AR[status] ?? status;
}

/** Raised when an asset-category code already exists (codes are unique across categories). */
export class DuplicateAssetCategoryCodeError extends Error {
  readonly code = "DUPLICATE_ASSET_CATEGORY_CODE";
  readonly messageEn: string;
  constructor(readonly categoryCode: string) {
    super(`كود فئة الأصول "${categoryCode}" مستخدم من قبل.`);
    this.messageEn = `Asset category code "${categoryCode}" already exists.`;
    this.name = "DuplicateAssetCategoryCodeError";
  }
}

/** Raised when a new/updated asset category fails validation (e.g. salvage % out of range, useful life <= 0). */
export class InvalidAssetCategoryError extends Error {
  readonly code = "INVALID_ASSET_CATEGORY";
  readonly messageEn: string;
  constructor(readonly reasons: readonly string[]) {
    super(`بيانات فئة الأصول غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid asset category: ${reasons.join("; ")}`;
    this.name = "InvalidAssetCategoryError";
  }
}

/** Raised when an operation references an asset-category id that does not exist. */
export class AssetCategoryNotFoundError extends Error {
  readonly code = "ASSET_CATEGORY_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly categoryId: string) {
    super(`فئة الأصول "${categoryId}" غير موجودة.`);
    this.messageEn = `Asset category "${categoryId}" was not found.`;
    this.name = "AssetCategoryNotFoundError";
  }
}

/** Raised when an asset code already exists (codes are unique across assets). */
export class DuplicateAssetCodeError extends Error {
  readonly code = "DUPLICATE_ASSET_CODE";
  readonly messageEn: string;
  constructor(readonly assetCode: string) {
    super(`كود الأصل "${assetCode}" مستخدم من قبل.`);
    this.messageEn = `Asset code "${assetCode}" already exists.`;
    this.name = "DuplicateAssetCodeError";
  }
}

/** Raised when a new asset fails validation (e.g. a branch/warehouse-scoped asset with no branch/warehouse). */
export class InvalidAssetError extends Error {
  readonly code = "INVALID_ASSET";
  readonly messageEn: string;
  constructor(readonly reasons: readonly string[]) {
    super(`بيانات الأصل غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid asset: ${reasons.join("; ")}`;
    this.name = "InvalidAssetError";
  }
}

/** Raised when an operation references an asset id that does not exist. */
export class AssetNotFoundError extends Error {
  readonly code = "ASSET_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly assetId: string) {
    super(`الأصل "${assetId}" غير موجود.`);
    this.messageEn = `Asset "${assetId}" was not found.`;
    this.name = "AssetNotFoundError";
  }
}

/** Raised when an operation references a depreciation-run id that does not exist. */
export class DepreciationRunNotFoundError extends Error {
  readonly code = "DEPRECIATION_RUN_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly runId: string) {
    super(`تشغيل الإهلاك "${runId}" غير موجود.`);
    this.messageEn = `Depreciation run "${runId}" was not found.`;
    this.name = "DepreciationRunNotFoundError";
  }
}

/** Raised when trying to post a depreciation run that is not in the draft state. */
export enum DepreciationRunDraftAction {
  Post = "post",
  Discard = "discard",
}

export class DepreciationRunNotDraftError extends Error {
  readonly code = "DEPRECIATION_RUN_NOT_DRAFT";
  readonly messageEn: string;
  constructor(
    readonly runId: string,
    readonly status: string,
    readonly action: DepreciationRunDraftAction = DepreciationRunDraftAction.Post,
  ) {
    const discard = action === DepreciationRunDraftAction.Discard;
    super(`لا يمكن ${discard ? "استبعاد" : "ترحيل"} تشغيل الإهلاك "${runId}" لأن حالته «${runStatusAr(status)}» وليست مسودة.`);
    this.messageEn = `Depreciation run "${runId}" is "${status}", not a draft, and cannot be ${discard ? "discarded" : "posted"}.`;
    this.name = "DepreciationRunNotDraftError";
  }
}

/** Raised when reversing a depreciation run that was never posted (or has already been reversed). */
export class DepreciationRunNotPostedError extends Error {
  readonly code = "DEPRECIATION_RUN_NOT_POSTED";
  readonly messageEn: string;
  constructor(
    readonly runId: string,
    readonly status: string,
  ) {
    super(`لا يمكن عكس تشغيل الإهلاك "${runId}" لأن حالته «${runStatusAr(status)}» وليس مُرحَّلاً.`);
    this.messageEn = `Depreciation run "${runId}" is "${status}", not posted, and cannot be reversed.`;
    this.name = "DepreciationRunNotPostedError";
  }
}

/** Raised when a draft depreciation run is still open for a given period + branch: it is posted or discarded before another is drafted. */
export class DuplicateDepreciationPeriodError extends Error {
  readonly code = "DUPLICATE_DEPRECIATION_PERIOD";
  readonly messageEn: string;
  constructor(
    readonly period: string,
    readonly branchId: string | null,
  ) {
    super(`يوجد تشغيل إهلاك مسودة للفترة "${period}"${branchId ? ` للفرع "${branchId}"` : ""}. رحِّله أو استبعده قبل إنشاء تشغيل آخر.`);
    this.messageEn = `A draft depreciation run for period "${period}"${branchId ? ` / branch "${branchId}"` : ""} is still open. Post it or discard it before drafting another.`;
    this.name = "DuplicateDepreciationPeriodError";
  }
}

/** Raised when every asset on a draft run was already charged the period's depreciation by another posted run: nothing is left to post. */
export class AssetAlreadyDepreciatedError extends Error {
  readonly code = "ASSET_ALREADY_DEPRECIATED";
  readonly messageEn: string;
  constructor(
    readonly period: string,
    readonly assetCodes: readonly string[],
  ) {
    const one = assetCodes.length === 1;
    super(
      `${one ? "الأصل" : "الأصول"} ${assetCodes.join("، ")} ${one ? "حُمِّل" : "حُمِّلت"} إهلاك الفترة "${period}" في تشغيل مرحَّل آخر، ولم يبقَ في هذه المسودة ما يُرحَّل. استبعد المسودة من قائمة تشغيلات الإهلاك.`,
    );
    this.messageEn = `${one ? "Asset" : "Assets"} ${assetCodes.join(", ")} ${one ? "was" : "were"} already charged depreciation for period "${period}" by another posted run, and nothing is left on this draft to post. Discard the draft from the depreciation runs list.`;
    this.name = "AssetAlreadyDepreciatedError";
  }
}

export class NoDepreciableAssetsError extends Error {
  readonly code = "NO_DEPRECIABLE_ASSETS";
  readonly messageEn: string;
  constructor(readonly period: string) {
    super(`لا توجد أصول مستحق عليها إهلاك للفترة "${period}".`);
    this.messageEn = `No eligible assets have any depreciation due for period "${period}".`;
    this.name = "NoDepreciableAssetsError";
  }
}

/**
 * Raised when reversing a depreciation run while a LATER posted run shares
 * one of its assets (D275). QuickBooks and Odoo both enforce this: a later
 * run has already built its own accumulated-depreciation figure on top of
 * this one, so undoing this run first would leave that figure standing on a
 * run whose starting point no longer exists. Runs must be reversed
 * newest-first.
 */
export class LaterDepreciationRunExistsError extends Error {
  readonly code = "LATER_DEPRECIATION_RUN_EXISTS";
  readonly messageEn: string;
  constructor(
    readonly runId: string,
    readonly period: string,
    readonly laterRunId: string,
    readonly laterRunPeriod: string,
  ) {
    super(
      `لا يمكن عكس تشغيل الإهلاك لفترة "${period}" لوجود تشغيل لاحق مُرحَّل لفترة "${laterRunPeriod}" يشمل نفس الأصل؛ اعكس التشغيلات الأحدث أولاً.`,
    );
    this.messageEn = `Depreciation run "${runId}" (period "${period}") cannot be reversed while a later posted run "${laterRunId}" (period "${laterRunPeriod}") shares one of its assets; reverse the newest run first.`;
    this.name = "LaterDepreciationRunExistsError";
  }
}
