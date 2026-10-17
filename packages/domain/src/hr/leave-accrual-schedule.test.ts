import { describe, expect, it } from "vitest";
import { MAX_CATCH_UP_PERIODS, ScheduledAccrualFrequency, missedAccrualPeriods, periodStartDate } from "./leave-accrual-schedule.js";

const monthly = (periodKey: string) => ({ periodKey, frequency: ScheduledAccrualFrequency.Monthly });

describe("missedAccrualPeriods", () => {
  it("owes only the current period when nothing was ever accrued", () => {
    expect(missedAccrualPeriods([], "2026-10-17", ScheduledAccrualFrequency.Monthly)).toEqual(["2026-10"]);
    expect(missedAccrualPeriods([], "2026-10-17", ScheduledAccrualFrequency.Annual)).toEqual(["2026"]);
  });

  it("catches up every month after the latest batch, across a year end", () => {
    expect(missedAccrualPeriods([monthly("2025-10"), monthly("2025-11")], "2026-02-03", ScheduledAccrualFrequency.Monthly)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("owes nothing once the current period has a batch, and ignores the other frequency", () => {
    expect(missedAccrualPeriods([monthly("2026-10")], "2026-10-31", ScheduledAccrualFrequency.Monthly)).toEqual([]);
    expect(missedAccrualPeriods([monthly("2026-10")], "2026-10-31", ScheduledAccrualFrequency.Annual)).toEqual(["2026"]);
  });

  it("caps a long gap to the most recent periods", () => {
    const owed = missedAccrualPeriods([monthly("2020-01")], "2026-10-01", ScheduledAccrualFrequency.Monthly);
    expect(owed).toHaveLength(MAX_CATCH_UP_PERIODS[ScheduledAccrualFrequency.Monthly]);
    expect(owed.at(-1)).toBe("2026-10");
  });

  it("dates a period's batch on its first day", () => {
    expect(periodStartDate("2026-03", ScheduledAccrualFrequency.Monthly)).toBe("2026-03-01");
    expect(periodStartDate("2026", ScheduledAccrualFrequency.Annual)).toBe("2026-01-01");
  });
});
