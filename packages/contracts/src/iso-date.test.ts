import { describe, expect, it } from "vitest";
import { isoDateOrInstant, isoDay } from "./iso-date.js";

describe("isoDateOrInstant", () => {
  it("accepts a calendar day", () => {
    expect(isoDateOrInstant.safeParse("2026-08-31").success).toBe(true);
  });

  it("accepts the instant shapes a client actually sends", () => {
    for (const v of [
      "2026-08-31T03:10:33.016Z",
      "2026-08-31T03:10:33Z",
      "2026-08-31T03:10Z",
      "2026-08-31T03:10:33+02:00",
      "2026-08-31T03:10:33-0500",
    ]) {
      expect(isoDateOrInstant.safeParse(v), v).toMatchObject({ success: true });
    }
  });

  it("refuses a naive date-time with no zone — which day it is would be a guess", () => {
    expect(isoDateOrInstant.safeParse("2026-08-31T03:10:33").success).toBe(false);
  });

  it("refuses a shape that is neither, instead of passing it to the engine", () => {
    for (const v of ["", "31/08/2026", "2026-8-3", "today", "2026-08", "2026-08-31 03:10:33Z"]) {
      expect(isoDateOrInstant.safeParse(v), v).toMatchObject({ success: false });
    }
  });

  it("refuses a day-shaped value that is not a real day", () => {
    expect(isoDateOrInstant.safeParse("2026-02-30").success).toBe(false);
    expect(isoDateOrInstant.safeParse("2026-13-01").success).toBe(false);
  });

  it("does not transform — the tenant day is the route's job, not the schema's", () => {
    const parsed = isoDateOrInstant.parse("2026-09-30T23:59:59.999Z");
    expect(parsed).toBe("2026-09-30T23:59:59.999Z");
  });
});

describe("isoDay", () => {
  it("accepts a day and refuses an instant", () => {
    expect(isoDay.safeParse("2026-08-31").success).toBe(true);
    expect(isoDay.safeParse("2026-08-31T03:10:33.016Z").success).toBe(false);
  });
});
