import { describe, expect, it } from "vitest";
import { calendarDay, toTenantDay } from "./dates.js";

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

describe("toTenantDay", () => {
  it("returns a day-shaped value untouched, whatever the zone", () => {
    expect(toTenantDay("2026-08-31", "Africa/Cairo")).toBe("2026-08-31");
    expect(toTenantDay("2026-08-31", "Pacific/Kiritimati")).toBe("2026-08-31");
  });

  it("resolves an instant in the tenant zone, not in UTC", () => {
    // Cairo is +03:00 in August (DST is back since 2023) and +02:00 in December.
    expect(toTenantDay("2026-08-31T03:10:33.016Z", "Africa/Cairo")).toBe("2026-08-31");
    expect(toTenantDay("2026-08-31T20:00:00.000Z", "Africa/Cairo")).toBe("2026-08-31");
    expect(toTenantDay("2026-12-31T20:00:00.000Z", "Africa/Cairo")).toBe("2026-12-31");
  });

  it("moves an instant onto the NEXT day when it is already tomorrow in Cairo", () => {
    expect(toTenantDay("2026-09-30T23:59:59.999Z", "Africa/Cairo")).toBe("2026-10-01");
    expect(toTenantDay("2026-12-31T23:59:59.999Z", "Africa/Cairo")).toBe("2027-01-01");
  });

  it("moves an instant onto the PREVIOUS day for a tenant west of UTC", () => {
    expect(toTenantDay("2026-08-01T00:00:00.000Z", "America/New_York")).toBe("2026-07-31");
  });

  it("defaults to Cairo when no zone is given", () => {
    expect(toTenantDay("2026-09-30T23:59:59.999Z")).toBe("2026-10-01");
  });

  it("falls back to the UTC day rather than throwing on a timezone nobody knows", () => {
    expect(toTenantDay("2026-08-31T03:10:33.016Z", "Africa/Atlantis")).toBe("2026-08-31");
  });

  it("does not repair a malformed value — that is its validator's job", () => {
    expect(toTenantDay("not a date", "Africa/Cairo")).toBe("not a date");
    expect(toTenantDay("2026-08", "Africa/Cairo")).toBe("2026-08");
  });
});
