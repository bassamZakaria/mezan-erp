import { describe, it, expect } from "vitest";
import {
  DuplicateAccountCodeError,
  AccountNotFoundError,
  InvalidParentAccountError,
  HeaderAccountNotPostableError,
  CircularParentAccountError,
  HeaderAccountHasChildrenError,
} from "./errors.js";

describe("accounts errors", () => {
  it("DuplicateAccountCodeError carries the code and a descriptive message", () => {
    const err = new DuplicateAccountCodeError("1300");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DuplicateAccountCodeError");
    expect(err.code).toBe("DUPLICATE_ACCOUNT_CODE");
    expect(err.accountCode).toBe("1300");
    expect(err.message).toBe('كود الحساب "1300" مستخدم من قبل.');
    expect(err.messageEn).toBe('Account code "1300" already exists.');
  });

  it("AccountNotFoundError carries the missing id", () => {
    const err = new AccountNotFoundError("acc-1");
    expect(err.name).toBe("AccountNotFoundError");
    expect(err.code).toBe("ACCOUNT_NOT_FOUND");
    expect(err.accountId).toBe("acc-1");
    expect(err.message).toBe('الحساب "acc-1" غير موجود.');
    expect(err.messageEn).toBe('Account "acc-1" was not found.');
  });

  it("InvalidParentAccountError carries a free-form message and its English counterpart", () => {
    const err = new InvalidParentAccountError("الحساب الأصل غير موجود.", "Parent does not exist.");
    expect(err.name).toBe("InvalidParentAccountError");
    expect(err.code).toBe("INVALID_PARENT_ACCOUNT");
    expect(err.message).toBe("الحساب الأصل غير موجود.");
    expect(err.messageEn).toBe("Parent does not exist.");
  });

  it("HeaderAccountNotPostableError carries the account id", () => {
    const err = new HeaderAccountNotPostableError("1000");
    expect(err.name).toBe("HeaderAccountNotPostableError");
    expect(err.code).toBe("HEADER_ACCOUNT_NOT_POSTABLE");
    expect(err.accountId).toBe("1000");
    expect(err.message).toBe('الحساب "1000" حساب تجميعي، ولا يمكن الترحيل إليه.');
    expect(err.messageEn).toBe('Account "1000" is a header account and cannot be posted to.');
  });

  it("CircularParentAccountError carries the account id", () => {
    const err = new CircularParentAccountError("1300");
    expect(err.name).toBe("CircularParentAccountError");
    expect(err.code).toBe("CIRCULAR_PARENT_ACCOUNT");
    expect(err.accountId).toBe("1300");
    expect(err.message).toBe('تعيين هذا الحساب الأصل سيجعل الحساب "1300" سلفاً لنفسه.');
    expect(err.messageEn).toBe('Setting this parent would make account "1300" its own ancestor.');
  });

  it("HeaderAccountHasChildrenError carries the account id", () => {
    const err = new HeaderAccountHasChildrenError("1000");
    expect(err.name).toBe("HeaderAccountHasChildrenError");
    expect(err.code).toBe("HEADER_ACCOUNT_HAS_CHILDREN");
    expect(err.accountId).toBe("1000");
    expect(err.message).toBe('الحساب "1000" له حسابات فرعية، ولا يمكن أن يصبح حساباً تفصيلياً.');
    expect(err.messageEn).toBe('Account "1000" has child accounts and cannot become a detail account.');
  });
});
