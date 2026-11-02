import { describe, it, expect } from "vitest";
import {
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

describe("vouchers errors", () => {
  it("InvalidVoucherError carries the voucher id and the supplied message", () => {
    const err = new InvalidVoucherError("v-1", "المبلغ يجب أن يكون موجباً");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidVoucherError");
    expect(err.code).toBe("INVALID_VOUCHER");
    expect(err.voucherId).toBe("v-1");
    expect(err.message).toBe("المبلغ يجب أن يكون موجباً");
  });

  it("CashBalanceWouldGoNegativeError renders the cash-account Arabic message with the figures", () => {
    const err = new CashBalanceWouldGoNegativeError("ta-1", "100.000000", "150.000000", "cash");
    expect(err.name).toBe("CashBalanceWouldGoNegativeError");
    expect(err.code).toBe("CASH_BALANCE_NEGATIVE");
    expect(err.treasuryAccountId).toBe("ta-1");
    expect(err.currentBalance).toBe("100.000000");
    expect(err.amount).toBe("150.000000");
    expect(err.accountType).toBe("cash");
    expect(err.message).toBe(
      'لا يمكن تأكيد السند: الخزينة النقدية "ta-1" سيصبح رصيده سالباً (الرصيد الحالي 100.000000، والمبلغ المطلوب صرفه 150.000000).',
    );
  });

  it("CashBalanceWouldGoNegativeError renders the bank-account wording and defaults type to cash", () => {
    const bank = new CashBalanceWouldGoNegativeError("ta-2", "0.000000", "10.000000", "bank");
    expect(bank.message).toContain("الحساب البنكي");
    expect(bank.accountType).toBe("bank");

    const defaulted = new CashBalanceWouldGoNegativeError("ta-3", "0.000000", "10.000000");
    expect(defaulted.accountType).toBe("cash");
    expect(defaulted.message).toContain("الخزينة النقدية");
  });

  it("VoucherNotAllocatableError names the voucher and its type", () => {
    const err = new VoucherNotAllocatableError("v-1", "other_expense");
    expect(err.name).toBe("VoucherNotAllocatableError");
    expect(err.code).toBe("VOUCHER_NOT_ALLOCATABLE");
    expect(err.message).toBe('السند "v-1" من نوع "مصروف آخر" لا يقبل التخصيص على الفواتير.');
  });

  it("VoucherNotConfirmedError names the voucher and its status", () => {
    const err = new VoucherNotConfirmedError("v-1", "draft");
    expect(err.name).toBe("VoucherNotConfirmedError");
    expect(err.code).toBe("VOUCHER_NOT_CONFIRMED");
    expect(err.message).toBe('السند "v-1" حالته "مسودة" وليس مؤكداً، فلا يمكن تخصيصه.');
  });

  it("InvoiceNotFoundError carries the invoice id", () => {
    const err = new InvoiceNotFoundError("inv-1");
    expect(err.name).toBe("InvoiceNotFoundError");
    expect(err.code).toBe("INVOICE_NOT_FOUND");
    expect(err.invoiceId).toBe("inv-1");
    expect(err.message).toBe('تعذّر العثور على فاتورة مفتوحة بالرقم "inv-1".');
  });

  it("AllocationNotFoundError carries the allocation id", () => {
    const err = new AllocationNotFoundError("al-1");
    expect(err.name).toBe("AllocationNotFoundError");
    expect(err.code).toBe("ALLOCATION_NOT_FOUND");
    expect(err.allocationId).toBe("al-1");
    expect(err.message).toBe('تعذّر العثور على التخصيص "al-1".');
  });

  it("AllocationMismatchError carries a free-form message", () => {
    const err = new AllocationMismatchError("العميل لا يطابق الفاتورة");
    expect(err.name).toBe("AllocationMismatchError");
    expect(err.code).toBe("ALLOCATION_MISMATCH");
    expect(err.message).toBe("العميل لا يطابق الفاتورة");
  });

  it("AllocationExceedsError carries a free-form message", () => {
    const err = new AllocationExceedsError("المبلغ يتجاوز الرصيد المتبقي على السند", "The amount exceeds the voucher remainder");
    expect(err.name).toBe("AllocationExceedsError");
    expect(err.code).toBe("ALLOCATION_EXCEEDS");
    expect(err.message).toBe("المبلغ يتجاوز الرصيد المتبقي على السند");
  });

  it("AllocationAlreadyReversedError carries the allocation id", () => {
    const err = new AllocationAlreadyReversedError("al-1");
    expect(err.name).toBe("AllocationAlreadyReversedError");
    expect(err.code).toBe("ALLOCATION_ALREADY_REVERSED");
    expect(err.allocationId).toBe("al-1");
    expect(err.message).toBe('التخصيص "al-1" معكوس بالفعل.');
  });
});
