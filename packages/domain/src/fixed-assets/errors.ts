/** Fixed-assets domain errors (Asset Register, Asset Categories, Depreciation Runs). Stable `code`s so the api/UI can branch. */

/** Raised when an asset-category code already exists (codes are unique across categories). */
export class DuplicateAssetCategoryCodeError extends Error {
  readonly code = "DUPLICATE_ASSET_CATEGORY_CODE";
  constructor(readonly categoryCode: string) {
    super(`Asset category code "${categoryCode}" already exists.`);
    this.name = "DuplicateAssetCategoryCodeError";
  }
}

/** Raised when a new/updated asset category fails validation (e.g. salvage % out of range, useful life <= 0). */
export class InvalidAssetCategoryError extends Error {
  readonly code = "INVALID_ASSET_CATEGORY";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidAssetCategoryError";
  }
}

/** Raised when an operation references an asset-category id that does not exist. */
export class AssetCategoryNotFoundError extends Error {
  readonly code = "ASSET_CATEGORY_NOT_FOUND";
  constructor(readonly categoryId: string) {
    super(`Asset category "${categoryId}" was not found.`);
    this.name = "AssetCategoryNotFoundError";
  }
}

/** Raised when an asset code already exists (codes are unique across assets). */
export class DuplicateAssetCodeError extends Error {
  readonly code = "DUPLICATE_ASSET_CODE";
  constructor(readonly assetCode: string) {
    super(`Asset code "${assetCode}" already exists.`);
    this.name = "DuplicateAssetCodeError";
  }
}

/** Raised when a new asset fails validation (e.g. a branch/warehouse-scoped asset with no branch/warehouse). */
export class InvalidAssetError extends Error {
  readonly code = "INVALID_ASSET";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidAssetError";
  }
}

/** Raised when an operation references an asset id that does not exist. */
export class AssetNotFoundError extends Error {
  readonly code = "ASSET_NOT_FOUND";
  constructor(readonly assetId: string) {
    super(`Asset "${assetId}" was not found.`);
    this.name = "AssetNotFoundError";
  }
}

/** Raised when an operation references a depreciation-run id that does not exist. */
export class DepreciationRunNotFoundError extends Error {
  readonly code = "DEPRECIATION_RUN_NOT_FOUND";
  constructor(readonly runId: string) {
    super(`Depreciation run "${runId}" was not found.`);
    this.name = "DepreciationRunNotFoundError";
  }
}

/** Raised when trying to post a depreciation run that is not in the draft state. */
export class DepreciationRunNotDraftError extends Error {
  readonly code = "DEPRECIATION_RUN_NOT_DRAFT";
  constructor(
    readonly runId: string,
    readonly status: string,
  ) {
    super(`Depreciation run "${runId}" is "${status}", not a draft, and cannot be posted.`);
    this.name = "DepreciationRunNotDraftError";
  }
}

/** Raised when reversing a depreciation run that was never posted (or has already been reversed). */
export class DepreciationRunNotPostedError extends Error {
  readonly code = "DEPRECIATION_RUN_NOT_POSTED";
  constructor(
    readonly runId: string,
    readonly status: string,
  ) {
    super(`Depreciation run "${runId}" is "${status}", not posted, and cannot be reversed.`);
    this.name = "DepreciationRunNotPostedError";
  }
}

/** Raised when a depreciation run already exists for a given period + branch (and isn't cancelled). */
export class DuplicateDepreciationPeriodError extends Error {
  readonly code = "DUPLICATE_DEPRECIATION_PERIOD";
  constructor(
    readonly period: string,
    readonly branchId: string | null,
  ) {
    super(
      `A depreciation run for period "${period}"${branchId ? ` / branch "${branchId}"` : ""} already exists.`,
    );
    this.name = "DuplicateDepreciationPeriodError";
  }
}

/** Raised when a new depreciation run would contain zero lines (no eligible asset has anything due for the period). */
export class NoDepreciableAssetsError extends Error {
  readonly code = "NO_DEPRECIABLE_ASSETS";
  constructor(readonly period: string) {
    super(`No eligible assets have any depreciation due for period "${period}".`);
    this.name = "NoDepreciableAssetsError";
  }
}
