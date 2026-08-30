import { describe, it, expect } from "vitest";
import {
  DuplicateTreasuryAccountCodeError,
  TreasuryAccountNotFoundError,
  NegativeCashBalanceError,
} from "./errors.js";

describe("treasury-accounts errors", () => {
  it("DuplicateTreasuryAccountCodeError carries the code and a descriptive message", () => {
    const err = new DuplicateTreasuryAccountCodeError("TA-001");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DuplicateTreasuryAccountCodeError");
    expect(err.code).toBe("DUPLICATE_TREASURY_ACCOUNT_CODE");
    expect(err.accountCode).toBe("TA-001");
    expect(err.message).toBe('Treasury account code "TA-001" already exists.');
  });

  it("TreasuryAccountNotFoundError carries the missing id", () => {
    const err = new TreasuryAccountNotFoundError("ta-1");
    expect(err.name).toBe("TreasuryAccountNotFoundError");
    expect(err.code).toBe("TREASURY_ACCOUNT_NOT_FOUND");
    expect(err.accountId).toBe("ta-1");
    expect(err.message).toBe('Treasury account "ta-1" was not found.');
  });

  it("NegativeCashBalanceError carries the account id", () => {
    const err = new NegativeCashBalanceError("ta-1");
    expect(err.name).toBe("NegativeCashBalanceError");
    expect(err.code).toBe("NEGATIVE_CASH_BALANCE");
    expect(err.accountId).toBe("ta-1");
    expect(err.message).toBe('Cash treasury account "ta-1" cannot have a negative balance.');
  });
});
