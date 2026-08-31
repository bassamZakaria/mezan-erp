import { describe, expect, it } from "vitest";
import { calendarDay } from "./dates.js";

/**
 * The bug this exists to stop coming back: a period boundary is a DAY and a
 * document's `occurredAt` is an INSTANT, and string order puts the instant
 * after the day it belongs to. Every range check compared them directly, so on
 * the last day of a month nothing matched — GL postings failed for want of a
 * fiscal period, and a filed VAT period read as not covering its own last day.
 */
describe("calendarDay", () => {
  it("narrows an instant to the day it falls on", () => {
    expect(calendarDay("2026-08-31T03:10:33.016Z")).toBe("2026-08-31");
  });

  it("leaves a day-shaped value alone, so it is safe on either kind", () => {
    expect(calendarDay("2026-08-31")).toBe("2026-08-31");
  });

  it("makes the last-day comparison come out right, which is the whole point", () => {
    const endOfMonth = "2026-08-31";
    const instantThatDay = "2026-08-31T03:10:33.016Z";
    // The defect, stated as an assertion so nobody re-introduces it by
    // "simplifying" the call away.
    expect(instantThatDay <= endOfMonth).toBe(false);
    expect(calendarDay(instantThatDay) <= endOfMonth).toBe(true);
  });

  it("does not repair a malformed value — that is its validator's job", () => {
    expect(calendarDay("2026-08")).toBe("2026-08");
    expect(calendarDay("")).toBe("");
  });
});
