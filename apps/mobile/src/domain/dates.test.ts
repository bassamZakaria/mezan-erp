import { describe, expect, it } from "vitest";
import { addDaysIso, todayIso } from "./dates";

describe("todayIso", () => {
  it("returns a calendar day, not an instant", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
