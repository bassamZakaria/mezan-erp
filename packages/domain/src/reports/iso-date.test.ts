import { describe, it, expect } from "vitest";
import { isRealIsoDate, isoDateParamSchema } from "./iso-date.js";

describe("a report date parameter is a real calendar date (D98)", () => {
  it("accepts an ordinary date", () => {
    for (const value of ["2026-01-01", "2026-12-31", "1999-06-15"]) {
      expect(isRealIsoDate(value), value).toBe(true);
    }
  });

  it("refuses a thirteenth month and a forty-fifth day", () => {
    // These used to pass a shape check, match nothing, and render as "no sales
    // in that range" — which a reader cannot tell apart from a real empty
    // result, and the wrong reading is the one that gets believed.
    expect(isRealIsoDate("2026-13-45")).toBe(false);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-01-45")).toBe(false);
  });

  it("refuses a zero month or day", () => {
    expect(isRealIsoDate("2026-00-10")).toBe(false);
    expect(isRealIsoDate("2026-01-00")).toBe(false);
  });

  it("refuses a day past the end of its own month", () => {
    expect(isRealIsoDate("2026-04-31")).toBe(false);
    expect(isRealIsoDate("2026-06-31")).toBe(false);
    expect(isRealIsoDate("2026-09-31")).toBe(false);
    expect(isRealIsoDate("2026-11-31")).toBe(false);
  });

  it("gets February right, leap year and not", () => {
    // 2024 is a leap year, 2026 is not, 2000 is (÷400), 1900 is not (÷100).
    expect(isRealIsoDate("2024-02-29")).toBe(true);
    expect(isRealIsoDate("2026-02-29")).toBe(false);
    expect(isRealIsoDate("2000-02-29")).toBe(true);
    expect(isRealIsoDate("1900-02-29")).toBe(false);
    expect(isRealIsoDate("2026-02-28")).toBe(true);
  });

  it("does not roll a bad date forward the way `new Date` would", () => {
    // `new Date("2026-02-30")` is 2 March, so a Date-based check would accept
    // exactly the input this exists to refuse.
    expect(new Date("2026-02-30").toString()).not.toBe("Invalid Date");
    expect(isRealIsoDate("2026-02-30")).toBe(false);
  });

  it("refuses anything that is not the ISO shape at all", () => {
    for (const value of ["", "2026", "2026-1-1", "26-01-01", "2026/01/01", "yesterday", "2026-01-01T00:00:00Z"]) {
      expect(isRealIsoDate(value), value).toBe(false);
    }
  });

  it("is the schema the report parameters use, and it reports an Arabic message", () => {
    expect(isoDateParamSchema.safeParse("2026-01-01").success).toBe(true);
    const bad = isoDateParamSchema.safeParse("2026-13-45");
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe("تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");
  });
});
