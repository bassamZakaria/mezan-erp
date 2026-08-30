import { describe, it, expect } from "vitest";
import {
  TREASURY_ACCOUNT_TYPE_DEFINITIONS,
  getTreasuryAccountTypeLabel,
  type TreasuryAccountType,
} from "./treasury-account.js";

describe("TREASURY_ACCOUNT_TYPE_DEFINITIONS", () => {
  it("defines the two treasury account types with their Arabic labels", () => {
    expect(TREASURY_ACCOUNT_TYPE_DEFINITIONS).toEqual([
      { code: "cash", labelAr: "نقدي" },
      { code: "bank", labelAr: "بنكي" },
    ]);
  });
});

describe("getTreasuryAccountTypeLabel", () => {
  it("returns the Arabic label for each known type", () => {
    expect(getTreasuryAccountTypeLabel("cash")).toBe("نقدي");
    expect(getTreasuryAccountTypeLabel("bank")).toBe("بنكي");
  });

  it("falls back to the raw code for an unknown type", () => {
    expect(getTreasuryAccountTypeLabel("bogus" as TreasuryAccountType)).toBe("bogus");
  });
});
