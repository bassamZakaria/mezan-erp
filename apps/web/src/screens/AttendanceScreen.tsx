import { useMemo, useState, type FormEvent } from "react";
import { Card, Button, SidePanel, cn } from "@mezan/ui";
import type { AttendanceDayStatusDTO, AttendanceStatusDTO, MarkAttendanceDTO } from "@mezan/contracts";
import { ApiError, useAttendanceGrid, useAttendanceSummary, useHrEmployeesRef, useMarkAttendance } from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";

/**
 * الحضور والانصراف — Attendance (docs/catalog/06-crm-hr.md §"الحضور
 * والانصراف"). The one HR screen using a calendar/matrix grid rather than the
 * standard `<DocumentList>` list+filter+table pattern — nothing in
 * `@mezan/ui` fits a rows=employees × columns=days-of-month layout, so this
 * builds the grid directly.
 */

const STATUS_CODE: Record<AttendanceDayStatusDTO, string> = {
  PRESENT: "P",
  ABSENT: "A",
  HALF_DAY: "H",
  ON_LEAVE: "L",
  PUBLIC_HOLIDAY: "HO",
  WEEKLY_OFF: "—",
};
const STATUS_LABEL: Record<AttendanceStatusDTO, string> = {
  PRESENT: "حاضر",
  ABSENT: "غائب",
  HALF_DAY: "نصف يوم",
  ON_LEAVE: "في إجازة",
  PUBLIC_HOLIDAY: "إجازة رسمية",
};
const MARKABLE_STATUSES: AttendanceStatusDTO[] = ["PRESENT", "ABSENT", "HALF_DAY", "ON_LEAVE", "PUBLIC_HOLIDAY"];
/** Reuses `StatusPill`'s exact tone→class combos (packages/ui/src/primitives/atoms.tsx's `pillToneClass`) rather than inventing new color pairings. */
const STATUS_CLASS: Record<AttendanceDayStatusDTO, string> = {
  PRESENT: "bg-success-soft text-success-ink",
  ABSENT: "bg-danger-soft text-danger-ink",
  HALF_DAY: "bg-warning-soft text-warning-ink",
  ON_LEAVE: "bg-info-soft text-info-ink",
  PUBLIC_HOLIDAY: "bg-surface-3 text-ink-muted",
  WEEKLY_OFF: "bg-surface-3 text-ink-faint",
};

function today(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function AttendanceScreen() {
  const [{ year, month }, setPeriod] = useState(today());
  const [search, setSearch] = useState("");

  const employeesQuery = useHrEmployeesRef();
  const gridQuery = useAttendanceGrid(year, month);
  const markAttendance = useMarkAttendance();

  const employees = employeesQuery.data ?? [];
  const grid = gridQuery.data ?? [];

  const [markCell, setMarkCell] = useState<{ employeeId: string; date: string } | null>(null);
  const [markStatus, setMarkStatus] = useState<AttendanceStatusDTO>("PRESENT");
  const [markOvertime, setMarkOvertime] = useState("0");
  const [markNotes, setMarkNotes] = useState("");
  const [markError, setMarkError] = useState<string | null>(null);

  const [summaryEmployeeId, setSummaryEmployeeId] = useState<string | null>(null);
  const summaryQuery = useAttendanceSummary(summaryEmployeeId, year, month);

  const days = useMemo(() => Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1), [year, month]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim();
    if (!term) return employees;
    return employees.filter((e) => e.nameAr.includes(term) || e.code.includes(term));
  }, [employees, search]);

  const gridByEmployee = useMemo(() => {
    const map = new Map<string, Map<string, AttendanceDayStatusDTO | null>>();
    for (const row of grid) {
      map.set(row.employeeId, new Map(row.days.map((d) => [d.date, d.status])));
    }
    return map;
  }, [grid]);

  function goToMonth(delta: number) {
    setPeriod(({ year: y, month: m }) => {
      const date = new Date(Date.UTC(y, m - 1 + delta, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
    });
  }

  function dateFor(day: number): string {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function openMark(employeeId: string, date: string, current: AttendanceDayStatusDTO | null) {
    setMarkCell({ employeeId, date });
    setMarkStatus(current && current !== "WEEKLY_OFF" ? current : "PRESENT");
    setMarkOvertime("0");
    setMarkNotes("");
    setMarkError(null);
  }

  async function handleMarkSubmit(event: FormEvent) {
    event.preventDefault();
    if (!markCell) return;
    const overtimeHours = Number(markOvertime);
    if (Number.isNaN(overtimeHours) || overtimeHours < 0) {
      setMarkError("ساعات العمل الإضافي غير صحيحة.");
      return;
    }
    const body: MarkAttendanceDTO = {
      employeeId: markCell.employeeId,
      date: markCell.date,
      status: markStatus,
      overtimeHours,
      notes: markNotes.trim() === "" ? null : markNotes.trim(),
    };
    try {
      await markAttendance.mutateAsync(body);
      setMarkCell(null);
    } catch (err) {
      setMarkError(err instanceof ApiError ? err.message : "تعذّر تسجيل الحضور.");
    }
  }

  const summaryEmployee = summaryEmployeeId ? employees.find((e) => e.id === summaryEmployeeId) ?? null : null;
  const summary = summaryQuery.data ?? null;

  return (
    <div className="w-full">
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-[12px]">
        <div>
          <h1 className="font-display text-[19px] font-bold text-ink">الحضور والانصراف</h1>
          <p className="mt-[4px] text-[13px] text-ink-muted">
            P=حاضر · A=غائب · H=نصف يوم · L=في إجازة · HO=إجازة رسمية · —=إجازة أسبوعية
          </p>
        </div>
        <div className="flex items-center gap-[10px]">
          <Button size="sm" onClick={() => goToMonth(-1)} aria-label="الشهر السابق">◀</Button>
          <span className="mz-num min-w-[110px] text-center text-[13px] font-semibold text-ink">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <Button size="sm" onClick={() => goToMonth(1)} aria-label="الشهر التالي">▶</Button>
        </div>
      </div>

      <Card className="mb-[14px] p-[12px_14px]">
        <TextField label="بحث" placeholder="ابحث باسم الموظف أو الرقم..." value={search} onChange={setSearch} />
      </Card>

      {gridQuery.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل جدول الحضور.</p>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead className="bg-surface-2 text-ink-faint">
            <tr>
              <th className="sticky start-0 z-10 min-w-[180px] bg-surface-2 p-[8px_10px] text-start font-semibold">الموظف</th>
              {days.map((day) => (
                <th key={day} className="mz-num min-w-[30px] p-[6px_4px] text-center font-semibold">
                  {day}
                </th>
              ))}
              <th className="min-w-[140px] p-[8px_10px]" />
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map((employee) => {
              const employeeDays = gridByEmployee.get(employee.id);
              return (
                <tr key={employee.id} className="border-t border-border">
                  <td className="sticky start-0 z-10 bg-surface p-[8px_10px] font-semibold text-ink">
                    {employee.nameAr} <span className="mz-num text-ink-faint">({employee.code})</span>
                  </td>
                  {days.map((day) => {
                    const date = dateFor(day);
                    const status = employeeDays?.get(date) ?? null;
                    return (
                      <td key={day} className="border-s border-border p-[2px] text-center">
                        <button
                          type="button"
                          onClick={() => openMark(employee.id, date, status)}
                          className={cn(
                            "mz-num h-[26px] w-full rounded text-[11px] font-bold transition-colors",
                            status ? STATUS_CLASS[status] : "text-ink-faint hover:bg-surface-3",
                          )}
                          aria-label={`${employee.nameAr} — ${date}`}
                        >
                          {status ? STATUS_CODE[status] : "+"}
                        </button>
                      </td>
                    );
                  })}
                  <td className="p-[8px_10px] text-end">
                    <Button size="sm" onClick={() => setSummaryEmployeeId(employee.id)}>
                      عرض الملخص الشهري
                    </Button>
                  </td>
                </tr>
              );
            })}
            {filteredEmployees.length === 0 ? (
              <tr>
                <td colSpan={days.length + 2} className="p-[24px] text-center text-ink-muted">
                  لا توجد بيانات
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <SidePanel
        open={markCell !== null}
        onClose={() => setMarkCell(null)}
        title={markCell ? `تسجيل حضور — ${markCell.date}` : ""}
      >
        {markCell ? (
          <form onSubmit={handleMarkSubmit} className="flex flex-col gap-[14px]">
            {markError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {markError}
              </div>
            ) : null}
            <SelectField
              label="الحالة *"
              value={markStatus}
              onChange={(v) => setMarkStatus(v as AttendanceStatusDTO)}
              options={MARKABLE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
            <TextField label="ساعات العمل الإضافي" value={markOvertime} onChange={setMarkOvertime} type="text" />
            <TextField label="ملاحظات" value={markNotes} onChange={setMarkNotes} />
            <div className="mt-[6px] flex justify-end gap-[9px]">
              <Button type="button" onClick={() => setMarkCell(null)}>
                إلغاء
              </Button>
              <Button type="submit" variant="primary">
                حفظ
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>

      <SidePanel
        open={summaryEmployeeId !== null}
        onClose={() => setSummaryEmployeeId(null)}
        title={summaryEmployee ? `الملخص الشهري — ${summaryEmployee.nameAr}` : "الملخص الشهري للحضور"}
      >
        {summary ? (
          <div className="grid grid-cols-2 gap-[10px]">
            <SummaryTile label="أيام العمل" value={summary.workingDays} />
            <SummaryTile label="أيام الحضور" value={summary.presentDays} />
            <SummaryTile label="أيام الغياب" value={summary.absentDays} />
            <SummaryTile label="أنصاف الأيام" value={summary.halfDays} />
            <SummaryTile label="ساعات إضافية" value={`${summary.overtimeHours}س`} />
            <SummaryTile label="نسبة الحضور" value={`${summary.attendanceRate}%`} />
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted">جارٍ التحميل...</p>
        )}
      </SidePanel>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-[12px_14px]">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mz-num mt-[5px] text-[16px] font-bold text-ink">{value}</div>
    </Card>
  );
}
