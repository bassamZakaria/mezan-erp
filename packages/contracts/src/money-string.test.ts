import { describe, it, expect } from "vitest";
import { Money } from "@mezan/domain";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";

/**
 * The schema and `Money.fromMajor` have to agree exactly. A literal the schema
 * accepts and the parser throws on is the 500 this defect is about, moved one
 * layer down; a literal the schema refuses and the parser would have taken is a
 * request rejected for no reason.
 */
describe("moneyString agrees with Money.fromMajor (D126)", () => {
  const ACCEPTED = ["0", "1", "100.5", "1250.500000", "0.000001", "-0.000001", "-1250.50", "999999999999999999"];
  const REFUSED = [
    "1e3",
    "0x10",
    "NaN",
    "Infinity",
    "-Infinity",
    "1,250.50",
    " 100 ",
    "100 ",
    " 100",
    "",
    ".",
    ".5",
    "5.",
    "--1",
    "1.2.3",
    "1.0000001",
    "abc",
    "1_000",
    "+100",
    "1e-3",
  ];

  it("accepts every literal Money.fromMajor accepts", () => {
    for (const value of ACCEPTED) {
      expect(moneyString.safeParse(value).success, `moneyString should accept ${JSON.stringify(value)}`).toBe(true);
      expect(() => Money.fromMajor(value), `fromMajor should accept ${JSON.stringify(value)}`).not.toThrow();
    }
  });

  it("refuses every literal that is not an amount, so none of them reaches Money.fromMajor", () => {
    for (const value of REFUSED) {
      expect(moneyString.safeParse(value).success, `moneyString should refuse ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("refuses a seventh decimal place, which Money cannot represent", () => {
    expect(moneyString.safeParse("1.000000").success).toBe(true);
    expect(moneyString.safeParse("1.0000001").success).toBe(false);
    expect(() => Money.fromMajor("1.0000001")).toThrow();
  });

  it("refuses a padded literal rather than trimming it quietly", () => {
    // `Money.fromMajor` trims, so " 100 " used to be accepted silently. A padded
    // amount on the wire is a client bug worth hearing about.
    expect(moneyString.safeParse(" 100 ").success).toBe(false);
    expect(() => Money.fromMajor(" 100 ")).not.toThrow();
  });

  it("refuses an amount too large to be real, whichever sign it carries", () => {
    const huge = "1".repeat(19);
    expect(moneyString.safeParse(huge).success).toBe(false);
    expect(moneyString.safeParse(`-${huge}`).success).toBe(false);
  });

  it("nonNegativeMoneyString refuses a negative, and moneyString allows one", () => {
    expect(nonNegativeMoneyString.safeParse("-1").success).toBe(false);
    expect(nonNegativeMoneyString.safeParse("1").success).toBe(true);
    expect(moneyString.safeParse("-1").success).toBe(true);
  });

  it("names the field's rule in its message, so a client can act on the refusal", () => {
    const result = moneyString.safeParse("1e3");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/exact decimal amount/);
    }
  });
});
