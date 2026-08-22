import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { checkCustomerCredit } from "./credit-check.js";

describe("checkCustomerCredit", () => {
  it("is ok when credit control is disabled, even over the limit", () => {
    const result = checkCustomerCredit({
      enabled: false,
      mode: "BLOCK",
      creditLimit: Money.fromMajor("1000"),
      currentBalance: Money.fromMajor("900"),
      newExposure: Money.fromMajor("500"),
    });
    expect(result.status).toBe("ok");
    expect(result.overBy.scaled).toBe(0n);
    expect(result.message).toBeNull();
  });

  it("is ok when the credit limit is zero (unlimited), even over any balance", () => {
    const result = checkCustomerCredit({
      enabled: true,
      mode: "BLOCK",
      creditLimit: Money.zero(),
      currentBalance: Money.fromMajor("10000"),
      newExposure: Money.fromMajor("5000"),
    });
    expect(result.status).toBe("ok");
  });

  it("is ok when the projected balance stays within the limit", () => {
    const result = checkCustomerCredit({
      enabled: true,
      mode: "BLOCK",
      creditLimit: Money.fromMajor("1000"),
      currentBalance: Money.fromMajor("400"),
      newExposure: Money.fromMajor("500"),
    });
    expect(result.status).toBe("ok");
    expect(result.projectedBalance.toString()).toBe("900.000000");
  });

  it("is exactly ok at the limit boundary (projected == limit)", () => {
    const result = checkCustomerCredit({
      enabled: true,
      mode: "BLOCK",
      creditLimit: Money.fromMajor("1000"),
      currentBalance: Money.fromMajor("500"),
      newExposure: Money.fromMajor("500"),
    });
    expect(result.status).toBe("ok");
  });

  it("warns (never blocks) in WARNING mode when over the limit", () => {
    const result = checkCustomerCredit({
      enabled: true,
      mode: "WARNING",
      creditLimit: Money.fromMajor("1000"),
      currentBalance: Money.fromMajor("800"),
      newExposure: Money.fromMajor("500"),
    });
    expect(result.status).toBe("warning");
    expect(result.overBy.toString()).toBe("300.000000");
    expect(result.message).not.toBeNull();
  });

  it("blocks in BLOCK mode when over the limit", () => {
    const result = checkCustomerCredit({
      enabled: true,
      mode: "BLOCK",
      creditLimit: Money.fromMajor("1000"),
      currentBalance: Money.fromMajor("800"),
      newExposure: Money.fromMajor("500"),
    });
    expect(result.status).toBe("blocked");
    expect(result.overBy.toString()).toBe("300.000000");
    expect(result.message).not.toBeNull();
  });
});
