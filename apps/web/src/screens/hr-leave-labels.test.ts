// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import {
  ACCRUAL_FREQUENCY_KEY,
  ATTENDANCE_STATUS_KEY,
  ATTENDANCE_STATUS_TONE,
  LEAVE_STATUS_KEY,
  LEAVE_STATUS_TONE,
  LEAVE_TYPE_CODES,
  LEAVE_TYPE_KEY,
  formatDays,
  formatWorkedDuration,
  leaveTypeOptions,
} from "./hr-leave-labels";

const identity = (key: string) => `[${key}]`;

describe("leaveTypeOptions", () => {
  it("returns one option per leave type code, translated through the given t()", () => {
    const options = leaveTypeOptions(identity);
    expect(options).toHaveLength(LEAVE_TYPE_CODES.length);
    expect(options[0]).toEqual({ value: "annual", label: "[leaveType.annual]" });
    expect(options.map((o) => o.value)).toEqual(LEAVE_TYPE_CODES);
  });
});

describe("formatDays", () => {
  it("returns a whole-number string unchanged", () => {
    expect(formatDays("5")).toBe("5");
  });

  it("trims trailing zeros after the decimal point", () => {
    expect(formatDays("5.500000")).toBe("5.5");
  });

  it("drops the decimal point entirely when nothing follows it after trimming", () => {
    expect(formatDays("5.000000")).toBe("5");
  });

  it("normalises an all-zero value to a plain 0", () => {
    expect(formatDays("0.000000")).toBe("0");
  });

  it("preserves a negative value's sign while trimming", () => {
    expect(formatDays("-2.500000")).toBe("-2.5");
  });
});

describe("formatWorkedDuration", () => {
  it("formats zero minutes as 0:00", () => {
    expect(formatWorkedDuration(0)).toBe("0:00");
  });

  it("pads a single-digit remainder of minutes", () => {
    expect(formatWorkedDuration(65)).toBe("1:05");
  });

  it("formats an exact hour boundary with no remainder", () => {
    expect(formatWorkedDuration(60)).toBe("1:00");
  });

  it("formats more than a full day of minutes without wrapping the hour count", () => {
    expect(formatWorkedDuration(1500)).toBe("25:00");
  });
});

describe("catalogue tables", () => {
  it("gives every attendance status both a translation key and a pill tone", () => {
    const statuses = Object.keys(ATTENDANCE_STATUS_KEY);
    expect(statuses.sort()).toEqual(Object.keys(ATTENDANCE_STATUS_TONE).sort());
    expect(ATTENDANCE_STATUS_KEY.present).toBe("attendanceStatus.present");
    expect(ATTENDANCE_STATUS_TONE.absent).toBe("danger");
  });

  it("gives every leave request status both a translation key and a pill tone", () => {
    const statuses = Object.keys(LEAVE_STATUS_KEY);
    expect(statuses.sort()).toEqual(Object.keys(LEAVE_STATUS_TONE).sort());
    expect(LEAVE_STATUS_TONE.rejected).toBe("danger");
  });

  it("maps every leave type code to a translation key", () => {
    expect(Object.keys(LEAVE_TYPE_KEY)).toEqual(LEAVE_TYPE_CODES);
    expect(LEAVE_TYPE_KEY.sick).toBe("leaveType.sick");
  });

  it("covers all three accrual frequencies including none", () => {
    expect(ACCRUAL_FREQUENCY_KEY.none).toBe("accrualFrequency.none");
    expect(Object.keys(ACCRUAL_FREQUENCY_KEY).sort()).toEqual(["annual", "monthly", "none"]);
  });
});
