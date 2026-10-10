export type {
  DepreciationMethod,
  AssetCategory,
  AssetCategoryRepository,
  CreateAssetCategoryCommand,
} from "./asset-category.js";
export { DEFAULT_ASSET_GL_ACCOUNT_CODES, createAssetCategory } from "./asset-category.js";

export type { Asset, AssetRepository, AssetScope, AssetStatus } from "./asset.js";

export type {
  AssetInternalRateRow,
  AssetInternalRateHistoryRepository,
} from "./internal-rate-history.js";
export { resolveInternalHourlyRate, sortInternalRateHistory } from "./internal-rate-history.js";

export type { CreateAssetCommand, CreateAssetDeps } from "./create-asset.js";
export { createAsset } from "./create-asset.js";

export type {
  DisposeAssetCommand,
  DisposeAssetDeps,
  DisposeAssetGlAccounts,
  DisposeAssetGlPort,
  DisposeAssetPosting,
  DisposeAssetPostingLine,
  DisposeAssetResult,
} from "./dispose-asset.js";
export {
  disposeAsset,
  AssetAlreadyDisposedError,
  InvalidAssetDisposalError,
} from "./dispose-asset.js";

export type { DepreciationPeriod, MonthlyDepreciationResult } from "./depreciation.js";
export {
  periodBounds,
  depreciableBase,
  straightLineMonthlyAmount,
  computeMonthlyDepreciation,
} from "./depreciation.js";

export type {
  DepreciationRunStatus,
  DepreciationRunLine,
  DepreciationRun,
  DepreciationRunRepository,
} from "./depreciation-run.js";

export type { CreateDepreciationRunCommand, CreateDepreciationRunDeps } from "./create-depreciation-run.js";
export { createDepreciationRun, depreciationRunsCoverPeriod } from "./create-depreciation-run.js";

export type { PostDepreciationRunDeps } from "./post-depreciation-run.js";
export { postDepreciationRun } from "./post-depreciation-run.js";

export type {
  ReverseDepreciationRunDeps,
  ReverseDepreciationRunOptions,
} from "./reverse-depreciation-run.js";
export { reverseDepreciationRun } from "./reverse-depreciation-run.js";

export {
  DuplicateAssetCategoryCodeError,
  InvalidAssetCategoryError,
  AssetCategoryNotFoundError,
  DuplicateAssetCodeError,
  InvalidAssetError,
  AssetNotFoundError,
  DepreciationRunNotFoundError,
  DepreciationRunNotDraftError,
  DepreciationRunNotPostedError,
  DuplicateDepreciationPeriodError,
  NoDepreciableAssetsError,
  LaterDepreciationRunExistsError,
} from "./errors.js";
