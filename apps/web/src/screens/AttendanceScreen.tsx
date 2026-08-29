import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, EmptyState, IconButton, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type { AttendanceEntryDTO, AttendanceStatusDTO } from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import {
  ApiError,
  useAttendance,
  useAttendanceSummary,
  useCorrectAttendance,
  useEmployees,
  useRecordAttendance,
} from "../data/hooks";
import { ATTENDANCE_STATUS_KEY, ATTENDANCE_STATUS_TONE, formatWorkedDuration } from "./hr-leave-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { employeeDisplayName } from "./hr-employee-name";
import { useUrlNumber } from "../lib/url-state";

/** الحضور والانصراف (Attendance) — docs/archive/catalog/06 §"الحضور والانصراف". Per-employee daily check-in/out with a computed worked duration and a day status resolved against the official holiday calendar and approved leave. */

function monthBounds(month: string): { from: string; to: string } {
  const [year, monthPart] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year ?? 1970, monthPart ?? 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function statusOptions(t: (key: AppTranslationKey) => string): Array<{ value: string; label: string }> {
  return [
    { value: "", label: t("attendance.allStatuses") },
    ...(Object.keys(ATTENDANCE_STATUS_KEY) as AttendanceStatusDTO[]).map((code) => ({ value: code, label: t(ATTENDANCE_STATUS_KEY[code]) })),
  ];
}

interface AttendanceDraft {
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  halfDay: boolean;
  expectedCheckIn: string;
  status: string;
  notes: string;
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

function blankDraft(employeeId: string, date: string): AttendanceDraft {
  return { employeeId, date, checkIn: "", checkOut: "", halfDay: false, expectedCheckIn: "", status: "", notes: "" };
}

function EditIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
      <path d="M13.5 3.5 16 6l-8.5 8.5H5V12L13.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AttendanceScreen() {
  const { t, locale } = useAppTranslation();
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const { from, to } = useMemo(() => monthBounds(month), [month]);
  const employeesQuery = useEmployees();
  const employees = employeesQuery.data ?? [];
  const query = useAttendance({ employeeId: employeeId || null, from, to, status: status || null });
  const summaryQuery = useAttendanceSummary(employeeId || null, from, to);
  const recordAttendance = useRecordAttendance();
  const correctAttendance = useCorrectAttendance();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AttendanceDraft>(blankDraft("", `${month}-01`));
  const [formError, setFormError] = useState<string | null>(null);

  const entries = query.data ?? [];
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const pageRows = entries.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);
  const activeFilterCount = (employeeId !== "" ? 1 : 0) + (status !== "" ? 1 : 0);
  const employeeName = (id: string) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee) return id;
    return employeeDisplayName(employee, locale);
  };

  function openCreate() {
    setEditingId(null);
    setDraft(blankDraft(employeeId || (employees[0]?.id ?? ""), `${month}-01`));
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(entry: AttendanceEntryDTO) {
    setEditingId(entry.id);
    setDraft({
      employeeId: entry.employeeId,
      date: entry.date,
      checkIn: entry.checkIn ?? "",
      checkOut: entry.checkOut ?? "",
      halfDay: entry.status === "half_day",
      expectedCheckIn: "",
      status: entry.status,
      notes: entry.notes ?? "",
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.employeeId === "" || draft.date.trim() === "") {
      setFormError(t("attendance.anEmployeeAndADate"));
      return;
    }
    setFormError(null);
    const shared = {
      checkIn: draft.checkIn.trim() === "" ? null : draft.checkIn.trim(),
      checkOut: draft.checkOut.trim() === "" ? null : draft.checkOut.trim(),
      halfDay: draft.halfDay,
      expectedCheckIn: draft.expectedCheckIn.trim() === "" ? null : draft.expectedCheckIn.trim(),
      status: draft.status === "" ? null : (draft.status as AttendanceStatusDTO),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
    };
    try {
      if (editingId) {
        await correctAttendance.mutateAsync({ id: editingId, body: shared });
      } else {
        await recordAttendance.mutateAsync({ employeeId: draft.employeeId, date: draft.date.trim(), ...shared });
      }
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("common.failed"));
    }
  }

  const columns: DocumentListColumn<AttendanceEntryDTO>[] = [
    { key: "date", header: t("common.date"), render: (e) => <span className="mz-num font-semibold text-ink">{e.date}</span> },
    { key: "employee", header: t("attendance.employee"), render: (e) => <span className="font-semibold text-ink">{employeeName(e.employeeId)}</span> },
    { key: "checkIn", header: t("attendance.in"), render: (e) => <span className="mz-num text-ink">{e.checkIn ?? "—"}</span> },
    { key: "checkOut", header: t("attendance.out"), render: (e) => <span className="mz-num text-ink">{e.checkOut ?? "—"}</span> },
    {
      key: "worked",
      header: t("attendance.hoursWorked"),
      align: "end",
      render: (e) => <span className="mz-num text-ink">{formatWorkedDuration(e.workedMinutes)}</span>,
    },
    { key: "status", header: t("common.status"), render: (e) => <StatusPill label={t(ATTENDANCE_STATUS_KEY[e.status])} tone={ATTENDANCE_STATUS_TONE[e.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (e) => (
        <div className="flex items-center justify-end gap-[6px]">
          <IconButton aria-label={t("attendance.editRecordLabel", { date: e.date })} onClick={() => openEdit(e)}>
            <EditIcon />
          </IconButton>
        </div>
      ),
    },
  ];

  const summary = summaryQuery.data;

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("attendance.theAttendanceRecordCouldNot")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<AttendanceEntryDTO>
        title={t("attendance.attendance")}
        description={t("attendance.theDailyAttendanceRecordPer")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("attendance.recordAttendance")}
          </Button>
        }
        listKey="attendance"
        statsCollapsible
        stats={[
          { label: t("attendance.workingDays"), value: <span className="mz-num">{summary?.workingDays ?? 0}</span> },
          { label: t("attendance.daysPresent"), value: <span className="mz-num">{summary?.daysPresent ?? 0}</span> },
          { label: t("attendance.daysLate"), value: <span className="mz-num">{summary?.daysLate ?? 0}</span> },
          { label: t("attendance.daysAbsent"), value: <span className="mz-num">{summary?.daysAbsent ?? 0}</span> },
          { label: t("attendance.attendanceRate"), value: <span className="mz-num">{summary?.attendanceRatePercent ?? 0}%</span> },
        ]}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="min-w-[150px]">
              <TextField
                label={t("attendance.month")}
                value={month}
                onChange={(v) => {
                  setMonth(v);
                  setPage(1);
                }}
                placeholder="YYYY-MM"
              />
            </div>
            <div className="min-w-[190px]">
              <SelectField
                label={t("attendance.employee")}
                value={employeeId}
                onChange={(v) => {
                  setEmployeeId(v);
                  setPage(1);
                }}
                options={[{ value: "", label: t("attendance.allEmployees") }, ...employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))]}
              />
            </div>
            <div className="min-w-[160px]">
              <SelectField
                label={t("common.status")}
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
                options={statusOptions(t)}
              />
            </div>
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={summaryQuery.isLoading}
        rowKey={(e) => e.id}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{entries.length}</span> {t("attendance.records")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("attendance.noAttendanceRecordsForThis")}
            description={t("attendance.emptyBody")}
            action={{ label: t("attendance.recordAttendance"), onClick: openCreate }}
          />
        }
      />

      {employeeId !== "" && summary ? (
        <Card className="mt-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-ink">{t("attendance.monthlyAttendanceSummary")}</p>
          <div className="mt-[10px] grid grid-cols-2 gap-[10px] text-[12.5px] text-ink-muted sm:grid-cols-4">
            <div>
              {t("attendance.halfDays")} <span className="mz-num text-ink">{summary.halfDays}</span>
            </div>
            <div>
              {t("attendance.leaveDays")} <span className="mz-num text-ink">{summary.daysOnLeave}</span>
            </div>
            <div>
              {t("attendance.publicHolidays")} <span className="mz-num text-ink">{summary.holidays}</span>
            </div>
            <div>
              {t("attendance.hoursWorked2")} <span className="mz-num text-ink">{formatWorkedDuration(summary.workedMinutes)}</span>
            </div>
          </div>
        </Card>
      ) : null}

      <SidePanel
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
        }}
        title={editingId ? t("attendance.editAttendanceRecord") : t("attendance.recordAttendance")}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label={t("attendance.employee2")}
            value={draft.employeeId}
            onChange={(v) => setDraft((d) => ({ ...d, employeeId: v }))}
            options={employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))}
            disabled={editingId !== null}
          />
          <TextField
            label={t("attendance.date")}
            value={draft.date}
            onChange={(v) => setDraft((d) => ({ ...d, date: v }))}
            placeholder="YYYY-MM-DD"
            disabled={editingId !== null}
          />
          <TextField label={t("attendance.timeIn")} value={draft.checkIn} onChange={(v) => setDraft((d) => ({ ...d, checkIn: v }))} placeholder="09:00" />
          <TextField label={t("attendance.timeOut")} value={draft.checkOut} onChange={(v) => setDraft((d) => ({ ...d, checkOut: v }))} placeholder="17:00" />
          <TextField
            label={t("attendance.shiftStart")}
            value={draft.expectedCheckIn}
            onChange={(v) => setDraft((d) => ({ ...d, expectedCheckIn: v }))}
            placeholder="09:00"
            hint={t("attendance.leaveEmptyIfThereIs")}
          />
          <ToggleField label={t("attendance.halfDay")} checked={draft.halfDay} onChange={(v) => setDraft((d) => ({ ...d, halfDay: v }))} />
          <SelectField
            label={t("attendance.overrideStatus")}
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
            options={[{ value: "", label: t("attendance.computedAutomatically") }, ...statusOptions(t).slice(1)]}
            hint={t("attendance.theAutomaticCalculationAccountsFor")}
          />
          <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? t("attendance.saveChanges") : t("attendance.record")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
