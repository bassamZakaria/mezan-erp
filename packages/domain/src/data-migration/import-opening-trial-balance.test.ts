import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { dayBefore, previewOpeningTrialBalanceImport } from "./import-opening-trial-balance.js";

/** guards P-5 — an opening trial balance that does not balance is a ledger that never ties again. */

function row(rowNumber: number, accountCode: string, debit: string, credit: string) {
  return { rowNumber, accountCode, debit: Money.fromMajor(debit), credit: Money.fromMajor(credit) };
}

describe("previewOpeningTrialBalanceImport", () => {
  it("reports a balanced file as balanced, with both totals", () => {
    const result = previewOpeningTrialBalanceImport([
      row(1, "1100", "10000.00", "0"),
      row(2, "3100", "0", "10000.00"),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.balanced).toBe(true);
    expect(result.totalDebit.toString()).toBe(result.totalCredit.toString());
    expect(result.difference.toString()).toBe("0.000000");
  });

  it("reports the exact difference when it does not balance — no tolerance", () => {
    const result = previewOpeningTrialBalanceImport([
      row(1, "1100", "10000.01", "0"),
      row(2, "3100", "0", "10000.00"),
    ]);
    expect(result.balanced).toBe(false);
    expect(result.difference.toString()).toBe("0.010000");
  });

  it("refuses a row that carries both a debit and a credit", () => {
    const result = previewOpeningTrialBalanceImport([row(1, "1100", "100", "50")]);
    expect(result.errors[0]!.reasons[0]).toContain("لا الاثنين معاً");
  });

  it("refuses a row that carries neither", () => {
    const result = previewOpeningTrialBalanceImport([row(1, "1100", "0", "0")]);
    expect(result.errors[0]!.reasons[0]).toContain("أدخل رصيداً");
  });

  it("refuses a negative balance and a duplicated account code, in Arabic", () => {
    const negative = previewOpeningTrialBalanceImport([row(1, "1100", "-5", "0")]);
    expect(negative.errors[0]!.reasons.some((r) => r.includes("سالبًا"))).toBe(true);

    const duplicated = previewOpeningTrialBalanceImport([row(1, "1100", "5", "0"), row(2, "1100", "5", "0")]);
    expect(duplicated.errors[0]!.reasons[0]).toContain("مكرر داخل الملف");
  });

  it("keeps the totals in Money, never a float", () => {
    const result = previewOpeningTrialBalanceImport([
      row(1, "1100", "100.10", "0"),
      row(2, "1200", "200.20", "0"),
      row(3, "3100", "0", "300.30"),
    ]);
    expect(result.totalDebit.toString()).toBe("300.300000");
    expect(result.balanced).toBe(true);
  });
});

describe("dayBefore", () => {
  it("steps back across a month and a year boundary", () => {
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2024-03-01")).toBe("2024-02-29");
  });
});
