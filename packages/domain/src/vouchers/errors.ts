import { InvalidDocumentError } from "../documents/errors.js";
import { DOCUMENT_STATUS_LABELS_AR, DOCUMENT_STATUS_LABELS_EN, type DocumentStatus } from "../documents/status.js";
import { getVoucherTypeDefinition, isVoucherType } from "./voucher-types.js";

/**
 * Messages here reach the UI verbatim: the api serves `message: err.message`
 * and screens render it directly, so every message must be Arabic.
 */
/** Treasury-voucher domain errors. Stable `code`s so the api/UI can branch. */

/** Raised when a voucher's single economic line is malformed (bad amount, missing account/party). */
export class InvalidVoucherError extends Error {
  readonly code = "INVALID_VOUCHER";
  constructor(
    readonly voucherId: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidVoucherError";
  }
}

/**
 * Raised when confirming a payment/transfer would push a treasury account below
 * zero while the tenant guards that account's type: cash under "منع الرصيد
 * السالب للحسابات النقدية", bank when "السماح بالرصيد السالب للحسابات البنكية"
 * is off — docs/archive/catalog/04 + docs/archive/catalog/09.
 */
export class CashBalanceWouldGoNegativeError extends Error {
  readonly code = "CASH_BALANCE_NEGATIVE";
  readonly messageEn: string;
  constructor(
    readonly treasuryAccountId: string,
    readonly currentBalance: string,
    readonly amount: string,
    readonly accountType: "cash" | "bank" = "cash",
  ) {
    super(
      `لا يمكن تأكيد السند: ${accountType === "cash" ? "الخزينة النقدية" : "الحساب البنكي"} ` +
        `"${treasuryAccountId}" سيصبح رصيده سالباً (الرصيد الحالي ${currentBalance}، والمبلغ المطلوب صرفه ${amount}).`,
    );
    this.messageEn =
      `The voucher cannot be confirmed: ${accountType === "cash" ? "cash box" : "bank account"} ` +
      `"${treasuryAccountId}" would go negative (current balance ${currentBalance}, amount to pay out ${amount}).`;
    this.name = "CashBalanceWouldGoNegativeError";
  }
}

/** Raised when an allocation targets a voucher whose type cannot be allocated. */
export class VoucherNotAllocatableError extends Error {
  readonly code = "VOUCHER_NOT_ALLOCATABLE";
  readonly messageEn: string;
  constructor(readonly voucherId: string, readonly voucherType: string) {
    const def = isVoucherType(voucherType) ? getVoucherTypeDefinition(voucherType) : null;
    super(`السند "${voucherId}" من نوع "${def?.labelAr ?? voucherType}" لا يقبل التخصيص على الفواتير.`);
    this.messageEn = `Voucher "${voucherId}" of type "${def?.labelEn ?? voucherType}" cannot be allocated to invoices.`;
    this.name = "VoucherNotAllocatableError";
  }
}

/** Raised when allocating against a voucher that is not confirmed. */
export class VoucherNotConfirmedError extends Error {
  readonly code = "VOUCHER_NOT_CONFIRMED";
  readonly messageEn: string;
  constructor(readonly voucherId: string, readonly status: string) {
    const known = status in DOCUMENT_STATUS_LABELS_AR ? (status as DocumentStatus) : null;
    super(
      known
        ? `السند "${voucherId}" حالته "${DOCUMENT_STATUS_LABELS_AR[known]}" وليس مؤكداً، فلا يمكن تخصيصه.`
        : `السند "${voucherId}" غير موجود، فلا يمكن تخصيصه.`,
    );
    this.messageEn = known
      ? `Voucher "${voucherId}" is "${DOCUMENT_STATUS_LABELS_EN[known]}", not confirmed, so it cannot be allocated.`
      : `Voucher "${voucherId}" was not found, so it cannot be allocated.`;
    this.name = "VoucherNotConfirmedError";
  }
}

export class VoucherReversedError extends Error {
  readonly code = "VOUCHER_REVERSED";
  readonly messageEn: string;
  constructor(readonly voucherId: string, readonly voucherNo: string, readonly mirror: boolean) {
    super(
      mirror
        ? `السند ${voucherNo} قيد عكس لسند آخر وليس مالاً مقبوضاً أو مدفوعاً، فلا يُخصَّص على فاتورة ولا يُعكس.`
        : `السند ${voucherNo} معكوس ولم يعد مبلغه قائماً، فلا يُخصَّص على فاتورة.`,
    );
    this.name = "VoucherReversedError";
    this.messageEn = mirror
      ? `Voucher ${voucherNo} is the reversal of another voucher, not money received or paid; it cannot be allocated to an invoice or reversed.`
      : `Voucher ${voucherNo} has been reversed and its money no longer stands; it cannot be allocated to an invoice.`;
  }
}

/** Raised when an operation references an invoice id that does not exist. */
export class InvoiceNotFoundError extends Error {
  readonly code = "INVOICE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly invoiceId: string) {
    super(`تعذّر العثور على فاتورة مفتوحة بالرقم "${invoiceId}".`);
    this.messageEn = `No open invoice numbered "${invoiceId}" was found.`;
    this.name = "InvoiceNotFoundError";
  }
}

/** Raised when an operation references an allocation id that does not exist. */
export class AllocationNotFoundError extends Error {
  readonly code = "ALLOCATION_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly allocationId: string) {
    super(`تعذّر العثور على التخصيص "${allocationId}".`);
    this.messageEn = `Allocation "${allocationId}" was not found.`;
    this.name = "AllocationNotFoundError";
  }
}

/** Raised when the invoice's kind (sales/purchase) or party does not match the voucher. */
export class AllocationMismatchError extends Error {
  readonly code: string = "ALLOCATION_MISMATCH";
  readonly messageEn: string;
  constructor(message: string, messageEn = "The invoice does not match the voucher.") {
    super(message);
    this.messageEn = messageEn;
    this.name = "AllocationMismatchError";
  }
}

export class AllocationCurrencyMismatchError extends AllocationMismatchError {
  override readonly code: string = "ALLOCATION_CURRENCY_MISMATCH";
  readonly messageEn: string;
  constructor(
    readonly voucherId: string,
    readonly invoiceId: string,
    readonly voucherCurrency: string,
    readonly invoiceCurrency: string,
  ) {
    super(`السند بعملة ${voucherCurrency} والفاتورة بعملة ${invoiceCurrency}؛ لا يُخصَّص سند على فاتورة بعملة أخرى.`);
    this.name = "AllocationCurrencyMismatchError";
    this.messageEn = `The voucher is in ${voucherCurrency} and the invoice in ${invoiceCurrency}; a voucher cannot settle an invoice in another currency.`;
  }
}

export class VoucherTreasuryCurrencyMismatchError extends InvalidDocumentError {
  readonly messageEn: string;
  constructor(voucherId: string, readonly treasuryAccountId: string, readonly treasuryCurrency: string, readonly voucherCurrency: string) {
    super("TREASURY_VOUCHER", voucherId, `حساب الخزينة بعملة ${treasuryCurrency} والسند بعملة ${voucherCurrency}؛ لا يُسجَّل سند بعملة أجنبية على حساب خزينة بعملة أجنبية أخرى. سجّل السند بعملة الحساب أو بالعملة الأساسية.`);
    this.name = "VoucherTreasuryCurrencyMismatchError";
    this.messageEn = `The treasury account is in ${treasuryCurrency} and the voucher in ${voucherCurrency}; a voucher in one foreign currency is not recorded on a treasury account in another. Record it in the account's currency or in the base currency.`;
  }
}

/**
 * Raised when an allocation amount exceeds either the voucher's unallocated
 * remainder or the invoice's outstanding balance, or is not positive.
 */
export class AllocationExceedsError extends Error {
  readonly code = "ALLOCATION_EXCEEDS";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "AllocationExceedsError";
  }
}

export class AllocationIdTakenError extends Error {
  readonly code = "DUPLICATE_ALLOCATION";
  readonly messageEn: string;
  constructor(readonly allocationId: string) {
    super("سبق تسجيل تخصيص بهذا المعرّف، فلم يُسجَّل هذا الطلب مرة ثانية.");
    this.name = "AllocationIdTakenError";
    this.messageEn = "An allocation is already recorded under this id, so this request was not recorded a second time.";
  }
}

/** Raised when reversing an allocation that is already reversed. */
export class AllocationAlreadyReversedError extends Error {
  readonly code = "ALLOCATION_ALREADY_REVERSED";
  readonly messageEn: string;
  constructor(readonly allocationId: string) {
    super(`التخصيص "${allocationId}" معكوس بالفعل.`);
    this.messageEn = `Allocation "${allocationId}" has already been reversed.`;
    this.name = "AllocationAlreadyReversedError";
  }
}

export enum HeldAllocationRefusal {
  InvoiceMissing = "invoice_missing",
  InvoiceMismatch = "invoice_mismatch",
  NothingLeft = "nothing_left",
  ExceedsInvoice = "exceeds_invoice",
}

/**
 * An allocation carried with a held collection no longer fits the invoice it
 * named (D344): paid elsewhere, returned, or gone. The approved confirm is
 * refused as a whole rather than settling more than the invoice still owes.
 */
export class HeldAllocationRefusedError extends AllocationMismatchError {
  override readonly code: string = "HELD_ALLOCATION_REFUSED";
  readonly messageEn: string;
  constructor(
    readonly voucherId: string,
    readonly invoiceId: string,
    readonly reason: HeldAllocationRefusal,
    readonly requested: string,
    readonly capacity: string,
    whileHeld: boolean,
  ) {
    const ar: Record<HeldAllocationRefusal, string> = {
      [HeldAllocationRefusal.InvoiceMissing]: `الفاتورة "${invoiceId}" لم تعد مفتوحة`,
      [HeldAllocationRefusal.InvoiceMismatch]: `الفاتورة "${invoiceId}" لا تخص عميل السند`,
      [HeldAllocationRefusal.NothingLeft]: `لم يتبقَّ من السند ما يُخصَّص على الفاتورة "${invoiceId}"`,
      [HeldAllocationRefusal.ExceedsInvoice]: `التخصيص المطلوب (${requested}) يتجاوز المتبقي على الفاتورة "${invoiceId}" الآن (${capacity})`,
    };
    const en: Record<HeldAllocationRefusal, string> = {
      [HeldAllocationRefusal.InvoiceMissing]: `invoice "${invoiceId}" is no longer open`,
      [HeldAllocationRefusal.InvoiceMismatch]: `invoice "${invoiceId}" does not belong to the voucher's customer`,
      [HeldAllocationRefusal.NothingLeft]: `nothing is left of the voucher to apply to invoice "${invoiceId}"`,
      [HeldAllocationRefusal.ExceedsInvoice]: `the requested allocation (${requested}) exceeds what invoice "${invoiceId}" still owes (${capacity})`,
    };
    super(
      whileHeld
        ? `تغيّرت الفاتورة منذ تعليق السند للموافقة: ${ar[reason]}. لم يُرحَّل السند؛ ألغِه وسجّل التحصيل من جديد.`
        : `لا يمكن تعليق التحصيل بهذا التخصيص: ${ar[reason]}.`,
    );
    this.name = "HeldAllocationRefusedError";
    this.messageEn = whileHeld
      ? `The invoice changed while the voucher awaited approval: ${en[reason]}. The voucher was not posted; cancel it and record the collection again.`
      : `The collection cannot be held with this allocation: ${en[reason]}.`;
  }
}
