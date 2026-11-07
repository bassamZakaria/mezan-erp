import { describe, expect, it } from "vitest";
import { accountPeriodBalance, currentFiscalYearRange } from "./account-period-balance";

const year = (y: number) => Array.from({ length: 12 }, (_, i) => {
  const m = String(i + 1).padStart(2, "0");
  return { year: y, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${i === 1 ? "28" : "30"}` };
});

describe("accountPeriodBalance", () => {
  const lines = [
    { date: "2025-07-31", debit: "7000.000000", credit: "0" },
    { date: "2025-12-31", debit: "0", credit: "500.250000" },
    { date: "2026-03-31", debit: "1250.500000", credit: "0" },
    { date: "2026-10-31", debit: "0.100000", credit: "0" },
  ];

  it("splits the history into the balance before the year, the year's movement and the closing", () => {
    const range = currentFiscalYearRange([...year(2025), ...year(2026)], "2026-11-07");
    expect(range).toEqual({ start: "2026-01-01", end: "2026-12-30" });
    expect(accountPeriodBalance(lines, range)).toMatchObject({ opening: 6499.75, movement: 1250.6, closing: 7750.35 });
  });

  it("counts everything as movement when no fiscal year is defined", () => {
    expect(accountPeriodBalance(lines, null)).toMatchObject({ opening: 0, movement: 7750.35, closing: 7750.35 });
  });

  it("uses the latest year when today falls in none", () => {
    expect(currentFiscalYearRange(year(2025), "2026-11-07")).toEqual({ start: "2025-01-01", end: "2025-12-30" });
  });

  it("sums many small lines without float drift", () => {
    const many = Array.from({ length: 1000 }, () => ({ date: "2026-01-15", debit: "0.100000", credit: "0" }));
    expect(accountPeriodBalance(many, null).closing).toBe(100);
  });
});
