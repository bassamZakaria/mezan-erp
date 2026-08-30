import { afterEach, describe, expect, it, vi } from "vitest";
import { monthEndIso, monthStartIso, quarterStartIso, todayIso, yearStartIso } from "./dates";

function at(local: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(local));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the dates a form opens on", () => {
  it("gives today, this month and this year for an ordinary day", () => {
    at("2026-08-30T10:00:00");
    expect(todayIso()).toBe("2026-08-30");
    expect(monthStartIso()).toBe("2026-08-01");
    expect(monthEndIso()).toBe("2026-08-31");
    expect(yearStartIso()).toBe("2026-01-01");
  });

  it("uses the local calendar day, not the UTC one", () => {
    // Just after midnight local time east of Greenwich, toISOString() would
    // still report the previous day — which is every user this ships to.
    at("2026-08-30T00:30:00");
    expect(todayIso()).toBe("2026-08-30");
  });

  it("keeps the last day of the month right without a leap-year table", () => {
    at("2026-02-10T12:00:00");
    expect(monthEndIso()).toBe("2026-02-28");

    at("2028-02-10T12:00:00");
    expect(monthEndIso()).toBe("2028-02-29");

    at("2026-04-10T12:00:00");
    expect(monthEndIso()).toBe("2026-04-30");
  });

  it("holds on the last day of a month and of the year", () => {
    at("2026-12-31T23:00:00");
    expect(todayIso()).toBe("2026-12-31");
    expect(monthStartIso()).toBe("2026-12-01");
    expect(monthEndIso()).toBe("2026-12-31");
    expect(yearStartIso()).toBe("2026-01-01");
  });

  it("starts the quarter on the right month in each of the four", () => {
    for (const [day, expected] of [
      ["2026-01-15T12:00:00", "2026-01-01"],
      ["2026-03-31T12:00:00", "2026-01-01"],
      ["2026-04-01T12:00:00", "2026-04-01"],
      ["2026-06-30T12:00:00", "2026-04-01"],
      ["2026-07-01T12:00:00", "2026-07-01"],
      ["2026-10-01T12:00:00", "2026-10-01"],
      ["2026-12-31T12:00:00", "2026-10-01"],
    ] as const) {
      at(day);
      expect(quarterStartIso(), day).toBe(expected);
    }
  });

  it("pads month and day to two digits, which the API's date filters require", () => {
    at("2026-01-05T12:00:00");
    expect(todayIso()).toBe("2026-01-05");
    expect(monthStartIso()).toBe("2026-01-01");
    expect(monthEndIso()).toBe("2026-01-31");
  });

  it("keeps every default inside the period it names", () => {
    at("2026-08-30T10:00:00");
    expect(monthStartIso() <= todayIso()).toBe(true);
    expect(todayIso() <= monthEndIso()).toBe(true);
    expect(yearStartIso() <= monthStartIso()).toBe(true);
    expect(quarterStartIso() <= monthStartIso()).toBe(true);
  });
});
