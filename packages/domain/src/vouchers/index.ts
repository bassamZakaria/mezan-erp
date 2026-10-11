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
  voucherStandsAsOf,
  voucherNetPaid,
  voucherBaseAmount,
  voucherBaseWithholding,
} from "./voucher-document.js";

export {
  assertCashBalanceAllows,
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
  laterDay,
  settlementSplit,
  sumActive,
  summarize,
  allocate,
  reverseAllocation,
} from "./allocation.js";

export {
  FX_REALISED_DOC_TYPE,
  FX_REALISED_LINE_MEMO,
  FX_SETTLEMENT_LINE_MEMO,
  SettlementRateMissingError,
  buildRealisedFxLines,
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
  InvoiceNotFoundError,
  AllocationNotFoundError,
  AllocationMismatchError,
  AllocationCurrencyMismatchError,
  VoucherTreasuryCurrencyMismatchError,
  AllocationExceedsError,
  AllocationAlreadyReversedError,
  HeldAllocationRefusal,
  HeldAllocationRefusedError,
} from "./errors.js";
