/**
 * Treasury Vouchers (السندات النقدية) — the unified 11-type receipt / payment /
 * transfer document + invoice allocation, built on the document framework
 * (docs/catalog/04-accounting-treasury.md §"السندات النقدية").
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
  type VoucherDocument,
  VOUCHER_DOC_TYPE,
  voucherDocumentType,
  voucherLine,
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
  invoiceOutstanding,
  sumActive,
  summarize,
  allocate,
  reverseAllocation,
} from "./allocation.js";

export {
  VoucherService,
  createVoucherGlHook,
  type VoucherServiceDeps,
  type CreateVoucherCommand,
  type ConfirmVoucherOptions,
} from "./voucher-service.js";

export {
  InvalidVoucherError,
  CashBalanceWouldGoNegativeError,
  VoucherNotAllocatableError,
  VoucherNotConfirmedError,
  InvoiceNotFoundError,
  AllocationNotFoundError,
  AllocationMismatchError,
  AllocationExceedsError,
  AllocationAlreadyReversedError,
} from "./errors.js";
