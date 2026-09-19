import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button, Card, DocumentList, EmptyState, IconButton, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type {
  AttendanceEntryDTO,
  AttendanceImportCommitResultDTO,
  AttendanceImportIssueDTO,
  AttendanceImportPreviewDTO,
  AttendanceStatusDTO,
  HolidayWorkCompensationDTO,
} from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import {
  ApiError,
  useAttendance,
  useAttendanceImportCommit,
  useAttendanceImportPreview,
  useAttendanceSummary,
  useBranches,
  useCorrectAttendance,
  useDepartments,
  useEmployees,
  useRecordAttendance,
} from "../data/hooks";
import { ATTENDANCE_STATUS_KEY, ATTENDANCE_STATUS_TONE, formatWorkedDuration } from "./hr-leave-labels";
import { AttendanceGrid } from "./AttendanceGrid";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { bilingualName, employeeDisplayName } from "./hr-employee-name";
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

const IMPORT_ISSUE_KEY: Record<AttendanceImportIssueDTO, AppTranslationKey> = {
  unmatched_badge: "attendance.import.issue.unmatched_badge",
  odd_punch_count: "attendance.import.issue.odd_punch_count",
  single_punch: "attendance.import.issue.single_punch",
  already_recorded: "attendance.import.issue.already_recorded",
};

interface AttendanceDraft {
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  halfDay: boolean;
  expectedCheckIn: string;
  status: string;
  notes: string;
  /** Blank = no approval recorded, which is NOT the same as an approved zero. */
  approvedOvertimeMinutes: string;
  holidayCompensation: HolidayWorkCompensationDTO;
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

function blankDraft(employeeId: string, date: string): AttendanceDraft {
  return { employeeId, date, checkIn: "", checkOut: "", halfDay: false, expectedCheckIn: "", status: "", notes: "", approvedOvertimeMinutes: "", holidayCompensation: "pay" };
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
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [gridBranchFilter, setGridBranchFilter] = useState("all");
  const [gridDepartmentFilter, setGridDepartmentFilter] = useState("all");

  const { from, to } = useMemo(() => monthBounds(month), [month]);
  const employeesQuery = useEmployees();
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const query = useAttendance({ employeeId: employeeId || null, from, to, status: status || null });
  const summaryQuery = useAttendanceSummary(employeeId || null, from, to);
  const recordAttendance = useRecordAttendance();
  const correctAttendance = useCorrectAttendance();
  const branchesQuery = useBranches();
  const departmentsQuery = useDepartments();
  // The grid always shows the whole workforce for the month, independent of
  // the list's employee/status filters — it has its own branch/department
  // filters instead. When those list filters are blank the query key matches
  // `query` above exactly, so React Query serves both from one fetch.
  const gridQuery = useAttendance({ employeeId: null, from, to, status: null });
  const gridEmployees = useMemo(() => {
    let rows = employees;
    if (gridBranchFilter !== "all") rows = rows.filter((e) => e.branchId === gridBranchFilter);
    if (gridDepartmentFilter !== "all") rows = rows.filter((e) => e.departmentId === gridDepartmentFilter);
    return rows;
  }, [employees, gridBranchFilter, gridDepartmentFilter]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AttendanceDraft>(blankDraft("", `${month}-01`));
  const [formError, setFormError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importFileError, setImportFileError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<AttendanceImportPreviewDTO | AttendanceImportCommitResultDTO | null>(null);
  const [importCommitted, setImportCommitted] = useState(false);
  const importPreview = useAttendanceImportPreview();
  const importCommit = useAttendanceImportCommit();

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
      approvedOvertimeMinutes: entry.approvedOvertimeMinutes === null ? "" : String(entry.approvedOvertimeMinutes),
      holidayCompensation: entry.holidayCompensation,
    });
    setFormError(null);
    setFormOpen(true);
  }

  /** Grid cell click: an existing day opens the same edit form the list uses; an empty day opens it pre-filled to record one. */
  function openGridCell(cellEmployeeId: string, date: string, entry: AttendanceEntryDTO | null) {
    if (entry) {
      openEdit(entry);
      return;
    }
    setEditingId(null);
    setDraft(blankDraft(cellEmployeeId, date));
    setFormError(null);
    setFormOpen(true);
  }

  function openImport() {
    setImportCsv(null);
    setImportFileName("");
    setImportFileError(null);
    setImportResult(null);
    setImportCommitted(false);
    importPreview.reset();
    importCommit.reset();
    setImportOpen(true);
  }

  function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportFileError(null);
    setImportResult(null);
    setImportCommitted(false);
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setImportCsv(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setImportFileError(t("attendance.import.fileReadFailed"));
    reader.readAsText(file);
  }

  async function runImportPreview() {
    if (!importCsv) return;
    setImportFileError(null);
    try {
      const result = await importPreview.mutateAsync({ csv: importCsv });
      setImportResult(result);
      setImportCommitted(false);
    } catch (err) {
      setImportFileError(err instanceof ApiError ? err.message : t("attendance.import.previewFailed"));
    }
  }

  async function runImportCommit() {
    if (!importCsv) return;
    setImportFileError(null);
    try {
      const result = await importCommit.mutateAsync({ csv: importCsv });
      setImportResult(result);
      setImportCommitted(true);
    } catch (err) {
      setImportFileError(err instanceof ApiError ? err.message : t("attendance.import.commitFailed"));
    }
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
      approvedOvertimeMinutes: draft.approvedOvertimeMinutes.trim() === "" ? null : Number(draft.approvedOvertimeMinutes.trim()),
      holidayCompensation: draft.holidayCompensation,
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
    {
      key: "approvedOvertime",
      header: t("attendance.approvedOvertime"),
      align: "end",
      render: (e) =>
        e.approvedOvertimeMinutes === null ? (
          <span className="text-ink-faint">{t("attendance.notApproved")}</span>
        ) : (
          <span className="mz-num font-semibold text-ink">{formatWorkedDuration(e.approvedOvertimeMinutes)}</span>
        ),
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
  const branches = branchesQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];

  const viewToggle = (
    <div className="inline-flex items-center gap-[4px] rounded-md border border-border p-[2px]">
      <Button size="sm" variant={viewMode === "list" ? "primary" : "ghost"} onClick={() => setViewMode("list")}>
        {t("attendance.viewList")}
      </Button>
      <Button size="sm" variant={viewMode === "grid" ? "primary" : "ghost"} onClick={() => setViewMode("grid")}>
        {t("attendance.viewGrid")}
      </Button>
    </div>
  );

  const headerActions = (
    <div className="flex flex-wrap items-center gap-[8px]">
      {viewToggle}
      <Button onClick={openImport}>{t("attendance.import.button")}</Button>
      <Button variant="primary" onClick={openCreate}>
        {t("attendance.recordAttendance")}
      </Button>
    </div>
  );

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("attendance.theAttendanceRecordCouldNot")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {viewMode === "grid" ? (
        <div className="flex flex-col gap-[14px]">
          <div className="flex flex-wrap items-start justify-between gap-[12px]">
            <div>
              <h2 className="font-display text-[17px] font-bold text-ink">{t("attendance.attendance")}</h2>
              <p className="mt-[2px] text-[12.5px] text-ink-muted">{t("attendance.theDailyAttendanceRecordPer")}</p>
            </div>
            {headerActions}
          </div>
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="min-w-[150px]">
              <TextField label={t("attendance.month")} value={month} onChange={setMonth} placeholder="YYYY-MM" />
            </div>
            <div className="min-w-[170px]">
              <SelectField
                label={t("attendance.grid.branch")}
                value={gridBranchFilter}
                onChange={setGridBranchFilter}
                options={[{ value: "all", label: t("attendance.grid.allBranches") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </div>
            <div className="min-w-[170px]">
              <SelectField
                label={t("attendance.grid.department")}
                value={gridDepartmentFilter}
                onChange={setGridDepartmentFilter}
                options={[
                  { value: "all", label: t("attendance.grid.allDepartments") },
                  ...departments.map((d) => ({ value: d.id, label: bilingualName(d, locale) })),
                ]}
              />
            </div>
          </div>
          {gridQuery.isError ? (
            <Card className="p-[18px_20px]">
              <p className="text-[13px] font-semibold text-danger-ink">{gridQuery.error?.message ?? t("attendance.theAttendanceRecordCouldNot")}</p>
              <Button size="sm" className="mt-[10px]" onClick={() => gridQuery.refetch()}>
                {t("common.retry")}
              </Button>
            </Card>
          ) : (
            <AttendanceGrid
              month={month}
              employees={gridEmployees}
              entries={gridQuery.data ?? []}
              loading={employeesQuery.isLoading || gridQuery.isLoading}
              onCellClick={openGridCell}
            />
          )}
        </div>
      ) : (
        <>
      <DocumentList<AttendanceEntryDTO>
        title={t("attendance.attendance")}
        description={t("attendance.theDailyAttendanceRecordPer")}
        actions={headerActions}
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
        </>
      )}

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
            label={t("attendance.approvedOvertime")}
            value={draft.approvedOvertimeMinutes}
            onChange={(v) => setDraft((d) => ({ ...d, approvedOvertimeMinutes: v.replace(/[^0-9]/g, "") }))}
            hint={t("attendance.approvedOvertimeHint")}
            placeholder="0"
          />
          <SelectField
            label={t("attendance.holidayCompensation")}
            value={draft.holidayCompensation}
            onChange={(v) => setDraft((d) => ({ ...d, holidayCompensation: v === "day_off" ? "day_off" : "pay" }))}
            options={[
              { value: "pay", label: t("attendance.holidayCompensation.pay") },
              { value: "day_off", label: t("attendance.holidayCompensation.day_off") },
            ]}
            hint={t("attendance.holidayCompensationHint")}
          />
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

      <SidePanel open={importOpen} onClose={() => setImportOpen(false)} title={t("attendance.import.title")}>
        <div className="flex flex-col gap-[14px]">
          <p className="text-[12.5px] text-ink-muted">{t("attendance.import.description")}</p>

          {importFileError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {importFileError}
            </div>
          ) : null}

          <div>
            <label className="mb-[6px] block text-[12.5px] font-semibold text-ink">{t("attendance.import.chooseFile")}</label>
            <input type="file" accept=".csv,text/csv" onChange={handleImportFile} className="block w-full text-[12.5px] text-ink" />
            <p className="mt-[4px] text-[11.5px] text-ink-faint">{importFileName || t("attendance.import.noFileChosen")}</p>
          </div>

          <div className="flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setImportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={!importCsv || importPreview.isPending} onClick={runImportPreview}>
              {importPreview.isPending ? t("common.loading") : t("attendance.import.preview")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!importResult || importResult.readyCount === 0 || importCommitted || importCommit.isPending}
              onClick={runImportCommit}
            >
              {importCommit.isPending ? t("common.loading") : t("attendance.import.commit")}
            </Button>
          </div>

          {importResult ? (
            <div className="flex flex-col gap-[10px]">
              <div className="grid grid-cols-2 gap-[10px] text-[12.5px] sm:grid-cols-4">
                <div>
                  <dt className="text-ink-faint">{t("attendance.import.totalPunches")}</dt>
                  <dd className="mz-num font-semibold text-ink">{importResult.totalPunches}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{t("attendance.import.matchedGroups")}</dt>
                  <dd className="mz-num font-semibold text-ink">{importResult.matchedGroupCount}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{t("attendance.import.readyCount")}</dt>
                  <dd className="mz-num font-semibold text-ink">{importResult.readyCount}</dd>
                </div>
                {"createdCount" in importResult ? (
                  <div>
                    <dt className="text-ink-faint">{t("attendance.import.createdCount")}</dt>
                    <dd className="mz-num font-semibold text-success-ink">{importResult.createdCount}</dd>
                  </div>
                ) : null}
              </div>

              {"createdCount" in importResult ? (
                <div role="status" className="rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink">
                  {t("attendance.import.commitSuccess", {
                    created: String(importResult.createdCount),
                    skipped: String(importResult.skippedAlreadyRecordedCount),
                  })}
                </div>
              ) : null}

              {importResult.unmatchedBadges.length > 0 ? (
                <div role="alert" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
                  {t("attendance.import.unmatchedBadges")}: {importResult.unmatchedBadges.join("، ")}
                </div>
              ) : null}

              {importResult.parseErrors.length > 0 ? (
                <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                  <p className="font-semibold">{t("attendance.import.parseErrors")}</p>
                  <ul className="mt-[4px] list-inside list-disc">
                    {importResult.parseErrors.map((e) => (
                      <li key={e.rowNumber}>
                        {e.rowNumber}: {e.reasons.join("، ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importResult.groups.length === 0 ? (
                <p className="text-[12.5px] text-ink-muted">{t("attendance.import.noGroupsYet")}</p>
              ) : (
                <div className="max-w-full overflow-x-auto">
                  <table className="w-full min-w-max border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-border text-ink-faint">
                        <th className="px-[8px] py-[6px] text-start font-semibold">{t("attendance.import.tableBadge")}</th>
                        <th className="px-[8px] py-[6px] text-start font-semibold">{t("attendance.import.tableEmployee")}</th>
                        <th className="px-[8px] py-[6px] text-start font-semibold">{t("attendance.import.tableDate")}</th>
                        <th className="px-[8px] py-[6px] text-start font-semibold">{t("attendance.import.tableCheckIn")}</th>
                        <th className="px-[8px] py-[6px] text-start font-semibold">{t("attendance.import.tableCheckOut")}</th>
                        <th className="px-[8px] py-[6px] text-start font-semibold">{t("attendance.import.tablePunches")}</th>
                        <th className="px-[8px] py-[6px] text-start font-semibold">{t("attendance.import.tableStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.groups.map((group, index) => (
                        <tr key={`${group.badgeId}-${group.date}-${index}`} className="border-b border-border last:border-b-0">
                          <td className="mz-num px-[8px] py-[5px] text-ink">{group.badgeId}</td>
                          <td className="px-[8px] py-[5px] text-ink">{group.employeeId ? employeeName(group.employeeId) : t("attendance.import.unknownEmployee")}</td>
                          <td className="mz-num px-[8px] py-[5px] text-ink">{group.date}</td>
                          <td className="mz-num px-[8px] py-[5px] text-ink">{group.checkIn ?? "—"}</td>
                          <td className="mz-num px-[8px] py-[5px] text-ink">{group.checkOut ?? "—"}</td>
                          <td className="mz-num px-[8px] py-[5px] text-ink">{group.punchCount}</td>
                          <td className="px-[8px] py-[5px]">
                            {group.issues.length === 0 ? (
                              <StatusPill label={t("attendance.import.ready")} tone="success" />
                            ) : (
                              <div className="flex flex-wrap gap-[4px]">
                                {group.issues.map((issue) => (
                                  <StatusPill key={issue} label={t(IMPORT_ISSUE_KEY[issue])} tone={issue === "already_recorded" ? "neutral" : "warning"} />
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </SidePanel>
    </div>
  );
}
