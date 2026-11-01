/**
 * Treasury Vouchers (السندات النقدية) — the unified 11-type receipt / payment /
 * transfer document + invoice allocation, built on the document framework
 * (docs/archive/catalog/04-accounting-treasury.md §"السندات النقدية").
 */

export {
  type VoucherType,
  type VoucherDirection,
  type VoucherPaymentMethod,
  type VoucherPaymentMethodDefinition,
  type VoucherTypeDefinition,
  type AllocationInvoiceKind,
  VOUCHER_TYPE_DEFINITIONS,
  VOUCHER_PAYMENT_METHODS,
  getVoucherTypeDefinition,
  REFUNDED_MONEY,
  getVoucherPaymentMethodLabel,
  isVoucherType,
  isAllocatableType,
} from "./voucher-types.js";

export {
  type VoucherLine,
  type TreasuryLegFx,
  type VoucherDocument,
  type HeldAllocationRequest,
  VOUCHER_DOC_TYPE,
  voucherDocumentType,
  voucherLine,
  isStandingVoucher,
  voucherTakesAllocations,
  voucherStandsAsOf,
  voucherNetPaid,
  voucherBaseAmount,
  voucherBaseWithholding,
  voucherBaseCommission,
  voucherStatedNet,
  COMPANY_LEVEL_VOUCHER_BRANCH,
} from "./voucher-document.js";

export {
  assertCashBalanceAllows,
  treasuryAccountOwnBalance,
  type CashGuardDeps,
} from "./cash-guard.js";

export {
  type AllocatableInvoice,
  type AllocationStatus,
  type VoucherAllocation,
  type AllocationRepository,
  type AllocatableInvoiceRepository,
  type AllocationSummary,
  type AllocateInput,
  type SettlementRates,
  type SettlementSplit,
  type InvoiceReturnCreditPort,
  invoiceOutstanding,
  invoiceOpenBalance,
  returnedByInvoice,
  allocationInvoiceAmount,
  allocationFxDifference,
  unconsumedRevaluationShare,
  FxOpenItemType,
  type FxOpenItemRef,
  type FxRevaluationShareRecord,
  type FxRevaluationShareRepository,
  type FxShareRelief,
  laterDay,
  settlementSplit,
  settlementWithShares,
  sumActive,
  summarize,
  allocate,
  reverseAllocation,
} from "./allocation.js";
export { allocationStoodOn } from "./allocation.js";
export { transferCommissionApplies, isCommissionExpenseAccount } from "./transfer-commission.js";

export {
  FX_REALISED_DOC_TYPE,
  FX_SHARE_RELEASE_ENTRY_PREFIX,
  fxLateReleaseEntryId,
  fxLateReleaseEntryIds,
  FX_REALISED_LINE_MEMO,
  FX_SETTLEMENT_LINE_MEMO,
  SettlementRateMissingError,
  buildRealisedFxLines,
  buildRevaluationReleaseLines,
  type RevaluationRelease,
  postRealisedFx,
  realisedFxEntryId,
  realisedFxReversalId,
  allocationUndoDay,
  reverseRealisedFx,
  settlementRatesFor,
  type RealisedFxPort,
  type FxDifferenceAccounts,
  type RealisedFxPostingInput,
  type SettlingLine,
  type SettlingMoney,
} from "./realised-fx.js";

export {
  VoucherService,
  createVoucherGlHook,
  type VoucherServiceDeps,
  type VoucherChequeRegistration,
  type VoucherChequeRegistrationPort,
  type VoucherAdvanceUnwindPort,
  type CreateVoucherCommand,
  type ConfirmVoucherOptions,
  type CollectionAllocationRequest,
  type CollectionResult,
} from "./voucher-service.js";

export {
  InvalidVoucherError,
  CashBalanceWouldGoNegativeError,
  VoucherNotAllocatableError,
  VoucherNotConfirmedError,
  VoucherReversedError,
  InvoiceNotFoundError,
  AllocationNotFoundError,
  AllocationMismatchError,
  AllocationCurrencyMismatchError,
  VoucherTreasuryCurrencyMismatchError,
  AllocationExceedsError,
  AllocationIdTakenError,
  AllocationAlreadyReversedError,
  HeldAllocationRefusal,
  HeldAllocationRefusedError,
} from "./errors.js";
export { AllocationDateTooEarlyError, laterAllocationDay } from "./allocation-day.js";
export { FxItemEventKind, fxItemOpenOn, fxItemTimeline, walkRunShare, type FxItemEvent, type FxItemTimeline, type RunShareStep, type RunShareWalk } from "./revaluation-share-timeline.js";
