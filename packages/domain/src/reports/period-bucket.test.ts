import { describe, it, expect } from "vitest";
import { periodBucketKey, withinDateRange } from "./period-bucket.js";

describe("periodBucketKey", () => {
  it("day bucketing returns the date unchanged", () => {
    expect(periodBucketKey("2026-03-17", "day")).toBe("2026-03-17");
  });

  it("month bucketing returns YYYY-MM", () => {
    expect(periodBucketKey("2026-03-17", "month")).toBe("2026-03");
    expect(periodBucketKey("2026-03-01", "month")).toBe("2026-03");
    expect(periodBucketKey("2026-03-31", "month")).toBe("2026-03");
  });

  it("week bucketing keys by the Monday the ISO week starts on", () => {
    // 2026-03-17 is a Tuesday; its week's Monday is 2026-03-16.
    expect(periodBucketKey("2026-03-17", "week")).toBe("2026-03-16");
    // 2026-03-16 itself (a Monday) keys to itself.
    expect(periodBucketKey("2026-03-16", "week")).toBe("2026-03-16");
    // A Sunday (2026-03-22) belongs to the week that started Monday 2026-03-16.
    expect(periodBucketKey("2026-03-22", "week")).toBe("2026-03-16");
  });

  it("week bucketing rolls a Sunday back to the Monday five/six days before, not forward", () => {
    // 2026-01-04 is a Sunday.
    expect(periodBucketKey("2026-01-04", "week")).toBe("2025-12-29");
  });

  it("week keys stay lexicographically chronological, matching the doc-comment's promise", () => {
    const earlier = periodBucketKey("2026-01-05", "week");
    const later = periodBucketKey("2026-06-01", "week");
    expect(earlier < later).toBe(true);
  });
});

describe("withinDateRange", () => {
  it("is true for a date exactly on the from bound and exactly on the to bound", () => {
    expect(withinDateRange("2026-01-01", "2026-01-01", "2026-01-31")).toBe(true);
    expect(withinDateRange("2026-01-31", "2026-01-01", "2026-01-31")).toBe(true);
  });

  it("is false one day outside either bound", () => {
    expect(withinDateRange("2025-12-31", "2026-01-01", "2026-01-31")).toBe(false);
    expect(withinDateRange("2026-02-01", "2026-01-01", "2026-01-31")).toBe(false);
  });

  it("treats an undefined bound as unbounded on that side", () => {
    expect(withinDateRange("1999-01-01", undefined, "2026-01-31")).toBe(true);
    expect(withinDateRange("2999-01-01", "2026-01-01", undefined)).toBe(true);
    expect(withinDateRange("2999-01-01", undefined, undefined)).toBe(true);
  });
});
