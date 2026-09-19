import { useMemo } from "react";
import { Card, EmptyState, StatusPill } from "@mezan/ui";
import type { AttendanceEntryDTO, AttendanceStatusDTO, EmployeeDTO } from "@mezan/contracts";
import { ATTENDANCE_GRID_CODE, ATTENDANCE_STATUS_KEY, ATTENDANCE_STATUS_TONE, formatWorkedDuration } from "./hr-leave-labels";
import { employeeDisplayName } from "./hr-employee-name";
import { useAppTranslation } from "../i18n";

/**
 * الحضور الشهري (monthly attendance grid) — employee × day matrix, the
 * ZenHR/Odoo-Attendances/Bayzat shape docs/superpowers's HR gap analysis (task
 * 13) calls out as missing. Every cell carries BOTH the status colour and its
 * text code (never colour alone), opens the existing attendance edit for that
 * day on click, and the whole table lives in its own horizontally-scrolling
 * box with a sticky employee column, so it works at phone width.
 */

const STATUS_ORDER: readonly AttendanceStatusDTO[] = ["present", "late", "half_day", "absent", "on_leave", "holiday", "weekly_off", "compensatory_off"];

function daysInMonth(month: string): number {
  const [year, monthPart] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, monthPart ?? 1, 0)).getUTCDate();
}

function dateOf(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

function isWeekendColumn(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6; // Friday/Saturday — the default Egyptian weekend.
}

interface EmployeeMonthTotals {
  daysPresent: number;
  absences: number;
  leaveDays: number;
  overtimeMinutes: number;
}

function emptyTotals(): EmployeeMonthTotals {
  return { daysPresent: 0, absences: 0, leaveDays: 0, overtimeMinutes: 0 };
}

export interface AttendanceGridProps {
  /** "YYYY-MM" */
  month: string;
  employees: readonly Pick<EmployeeDTO, "id" | "firstName" | "lastName" | "firstNameAr" | "lastNameAr">[];
  /** Every attendance entry for the visible month, across every employee shown (not pre-filtered by employee). */
  entries: readonly AttendanceEntryDTO[];
  loading?: boolean;
  /** Absent = read-only (the self-service row); cells then show the day without opening an editor. */
  onCellClick?: (employeeId: string, date: string, entry: AttendanceEntryDTO | null) => void;
}

export function AttendanceGrid({ month, employees, entries, loading, onCellClick }: AttendanceGridProps) {
  const { t, locale } = useAppTranslation();
  const dayCount = daysInMonth(month);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);

  const entryByKey = useMemo(() => {
    const map = new Map<string, AttendanceEntryDTO>();
    for (const entry of entries) map.set(`${entry.employeeId}|${entry.date}`, entry);
    return map;
  }, [entries]);

  const totalsByEmployee = useMemo(() => {
    const totals = new Map<string, EmployeeMonthTotals>();
    for (const entry of entries) {
      const bucket = totals.get(entry.employeeId) ?? emptyTotals();
      if (entry.status === "present" || entry.status === "late") bucket.daysPresent += 1;
      else if (entry.status === "absent") bucket.absences += 1;
      else if (entry.status === "on_leave") bucket.leaveDays += 1;
      if (entry.approvedOvertimeMinutes !== null) bucket.overtimeMinutes += entry.approvedOvertimeMinutes;
      totals.set(entry.employeeId, bucket);
    }
    return totals;
  }, [entries]);

  if (!loading && employees.length === 0) {
    return (
      <EmptyState
        title={t("attendance.grid.noEmployees")}
        description={t("attendance.grid.noEmployeesBody")}
      />
    );
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-[10px] border-b border-border px-[16px] py-[10px]">
        <span className="text-[11.5px] font-semibold text-ink-muted">{t("attendance.grid.legend")}</span>
        {STATUS_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-[5px]">
            <StatusPill label={ATTENDANCE_GRID_CODE[status]} tone={ATTENDANCE_STATUS_TONE[status]} />
            <span className="text-[11.5px] text-ink-muted">{t(ATTENDANCE_STATUS_KEY[status])}</span>
          </span>
        ))}
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-ink-faint">
              <th className="sticky start-0 z-10 min-w-[160px] bg-surface-2 px-[12px] py-[8px] text-start font-semibold">
                {t("attendance.employee")}
              </th>
              {days.map((day) => {
                const date = dateOf(month, day);
                return (
                  <th
                    key={day}
                    className={`mz-num min-w-[30px] px-[2px] py-[8px] text-center font-semibold ${isWeekendColumn(date) ? "bg-surface-3" : ""}`}
                  >
                    {day}
                  </th>
                );
              })}
              <th className="mz-num min-w-[70px] px-[8px] py-[8px] text-center font-semibold">{t("attendance.grid.daysPresent")}</th>
              <th className="mz-num min-w-[70px] px-[8px] py-[8px] text-center font-semibold">{t("attendance.grid.absences")}</th>
              <th className="mz-num min-w-[70px] px-[8px] py-[8px] text-center font-semibold">{t("attendance.grid.leave")}</th>
              <th className="mz-num min-w-[80px] px-[8px] py-[8px] text-center font-semibold">{t("attendance.grid.overtimeHours")}</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => {
              const totals = totalsByEmployee.get(employee.id) ?? emptyTotals();
              const name = employeeDisplayName(employee, locale);
              return (
                <tr key={employee.id} className="border-b border-border last:border-b-0 hover:bg-surface-2">
                  <td className="sticky start-0 z-10 min-w-[160px] bg-surface px-[12px] py-[6px] font-semibold text-ink">{name}</td>
                  {days.map((day) => {
                    const date = dateOf(month, day);
                    const entry = entryByKey.get(`${employee.id}|${date}`) ?? null;
                    const weekend = isWeekendColumn(date);
                    return (
                      <td key={day} className={`px-[2px] py-[4px] text-center ${weekend ? "bg-surface-3/40" : ""}`}>
                        {onCellClick ? (
                          <button
                            type="button"
                            onClick={() => onCellClick(employee.id, date, entry)}
                            title={entry ? `${t(ATTENDANCE_STATUS_KEY[entry.status])}${entry.checkIn ? ` — ${entry.checkIn}${entry.checkOut ? `-${entry.checkOut}` : ""}` : ""}` : t("attendance.grid.noRecordForDay")}
                            aria-label={t("attendance.grid.cellLabel", { name, date })}
                            className="mx-auto flex h-[22px] w-[26px] items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <GridCell entry={entry} />
                          </button>
                        ) : (
                          <span
                            title={entry ? `${t(ATTENDANCE_STATUS_KEY[entry.status])}${entry.checkIn ? ` — ${entry.checkIn}${entry.checkOut ? `-${entry.checkOut}` : ""}` : ""}` : t("attendance.grid.noRecordForDay")}
                            className="mx-auto flex h-[22px] w-[26px] items-center justify-center"
                          >
                            <GridCell entry={entry} />
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="mz-num px-[8px] py-[6px] text-center text-ink">{totals.daysPresent}</td>
                  <td className="mz-num px-[8px] py-[6px] text-center text-ink">{totals.absences}</td>
                  <td className="mz-num px-[8px] py-[6px] text-center text-ink">{totals.leaveDays}</td>
                  <td className="mz-num px-[8px] py-[6px] text-center text-ink">{formatWorkedDuration(totals.overtimeMinutes)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GridCell({ entry }: { entry: AttendanceEntryDTO | null }) {
  return entry ? (
    <StatusPill label={ATTENDANCE_GRID_CODE[entry.status]} tone={ATTENDANCE_STATUS_TONE[entry.status]} className="px-[5px] py-[1px] text-[10px]" />
  ) : (
    <span className="text-[11px] text-ink-faint">·</span>
  );
}
