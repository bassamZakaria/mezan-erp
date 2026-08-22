import { describe, it, expect } from "vitest";
import { InMemoryFiscalPeriodRepository } from "./test-helpers/in-memory-fiscal-period-repository.js";
import { buildFiscalYearPeriods, generateFiscalYear } from "./generate-fiscal-year.js";
import { DuplicateFiscalPeriodError } from "./errors.js";

describe("buildFiscalYearPeriods", () => {
  it("builds 12 consecutive open periods spanning Jan 1 - Dec 31", () => {
    const periods = buildFiscalYearPeriods(2026, (y, p) => `fp-${y}-${p}`);
    expect(periods).toHaveLength(12);
    expect(periods.every((p) => p.status === "open")).toBe(true);
    expect(periods[0]).toMatchObject({ year: 2026, periodNumber: 1, startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(periods[11]).toMatchObject({ periodNumber: 12, startDate: "2026-12-01", endDate: "2026-12-31" });
    // February in a non-leap-adjacent boundary: 2026 is not a leap year.
    expect(periods[1]).toMatchObject({ periodNumber: 2, startDate: "2026-02-01", endDate: "2026-02-28" });
  });

  it("handles the leap-year February correctly", () => {
    const periods = buildFiscalYearPeriods(2028, (y, p) => `fp-${y}-${p}`);
    expect(periods[1]).toMatchObject({ startDate: "2028-02-01", endDate: "2028-02-29" });
  });
});

describe("generateFiscalYear", () => {
  it("persists all 12 periods for a fresh year", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    const periods = await generateFiscalYear(2026, repo);
    expect(periods).toHaveLength(12);
    expect(await repo.listByYear(2026)).toHaveLength(12);
  });

  it("rejects generating a year that already has periods", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await generateFiscalYear(2026, repo);
    await expect(generateFiscalYear(2026, repo)).rejects.toThrow(DuplicateFiscalPeriodError);
  });

  it("uses the supplied idFactory", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await generateFiscalYear(2027, repo, (y, p) => `custom-${y}-${p}`);
    expect(await repo.findById("custom-2027-1")).not.toBeNull();
  });
});
