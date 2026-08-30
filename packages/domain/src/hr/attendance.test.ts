import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_STATUS_DEFINITIONS,
  getAttendanceStatusLabel,
  workedMinutesBetween,
  isWeeklyOffDay,
  isHolidayDate,
  resolveAttendanceStatus,
  recordAttendance,
  correctAttendance,
  summarizeAttendance,
  summarizeWorkforceAttendance,
  type AttendanceEntry,
  type AttendanceStatus,
} from "./attendance.js";
import { createHoliday } from "./holiday.js";
import { InvalidAttendanceEntryError } from "./errors.js";

describe("getAttendanceStatusLabel", () => {
  it("returns the Arabic label for every defined status", () => {
    for (const def of ATTENDANCE_STATUS_DEFINITIONS) {
      expect(getAttendanceStatusLabel(def.code)).toBe(def.labelAr);
    }
  });

  it("falls back to the raw code for an unknown status", () => {
    expect(getAttendanceStatusLabel("bogus" as AttendanceStatus)).toBe("bogus");
  });
});

describe("workedMinutesBetween", () => {
  it("is 0 when either clock is missing", () => {
    expect(workedMinutesBetween(null, "17:00")).toBe(0);
    expect(workedMinutesBetween("09:00", null)).toBe(0);
    expect(workedMinutesBetween(null, null)).toBe(0);
  });

  it("computes a same-day shift", () => {
    expect(workedMinutesBetween("09:00", "17:30")).toBe(510);
  });

  it("rolls an overnight shift (checkout at or before check-in) over a full day", () => {
    expect(workedMinutesBetween("22:00", "06:00")).toBe(480);
  });

  it("reads an equal check-in/check-out as a full 24-hour shift, not zero", () => {
    expect(workedMinutesBetween("09:00", "09:00")).toBe(24 * 60);
  });

  it("rejects a malformed time", () => {
    expect(() => workedMinutesBetween("9:00", "17:00")).toThrow(InvalidAttendanceEntryError);
    expect(() => workedMinutesBetween("09:00", "25:00")).toThrow(InvalidAttendanceEntryError);
  });
});

describe("isWeeklyOffDay", () => {
  it("defaults to Friday/Saturday as Egypt's weekend", () => {
    expect(isWeeklyOffDay("2026-08-28")).toBe(true); // Friday
    expect(isWeeklyOffDay("2026-08-29")).toBe(true); // Saturday
    expect(isWeeklyOffDay("2026-08-30")).toBe(false); // Sunday
  });

  it("honours a custom weekly-off set", () => {
    expect(isWeeklyOffDay("2026-08-30", [0])).toBe(true); // Sunday as the only weekly off
    expect(isWeeklyOffDay("2026-08-28", [0])).toBe(false); // Friday no longer off
  });
});

describe("isHolidayDate", () => {
  it("matches a one-time holiday only in its own year", () => {
    const holidays = [createHoliday({ id: "h1", date: "2026-08-15", nameEn: "One-time" })];
    expect(isHolidayDate("2026-08-15", holidays)).toBe(true);
    expect(isHolidayDate("2027-08-15", holidays)).toBe(false);
  });

  it("projects a recurring holiday onto every year", () => {
    const holidays = [createHoliday({ id: "h1", date: "2026-10-06", nameEn: "National Day", recurringAnnual: true })];
    expect(isHolidayDate("2027-10-06", holidays)).toBe(true);
  });
});

describe("resolveAttendanceStatus", () => {
  it("a clock-in with halfDay is half_day regardless of anything else", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: "09:00", halfDay: true })).toBe("half_day");
  });

  it("a clock-in with no expected time is present", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: "09:00" })).toBe("present");
  });

  it("a clock-in exactly at the grace boundary is present, not late", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: "09:15", expectedCheckIn: "09:00", graceMinutes: 15 })).toBe("present");
  });

  it("a clock-in one minute past the grace boundary is late", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: "09:16", expectedCheckIn: "09:00", graceMinutes: 15 })).toBe("late");
  });

  it("a clock-in without grace minutes uses a zero grace window", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: "09:01", expectedCheckIn: "09:00" })).toBe("late");
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: "09:00", expectedCheckIn: "09:00" })).toBe("present");
  });

  it("an employee who works a public holiday is present, not holiday", () => {
    const holidays = [createHoliday({ id: "h1", date: "2026-10-06", nameEn: "National Day" })];
    expect(resolveAttendanceStatus({ date: "2026-10-06", checkIn: "09:00", holidays })).toBe("present");
  });

  it("no clock-in on a holiday date resolves to holiday", () => {
    const holidays = [createHoliday({ id: "h1", date: "2026-10-06", nameEn: "National Day" })];
    expect(resolveAttendanceStatus({ date: "2026-10-06", checkIn: null, holidays })).toBe("holiday");
  });

  it("no clock-in with an approved leave resolves to on_leave", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: null, onApprovedLeave: true })).toBe("on_leave");
  });

  it("no clock-in on the weekly-off day resolves to weekly_off", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-28", checkIn: null })).toBe("weekly_off"); // Friday
  });

  it("no clock-in on a plain working day is absent", () => {
    expect(resolveAttendanceStatus({ date: "2026-08-10", checkIn: null })).toBe("absent"); // Monday
  });
});

describe("recordAttendance", () => {
  it("rejects a missing employee, a malformed date, malformed clock times, or a checkout with no check-in", () => {
    const now = () => "2026-08-10T00:00:00.000Z";
    expect(() => recordAttendance({ id: "a1", employeeId: "", date: "2026-08-10" }, now)).toThrow(InvalidAttendanceEntryError);
    expect(() => recordAttendance({ id: "a1", employeeId: "emp-1", date: "not-a-date" }, now)).toThrow(InvalidAttendanceEntryError);
    expect(() => recordAttendance({ id: "a1", employeeId: "emp-1", date: "2026-08-10", checkIn: "9am" }, now)).toThrow(
      InvalidAttendanceEntryError,
    );
    expect(() => recordAttendance({ id: "a1", employeeId: "emp-1", date: "2026-08-10", checkOut: "17:00" }, now)).toThrow(
      InvalidAttendanceEntryError,
    );
  });

  it("computes worked minutes and derives the status", () => {
    const entry = recordAttendance(
      { id: "a1", employeeId: "emp-1", date: "2026-08-10", checkIn: "09:00", checkOut: "17:00" },
      () => "2026-08-10T18:00:00.000Z",
    );
    expect(entry.workedMinutes).toBe(480);
    expect(entry.status).toBe("present");
    expect(entry.createdAt).toBe("2026-08-10T18:00:00.000Z");
    expect(entry.updatedAt).toBe("2026-08-10T18:00:00.000Z");
  });

  it("an explicit status override bypasses derivation", () => {
    const entry = recordAttendance({ id: "a1", employeeId: "emp-1", date: "2026-08-28", checkIn: "09:00", status: "on_leave" });
    expect(entry.status).toBe("on_leave");
  });

  it("with no clock-in, resolves absent/holiday/weekly_off/on_leave from context", () => {
    expect(recordAttendance({ id: "a1", employeeId: "emp-1", date: "2026-08-10" }).status).toBe("absent");
    expect(recordAttendance({ id: "a1", employeeId: "emp-1", date: "2026-08-28" }).status).toBe("weekly_off"); // Friday
  });
});

describe("correctAttendance", () => {
  const original = recordAttendance({ id: "a1", employeeId: "emp-1", date: "2026-08-10", checkIn: "09:00", checkOut: "17:00" });

  it("re-derives worked minutes and status from a patched check-out", () => {
    const corrected = correctAttendance(original, { checkOut: "18:30" }, () => "2026-08-11T00:00:00.000Z");
    expect(corrected.workedMinutes).toBe(570);
    expect(corrected.status).toBe("present");
    expect(corrected.updatedAt).toBe("2026-08-11T00:00:00.000Z");
  });

  it("keeps fields untouched by the patch", () => {
    const corrected = correctAttendance(original, { notes: "تأخر بسبب المرور" });
    expect(corrected.checkIn).toBe("09:00");
    expect(corrected.checkOut).toBe("17:00");
    expect(corrected.notes).toBe("تأخر بسبب المرور");
  });

  it("an explicit status override on the patch bypasses re-derivation", () => {
    const corrected = correctAttendance(original, { status: "half_day" });
    expect(corrected.status).toBe("half_day");
  });

  it("rejects a patch that produces a checkout with no check-in", () => {
    expect(() => correctAttendance(original, { checkIn: null })).toThrow(InvalidAttendanceEntryError);
  });
});

function entry(overrides: Partial<AttendanceEntry> & Pick<AttendanceEntry, "employeeId" | "date" | "status">): AttendanceEntry {
  return {
    id: `${overrides.employeeId}-${overrides.date}`,
    checkIn: null,
    checkOut: null,
    workedMinutes: 0,
    notes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeAttendance", () => {
  it("counts each status, sums worked minutes, and rounds the attendance rate", () => {
    const entries: AttendanceEntry[] = [
      entry({ employeeId: "emp-1", date: "2026-08-01", status: "present", workedMinutes: 480 }),
      entry({ employeeId: "emp-1", date: "2026-08-02", status: "late", workedMinutes: 460 }),
      entry({ employeeId: "emp-1", date: "2026-08-03", status: "absent" }),
      entry({ employeeId: "emp-1", date: "2026-08-04", status: "on_leave" }),
      entry({ employeeId: "emp-1", date: "2026-08-05", status: "half_day", workedMinutes: 240 }),
      entry({ employeeId: "emp-1", date: "2026-08-06", status: "holiday" }),
      entry({ employeeId: "emp-1", date: "2026-08-07", status: "weekly_off" }),
      // A different employee's entry must not leak into this summary.
      entry({ employeeId: "emp-2", date: "2026-08-01", status: "present", workedMinutes: 999 }),
    ];
    const summary = summarizeAttendance("emp-1", "2026-08-01", "2026-08-07", entries);
    expect(summary.daysPresent).toBe(1);
    expect(summary.daysLate).toBe(1);
    expect(summary.daysAbsent).toBe(1);
    expect(summary.daysOnLeave).toBe(1);
    expect(summary.halfDays).toBe(1);
    expect(summary.holidays).toBe(1);
    expect(summary.weeklyOffDays).toBe(1);
    // working days = present + late + half + absent + on_leave = 5
    expect(summary.workingDays).toBe(5);
    expect(summary.workedMinutes).toBe(480 + 460 + 240);
    // attended = 1 present + 1 late + 1 half = 3 of 5 -> 60%
    expect(summary.attendanceRatePercent).toBe(60);
  });

  it("is 0% with no working days recorded in range", () => {
    const summary = summarizeAttendance("emp-1", "2026-08-01", "2026-08-07", []);
    expect(summary.workingDays).toBe(0);
    expect(summary.attendanceRatePercent).toBe(0);
  });

  it("excludes entries outside the [from, to] window", () => {
    const entries: AttendanceEntry[] = [
      entry({ employeeId: "emp-1", date: "2026-07-31", status: "present" }),
      entry({ employeeId: "emp-1", date: "2026-08-08", status: "present" }),
    ];
    const summary = summarizeAttendance("emp-1", "2026-08-01", "2026-08-07", entries);
    expect(summary.workingDays).toBe(0);
  });
});

describe("summarizeWorkforceAttendance", () => {
  it("pools day counts across the workforce rather than averaging per-employee rates", () => {
    // emp-1: 2 recorded days, both absent (a "small" employee).
    // emp-2: 18 present days, 2 absent days (a "large" employee).
    const entries: AttendanceEntry[] = [
      entry({ employeeId: "emp-1", date: "2026-08-01", status: "absent" }),
      entry({ employeeId: "emp-1", date: "2026-08-02", status: "absent" }),
      ...Array.from({ length: 18 }, (_, i) => entry({ employeeId: "emp-2", date: `2026-08-${String(i + 3).padStart(2, "0")}`, status: "present" })),
      entry({ employeeId: "emp-2", date: "2026-08-21", status: "absent" }),
      entry({ employeeId: "emp-2", date: "2026-08-22", status: "absent" }),
    ];
    const summary = summarizeWorkforceAttendance("2026-08-01", "2026-08-31", entries);
    // pooled: 4 absent of 22 working days = 18%, NOT the simple average of (100% and ~10%).
    expect(summary.workingDays).toBe(22);
    expect(summary.daysAbsent).toBe(4);
    expect(summary.absenceRatePercent).toBe(Math.round((4 / 22) * 100));
    expect(summary.absenceRatePercent).not.toBe(Math.round((100 + (2 / 20) * 100) / 2));
  });

  it("computes the late-arrival rate over attended days, not working days", () => {
    const entries: AttendanceEntry[] = [
      entry({ employeeId: "emp-1", date: "2026-08-01", status: "present" }),
      entry({ employeeId: "emp-1", date: "2026-08-02", status: "late" }),
      entry({ employeeId: "emp-1", date: "2026-08-03", status: "absent" }),
    ];
    const summary = summarizeWorkforceAttendance("2026-08-01", "2026-08-03", entries);
    // attended = present + late = 2; late = 1 -> 50%. Working days = 3, so a naive
    // denominator would read 33%.
    expect(summary.lateArrivalRatePercent).toBe(50);
  });

  it("is 0% for both rates with no working days recorded", () => {
    const summary = summarizeWorkforceAttendance("2026-08-01", "2026-08-31", []);
    expect(summary.absenceRatePercent).toBe(0);
    expect(summary.lateArrivalRatePercent).toBe(0);
  });
});
