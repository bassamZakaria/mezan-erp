import { describe, it, expect } from "vitest";
import { createHoliday, updateHoliday, listHolidaysForYear } from "./holiday.js";
import { InvalidHolidayError } from "./errors.js";

describe("createHoliday", () => {
  it("creates a one-time holiday with defaults", () => {
    const h = createHoliday({ id: "h1", date: "2026-10-06", nameEn: "Armed Forces Day", nameAr: "عيد القوات المسلحة" });
    expect(h).toMatchObject({ id: "h1", date: "2026-10-06", nameEn: "Armed Forces Day", nameAr: "عيد القوات المسلحة", recurringAnnual: false });
  });

  it("rejects an invalid date or empty English name", () => {
    expect(() => createHoliday({ id: "h1", date: "not-a-date", nameEn: "X" })).toThrow(InvalidHolidayError);
    expect(() => createHoliday({ id: "h1", date: "2026-10-06", nameEn: "" })).toThrow(InvalidHolidayError);
  });
});

describe("updateHoliday", () => {
  it("applies a patch and re-validates", () => {
    const h = createHoliday({ id: "h1", date: "2026-10-06", nameEn: "Armed Forces Day" });
    const updated = updateHoliday(h, { recurringAnnual: true, nameAr: "عيد القوات المسلحة" });
    expect(updated.recurringAnnual).toBe(true);
    expect(updated.nameAr).toBe("عيد القوات المسلحة");
  });
});

describe("listHolidaysForYear", () => {
  it("includes a non-recurring holiday only in its own anchor year", () => {
    const h = createHoliday({ id: "h1", date: "2026-08-15", nameEn: "One-time" });
    expect(listHolidaysForYear([h], 2026).map((x) => x.date)).toEqual(["2026-08-15"]);
    expect(listHolidaysForYear([h], 2027)).toEqual([]);
  });

  it("projects a recurring holiday's month/day onto every requested year", () => {
    const h = createHoliday({ id: "h1", date: "2026-10-06", nameEn: "National Day", recurringAnnual: true });
    expect(listHolidaysForYear([h], 2026).map((x) => x.date)).toEqual(["2026-10-06"]);
    expect(listHolidaysForYear([h], 2027).map((x) => x.date)).toEqual(["2027-10-06"]);
    expect(listHolidaysForYear([h], 2025).map((x) => x.date)).toEqual(["2025-10-06"]);
  });

  it("sorts the projected results by date", () => {
    const a = createHoliday({ id: "h1", date: "2026-12-25", nameEn: "Christmas" });
    const b = createHoliday({ id: "h2", date: "2026-01-07", nameEn: "Coptic Christmas" });
    expect(listHolidaysForYear([a, b], 2026).map((x) => x.id)).toEqual(["h2", "h1"]);
  });
});
