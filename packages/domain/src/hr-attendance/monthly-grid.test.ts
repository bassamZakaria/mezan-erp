import { describe, it, expect } from "vitest";
import { markAttendance } from "./mark-attendance.js";
import { getMonthlyGrid, getMonthlySummary, countPayableDays } from "./monthly-grid.js";
import { createInMemoryAttendanceRepository } from "./test-helpers/in-memory-attendance-repository.js";

const WEEKEND = [5, 6]; // Friday/Saturday

describe("getMonthlyGrid", () => {
  it("derives WEEKLY_OFF on weekend days with no explicit record, leaves other days unmarked", async () => {
    const records = createInMemoryAttendanceRepository();
    const [grid] = await getMonthlyGrid(["emp-1"], 2026, 8, WEEKEND, { records });

    // 2026-08-01 is a Saturday (day 6) per the ISO calendar.
    const day1 = grid!.days.find((d) => d.date === "2026-08-01")!;
    expect(day1.status).toBe("WEEKLY_OFF");
    const day3 = grid!.days.find((d) => d.date === "2026-08-03")!; // Monday
    expect(day3.status).toBeNull();
    expect(grid!.days).toHaveLength(31);
  });

  it("an explicit record wins over the derived weekly-off status", async () => {
    const records = createInMemoryAttendanceRepository();
    await markAttendance({ id: "r1", employeeId: "emp-1", date: "2026-08-01", status: "PRESENT" }, { records });

    const [grid] = await getMonthlyGrid(["emp-1"], 2026, 8, WEEKEND, { records });
    const day1 = grid!.days.find((d) => d.date === "2026-08-01")!;
    expect(day1.status).toBe("PRESENT");
  });
});

describe("getMonthlySummary", () => {
  it("computes KPIs over the month", async () => {
    const records = createInMemoryAttendanceRepository();
    await markAttendance({ id: "r1", employeeId: "emp-1", date: "2026-08-02", status: "PRESENT", overtimeHours: 2 }, { records });
    await markAttendance({ id: "r2", employeeId: "emp-1", date: "2026-08-03", status: "ABSENT" }, { records });
    await markAttendance({ id: "r3", employeeId: "emp-1", date: "2026-08-04", status: "HALF_DAY" }, { records });
    await markAttendance({ id: "r4", employeeId: "emp-1", date: "2026-08-05", status: "ON_LEAVE" }, { records });
    await markAttendance({ id: "r5", employeeId: "emp-1", date: "2026-08-06", status: "PUBLIC_HOLIDAY" }, { records });

    const summary = await getMonthlySummary("emp-1", 2026, 8, WEEKEND, { records });

    expect(summary.presentDays).toBe(1);
    expect(summary.absentDays).toBe(1);
    expect(summary.halfDays).toBe(1);
    expect(summary.onLeaveDays).toBe(1);
    expect(summary.publicHolidayDays).toBe(1);
    expect(summary.overtimeHours).toBe(2);
    // August 2026 has 31 days, weekend Fri/Sat -> 9 weekend days -> 22 working days.
    expect(summary.workingDays).toBe(22);
    expect(summary.attendanceRate).toBeCloseTo((1 / 22) * 100, 1);
  });

  it("zero working days yields a zero attendance rate, not NaN/division error", async () => {
    const records = createInMemoryAttendanceRepository();
    const summary = await getMonthlySummary("emp-1", 2026, 8, [0, 1, 2, 3, 4, 5, 6], { records });
    expect(summary.workingDays).toBe(0);
    expect(summary.attendanceRate).toBe(0);
  });
});

describe("countPayableDays", () => {
  it("counts present/half/holiday/weekly-off/leave as payable, absent/unmarked as not", async () => {
    const records = createInMemoryAttendanceRepository();
    await markAttendance({ id: "r1", employeeId: "emp-1", date: "2026-08-02", status: "PRESENT" }, { records });
    await markAttendance({ id: "r2", employeeId: "emp-1", date: "2026-08-03", status: "ABSENT" }, { records });
    await markAttendance({ id: "r3", employeeId: "emp-1", date: "2026-08-04", status: "HALF_DAY" }, { records });

    const payable = await countPayableDays("emp-1", 2026, 8, WEEKEND, { records });
    // present(1) + half(0.5) + 9 weekend days(1 each) = 10.5
    expect(payable).toBe(10.5);
  });
});
