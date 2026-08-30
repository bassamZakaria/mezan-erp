import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  DEFAULT_AGING_WRITEDOWN_POLICY,
  agingDaysBetween,
  applyRateBps,
  periodEndDate,
  tenantAgingPolicy,
  writedownRateForAgingDays,
} from "./aging.js";

describe("periodEndDate", () => {
  it("returns the last calendar day for ordinary and leap-year Februaries", () => {
    expect(periodEndDate("2026-02")).toBe("2026-02-28");
    expect(periodEndDate("2024-02")).toBe("2024-02-29");
    expect(periodEndDate("2026-12")).toBe("2026-12-31");
  });

  it("rejects a period that doesn't match YYYY-MM", () => {
    expect(() => periodEndDate("2026")).toThrow(RangeError);
    expect(() => periodEndDate("2026-3")).toThrow(RangeError);
    expect(() => periodEndDate("not-a-period")).toThrow(RangeError);
  });
});

describe("agingDaysBetween", () => {
  it("floors to whole days", () => {
    expect(agingDaysBetween("2026-01-01", "2026-04-01")).toBe(90);
    expect(agingDaysBetween("2026-01-01T12:00:00.000Z", "2026-01-02")).toBe(0); // <1 full day
    expect(agingDaysBetween("2026-01-01T00:00:00.000Z", "2026-01-03")).toBe(2);
  });

  it("is zero at the exact instant, never negative for a future last-activity date", () => {
    expect(agingDaysBetween("2026-03-31", "2026-03-31")).toBe(0);
    expect(agingDaysBetween("2026-04-01", "2026-01-01")).toBe(0);
  });

  it("accepts a bare date and a full ISO timestamp for lastActivityAt", () => {
    expect(agingDaysBetween("2026-01-01", "2026-01-11")).toBe(10);
    expect(agingDaysBetween("2026-01-01T00:00:00.000Z", "2026-01-11")).toBe(10);
  });
});

describe("writedownRateForAgingDays", () => {
  it("is 0 below the first band, and picks up right at each minDays boundary (inclusive)", () => {
    expect(writedownRateForAgingDays(0)).toBe(0);
    expect(writedownRateForAgingDays(89)).toBe(0);
    expect(writedownRateForAgingDays(90)).toBe(1_000);
  });

  it("maxDays is exclusive — the day it ends belongs to the next band", () => {
    expect(writedownRateForAgingDays(179)).toBe(1_000);
    expect(writedownRateForAgingDays(180)).toBe(2_500);
    expect(writedownRateForAgingDays(364)).toBe(2_500);
    expect(writedownRateForAgingDays(365)).toBe(5_000);
  });

  it("the final band is unbounded (maxDays null)", () => {
    expect(writedownRateForAgingDays(10_000)).toBe(5_000);
  });

  it("an empty policy always returns 0", () => {
    expect(writedownRateForAgingDays(400, [])).toBe(0);
  });
});

describe("tenantAgingPolicy", () => {
  it("builds one unbounded band whose minDays is the month-count converted against the period's real calendar", () => {
    const bands = tenantAgingPolicy("2026-03", 6, 15);
    expect(bands).toHaveLength(1);
    // 2026-03-31 minus 6 calendar months -> 2025-09-30; days between is exact.
    expect(bands[0]!.minDays).toBe(agingDaysBetween("2025-09-30", "2026-03-31"));
    expect(bands[0]!.maxDays).toBeNull();
    expect(bands[0]!.writedownRateBps).toBe(1_500); // 15% -> 1500 bps
  });

  it("clamps the shifted day to the target month's last day (no Feb 30/31)", () => {
    // one month back from 2026-03-31 -> Feb has only 28 days in 2026.
    const bands = tenantAgingPolicy("2026-03", 1, 10);
    expect(bands[0]!.minDays).toBe(agingDaysBetween("2026-02-28", "2026-03-31"));
  });
});

describe("applyRateBps", () => {
  it("applies a basis-point rate rounded HALF_UP", () => {
    expect(applyRateBps(Money.fromMajor("1000.00"), 1_000).toString()).toBe("100.000000");
    expect(applyRateBps(Money.fromMajor("1000.00"), 2_500).toString()).toBe("250.000000");
  });

  it("rounds an exact half-microunit up (HALF_UP boundary)", () => {
    // 0.03 * 50% = 0.015 exactly representable, no rounding needed — pick a case that IS a boundary.
    expect(applyRateBps(Money.fromScaled(1n), 5_000).toString()).toBe("0.000001"); // 0.000001 * 50% = 0.0000005 -> rounds up
  });

  it("a zero or negative rate returns exactly zero", () => {
    expect(applyRateBps(Money.fromMajor("10.00"), 0).toString()).toBe("0.000000");
    expect(applyRateBps(Money.fromMajor("10.00"), -100).toString()).toBe("0.000000");
  });

  it("zero value under any rate stays zero", () => {
    expect(applyRateBps(Money.zero(), 5_000).toString()).toBe("0.000000");
  });
});

describe("DEFAULT_AGING_WRITEDOWN_POLICY", () => {
  it("ships 3 contiguous, ascending bands", () => {
    expect(DEFAULT_AGING_WRITEDOWN_POLICY).toHaveLength(3);
    for (let i = 1; i < DEFAULT_AGING_WRITEDOWN_POLICY.length; i++) {
      expect(DEFAULT_AGING_WRITEDOWN_POLICY[i]!.minDays).toBe(DEFAULT_AGING_WRITEDOWN_POLICY[i - 1]!.maxDays);
    }
    expect(DEFAULT_AGING_WRITEDOWN_POLICY[DEFAULT_AGING_WRITEDOWN_POLICY.length - 1]!.maxDays).toBeNull();
  });
});
