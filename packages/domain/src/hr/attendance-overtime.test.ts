import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { AttendanceEntry } from "./attendance.js";
import type { Holiday } from "./holiday.js";
import { summarizeOvertime, employeeOvertimePolicy, createOvertimeHoursProvider, type OvertimeDerivationOptions } from "./attendance-overtime.js";
import { overtimePay } from "./statutory-payroll.js";
import { EGYPT_OVERTIME_TABLES, resolveOvertimeTable, type OvertimeTable } from "./egypt-statutory.js";

function day(date: string, overrides: Partial<AttendanceEntry> = {}): AttendanceEntry {
  return {
    id: `att-${date}`,
    employeeId: "emp-1",
    date,
    checkIn: "09:00",
    checkOut: "17:00",
    workedMinutes: 480,
    approvedOvertimeMinutes: null,
    holidayCompensation: "pay",
    status: "present",
    notes: null,
    createdAt: `${date}T17:00:00.000Z`,
    updatedAt: `${date}T17:00:00.000Z`,
    ...overrides,
  };
}

function holiday(date: string): Holiday {
  return { id: `h-${date}`, date, nameEn: "Holiday", nameAr: "عطلة", recurringAnnual: false, createdAt: "2026-01-01T00:00:00.000Z" };
}

const WAGE = { monthlyWage: Money.fromMajor("9000"), dayDivisor: 30, standardDailyHours: 8 };
const MARCH_HOLIDAY = holiday("2026-03-09");
const OPTIONS: OvertimeDerivationOptions = { standardDailyHours: 8, weeklyOffDays: [5, 6], holidays: [MARCH_HOLIDAY] };

function priced(entries: AttendanceEntry[], options: OvertimeDerivationOptions = OPTIONS, from = "2026-03-01", to = "2026-03-31") {
  const worked = summarizeOvertime(entries, options, from, to);
  return { worked, lines: overtimePay({ ...WAGE, standardDailyHours: worked.standardDailyHours }, worked) };
}

describe("D186 — a weekday, a weekly rest day and an official holiday are priced differently", () => {
  it("weekday overtime is the hourly rate plus 35% by day", () => {
    const { lines } = priced([day("2026-03-03", { workedMinutes: 600, checkOut: "19:00", approvedOvertimeMinutes: 120 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe("day");
    expect(lines[0]!.amount.toString()).toBe("101.250000");
    expect(lines[0]!.tableCode).toBe("EG_OVERTIME_14_2025");
  });

  it("weekday overtime that starts after the standard day ends at night is plus 70%", () => {
    const { lines } = priced([day("2026-03-03", { checkIn: "14:00", checkOut: "00:00", workedMinutes: 600, approvedOvertimeMinutes: 120 })]);
    expect(lines.map((l) => [l.kind, l.amount.toString()])).toEqual([["night", "127.500000"]]);
  });

  it("a worked weekly rest day earns ONE more day's wage («مثل أجره»), not twice the hourly rate", () => {
    const { lines, worked } = priced([day("2026-03-06", { status: "weekly_off", approvedOvertimeMinutes: 480 })]);
    expect(worked.byTable[0]!.restDays).toBe(1);
    expect(lines.map((l) => [l.kind, l.amount.toString()])).toEqual([["rest_day", "300.000000"]]);
  });

  it("a worked official holiday earns TWICE the day's wage on top of its own pay («مثلي هذا الأجر»)", () => {
    const { lines } = priced([day("2026-03-09", { approvedOvertimeMinutes: 480 })]);
    expect(lines.map((l) => [l.kind, l.amount.toString()])).toEqual([["holiday", "600.000000"]]);
  });

  it("time beyond the standard day on a rest day is ordinary overtime on top of the day's compensation", () => {
    const { lines } = priced([day("2026-03-06", { checkOut: "19:00", workedMinutes: 600, approvedOvertimeMinutes: 600 })]);
    expect(lines.map((l) => [l.kind, l.amount.toString()])).toEqual([
      ["day", "101.250000"],
      ["rest_day", "300.000000"],
    ]);
  });

  it("a holiday that falls on a weekly rest day is priced as the holiday", () => {
    const { lines } = priced([day("2026-03-06", { approvedOvertimeMinutes: 480 })], { ...OPTIONS, holidays: [holiday("2026-03-06")] });
    expect(lines.map((l) => l.kind)).toEqual(["holiday"]);
  });

  describe("the replacement rest day («يوماً آخر عوضاً عنه خلال الأسبوع التالي»)", () => {
    const worked = day("2026-03-06", { approvedOvertimeMinutes: 480 });

    it("a worked rest day with no راحة بديلة recorded is outstanding, due within seven days", () => {
      expect(priced([worked]).worked.outstandingReplacementDays).toEqual([{ workedOn: "2026-03-06", kind: "rest_day", dueBy: "2026-03-13" }]);
    });

    it("a راحة بديلة within the following week settles it", () => {
      const off = day("2026-03-11", { status: "compensatory_off", checkIn: null, checkOut: null, workedMinutes: 0 });
      expect(priced([worked, off]).worked.outstandingReplacementDays).toEqual([]);
    });

    it("a راحة بديلة after the week has passed does not", () => {
      const late = day("2026-03-16", { status: "compensatory_off", checkIn: null, checkOut: null, workedMinutes: 0 });
      expect(priced([worked, late]).worked.outstandingReplacementDays).toHaveLength(1);
    });

    it("one replacement day settles only one worked rest day", () => {
      const second = day("2026-03-07", { approvedOvertimeMinutes: 480 });
      const off = day("2026-03-10", { status: "compensatory_off", checkIn: null, checkOut: null, workedMinutes: 0 });
      expect(priced([worked, second, off]).worked.outstandingReplacementDays.map((d) => d.workedOn)).toEqual(["2026-03-07"]);
    });

    it("a replacement day that falls after the period still settles a rest day worked at its end", () => {
      const lastFriday = day("2026-03-27", { approvedOvertimeMinutes: 480 });
      const off = day("2026-04-01", { status: "compensatory_off", checkIn: null, checkOut: null, workedMinutes: 0 });
      const result = priced([lastFriday, off]);
      expect(result.worked.outstandingReplacementDays).toEqual([]);
      expect(result.lines.map((l) => l.kind)).toEqual(["rest_day"]);
    });
  });

  describe("a holiday taken as a substitute day off on the worker's written request (Law 14/2025 Art. 129)", () => {
    const elected = day("2026-03-09", { approvedOvertimeMinutes: 480, holidayCompensation: "day_off" });

    it("pays no premium and owes a replacement day instead", () => {
      const { lines, worked } = priced([elected]);
      expect(lines).toEqual([]);
      expect(worked.holidaysTakenAsDayOff).toBe(1);
      expect(worked.outstandingReplacementDays).toEqual([{ workedOn: "2026-03-09", kind: "holiday", dueBy: null }]);
    });

    it("is settled by a راحة بديلة recorded later", () => {
      const off = day("2026-03-19", { status: "compensatory_off", checkIn: null, checkOut: null, workedMinutes: 0 });
      expect(priced([elected, off]).worked.outstandingReplacementDays).toEqual([]);
    });

    it("under Law 12/2003 (before 1 September 2025) the option does not exist, so the premium is paid and the refusal is reported", () => {
      const old = day("2025-04-21", { approvedOvertimeMinutes: 480, holidayCompensation: "day_off" });
      const { lines, worked } = priced([old], { ...OPTIONS, holidays: [holiday("2025-04-21")] }, "2025-04-01", "2025-04-30");
      expect(lines.map((l) => [l.kind, l.tableCode, l.amount.toString()])).toEqual([["holiday", "EG_OVERTIME_12_2003", "600.000000"]]);
      expect(worked.substituteDayRefusedOn).toEqual(["2025-04-21"]);
      expect(worked.holidaysTakenAsDayOff).toBe(0);
    });
  });

  it("the dated rows: 12/2003 until its repeal, 14/2025 from 1 September 2025, both citing their articles and unverified", () => {
    const [old, current] = EGYPT_OVERTIME_TABLES;
    expect(old!.effectiveTo).toBe("2025-08-31");
    expect(current!.effectiveFrom).toBe("2025-09-01");
    expect(resolveOvertimeTable("2025-08-31").code).toBe("EG_OVERTIME_12_2003");
    expect(resolveOvertimeTable("2025-09-01").code).toBe("EG_OVERTIME_14_2025");
    for (const table of EGYPT_OVERTIME_TABLES) {
      expect(table.verified).toBe(false);
      expect(table.restDayExtraDayWageBp).toBe(10_000);
      expect(table.holidayExtraDayWageBp).toBe(20_000);
      expect(table.restDayReplacementWithinDays).toBe(7);
    }
    expect(old!.citationAr).toMatch(/المادة 85/);
    expect(old!.citationAr).toMatch(/المادة 52/);
    expect(old!.holidaySubstituteDayAllowed).toBe(false);
    expect(current!.citationAr).toMatch(/المادة 121/);
    expect(current!.citationAr).toMatch(/المادة 129/);
    expect(current!.holidaySubstituteDayAllowed).toBe(true);
    expect(current!.citationAr).not.toMatch(/بالمثل/);
  });
});

describe("D187 — only approved overtime pays, only for eligible staff, from the employee's own standard day", () => {
  const clockedOvertime = day("2026-03-03", { checkOut: "19:00", workedMinutes: 600 });

  it("clock time alone pays nothing by default", () => {
    expect(priced([clockedOvertime]).lines).toEqual([]);
  });

  it("a tenant that opts out of approval is paid the clock's overtime", () => {
    expect(priced([clockedOvertime], { ...OPTIONS, requireApproval: false }).lines.map((l) => l.amount.toString())).toEqual(["101.250000"]);
  });

  it("an approval of zero pays nothing even without the approval rule", () => {
    expect(priced([{ ...clockedOvertime, approvedOvertimeMinutes: 0 }], { ...OPTIONS, requireApproval: false }).lines).toEqual([]);
  });

  it("a rest day worked on the clock alone is not compensated until it is approved", () => {
    expect(priced([day("2026-03-06")]).lines).toEqual([]);
  });

  it("an ineligible employee is paid no hourly overtime, but still the statutory rest-day compensation", () => {
    const { lines, worked } = priced(
      [{ ...clockedOvertime, approvedOvertimeMinutes: 120 }, day("2026-03-06", { approvedOvertimeMinutes: 480 })],
      { ...OPTIONS, overtimeEligible: false },
    );
    expect(lines.map((l) => l.kind)).toEqual(["rest_day"]);
    expect(worked.ineligibleHours).toBe(2);
    expect(worked.overtimeEligible).toBe(false);
  });

  it("a department's seven-hour day starts overtime after seven hours and divides the hourly rate by seven", () => {
    const { lines } = priced([day("2026-03-03", { workedMinutes: 480, approvedOvertimeMinutes: 60 })], { ...OPTIONS, standardDailyHours: 7 });
    expect(lines.map((l) => l.amount.toString())).toEqual(["57.860000"]);
    const derived = summarizeOvertime([day("2026-03-03", { workedMinutes: 480 })], { ...OPTIONS, standardDailyHours: 7, requireApproval: false });
    expect(derived.byTable[0]!.day).toBe(1);
  });

  describe("employeeOvertimePolicy — employee, then department, then company", () => {
    const department = { overtimeEligible: false, standardWorkHours: 7 };

    it("inherits the department's eligibility and hours", () => {
      expect(employeeOvertimePolicy({ overtimeEligibility: "inherit_department", standardWorkHours: null }, department, 8)).toEqual({
        standardDailyHours: 7,
        overtimeEligible: false,
      });
    });

    it("the employee's own setting overrides the department's", () => {
      expect(employeeOvertimePolicy({ overtimeEligibility: "eligible", standardWorkHours: 6 }, department, 8)).toEqual({ standardDailyHours: 6, overtimeEligible: true });
      expect(employeeOvertimePolicy({ overtimeEligibility: "not_eligible", standardWorkHours: null }, { overtimeEligible: true, standardWorkHours: null }, 8)).toEqual({
        standardDailyHours: 8,
        overtimeEligible: false,
      });
    });

    it("with no department, the company's day and eligible", () => {
      expect(employeeOvertimePolicy({ overtimeEligibility: "inherit_department", standardWorkHours: null }, null, 9)).toEqual({ standardDailyHours: 9, overtimeEligible: true });
    });
  });
});

describe("D188 — each attendance day is priced by the table in force on that day", () => {
  const before: OvertimeTable = { ...EGYPT_OVERTIME_TABLES[1]!, code: "TEST_BEFORE", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-14" };
  const after: OvertimeTable = { ...EGYPT_OVERTIME_TABLES[1]!, code: "TEST_AFTER", effectiveFrom: "2026-06-15", effectiveTo: null, dayPremiumBp: 5000 };
  const tableFor = (date: string) => resolveOvertimeTable(date, [before, after]);

  it("a table change mid-period splits the period's overtime between the two tables", () => {
    const entries = [day("2026-06-10", { approvedOvertimeMinutes: 60 }), day("2026-06-17", { approvedOvertimeMinutes: 60 })];
    const { lines, worked } = priced(entries, { ...OPTIONS, tableFor }, "2026-06-01", "2026-06-30");
    expect(worked.byTable.map((b) => [b.table.code, b.day])).toEqual([
      ["TEST_BEFORE", 1],
      ["TEST_AFTER", 1],
    ]);
    expect(lines.map((l) => [l.tableCode, l.amount.toString()])).toEqual([
      ["TEST_BEFORE", "50.630000"],
      ["TEST_AFTER", "56.250000"],
    ]);
  });

  it("a period across 1 September 2025 prices August by Law 12/2003 and September by Law 14/2025", () => {
    const entries = [day("2025-08-27", { approvedOvertimeMinutes: 60 }), day("2025-09-03", { approvedOvertimeMinutes: 60 })];
    const worked = summarizeOvertime(entries, OPTIONS, "2025-08-16", "2025-09-15");
    expect(worked.byTable.map((b) => b.table.code)).toEqual(["EG_OVERTIME_12_2003", "EG_OVERTIME_14_2025"]);
  });

  it("the live provider reads a week either side of the period and pays only the period", async () => {
    const rows = [day("2026-05-29", { approvedOvertimeMinutes: 480 }), day("2026-06-03", { approvedOvertimeMinutes: 60 }), day("2026-07-02", { status: "compensatory_off" })];
    const seen: unknown[] = [];
    const provider = createOvertimeHoursProvider(
      {
        async list(filter) {
          seen.push(filter);
          return rows.filter((r) => (!filter?.from || r.date >= filter.from) && (!filter?.to || r.date <= filter.to));
        },
      },
      () => OPTIONS,
    );
    const worked = await provider.overtimeHoursFor("emp-1", "2026-06-01", "2026-06-30");
    expect(seen).toEqual([{ employeeId: "emp-1", from: "2026-05-25", to: "2026-07-07" }]);
    expect(worked.byTable.map((b) => [b.day, b.restDays])).toEqual([[1, 0]]);
  });
});
