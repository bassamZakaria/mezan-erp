import { afterEach, describe, expect, it, vi } from "vitest";
import { addDaysIso, formatAsOf, todayIso } from "./dates";

describe("todayIso", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a calendar day, not an instant", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is the day on the device's own calendar half an hour after midnight, not the day UTC is still in", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:30:00"));
    expect(todayIso()).toBe("2026-10-14");
  });
});

describe("addDaysIso", () => {
  it("adds days within a month", () => {
    expect(addDaysIso("2026-09-01", 5)).toBe("2026-09-06");
  });

  it("carries across a month boundary", () => {
    expect(addDaysIso("2026-09-20", 14)).toBe("2026-10-04");
  });

  it("carries across a year boundary", () => {
    expect(addDaysIso("2026-12-28", 5)).toBe("2027-01-02");
  });

  it("accepts zero days as a no-op", () => {
    expect(addDaysIso("2026-09-20", 0)).toBe("2026-09-20");
  });
});

describe("formatAsOf", () => {
  it("renders the instant in local time", () => {
    const local = new Date(2026, 8, 21, 9, 5);
    expect(formatAsOf(local.toISOString())).toBe("2026-09-21 09:05");
  });

  it("returns an unparseable value unchanged rather than inventing a time", () => {
    expect(formatAsOf("not-a-date")).toBe("not-a-date");
  });
});
