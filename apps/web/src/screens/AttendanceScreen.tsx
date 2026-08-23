import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, IconButton, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
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
import { ATTENDANCE_STATUS_LABEL, ATTENDANCE_STATUS_TONE, formatWorkedDuration } from "./hr-leave-labels";

/** الحضور والانصراف (Attendance) — docs/catalog/06 §"الحضور والانصراف". Per-employee daily check-in/out with a computed worked duration and a day status resolved against the official holiday calendar and approved leave. */

function monthBounds(month: string): { from: string; to: string } {
  const [year, monthPart] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year ?? 1970, monthPart ?? 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "كل الحالات" },
  ...(Object.keys(ATTENDANCE_STATUS_LABEL) as AttendanceStatusDTO[]).map((code) => ({ value: code, label: ATTENDANCE_STATUS_LABEL[code] })),
];

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
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("");

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
  const employeeName = (id: string) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee) return id;
    return [employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ").trim() || `${employee.firstName} ${employee.lastName}`.trim();
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
      setFormError("الموظف والتاريخ مطلوبان.");
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
      setFormError(err instanceof ApiError ? err.message : "تعذّرت العملية.");
    }
  }

  const columns: DocumentListColumn<AttendanceEntryDTO>[] = [
    { key: "date", header: "التاريخ", render: (e) => <span className="mz-num font-semibold text-ink">{e.date}</span> },
    { key: "employee", header: "الموظف", render: (e) => <span className="font-semibold text-ink">{employeeName(e.employeeId)}</span> },
    { key: "checkIn", header: "الحضور", render: (e) => <span className="mz-num text-ink">{e.checkIn ?? "—"}</span> },
    { key: "checkOut", header: "الانصراف", render: (e) => <span className="mz-num text-ink">{e.checkOut ?? "—"}</span> },
    {
      key: "worked",
      header: "ساعات العمل",
      align: "end",
      render: (e) => <span className="mz-num text-ink">{formatWorkedDuration(e.workedMinutes)}</span>,
    },
    { key: "status", header: "الحالة", render: (e) => <StatusPill label={ATTENDANCE_STATUS_LABEL[e.status]} tone={ATTENDANCE_STATUS_TONE[e.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (e) => (
        <div className="flex items-center justify-end gap-[6px]">
          <IconButton aria-label={`تعديل سجل ${e.date}`} onClick={() => openEdit(e)}>
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل سجل الحضور.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <DocumentList<AttendanceEntryDTO>
        eyebrow="HR · Attendance"
        title="الحضور والانصراف"
        description="سجل الحضور اليومي لكل موظف مع مدة العمل المحتسبة وحالة اليوم"
        actions={
          <Button variant="primary" onClick={openCreate}>
            تسجيل حضور
          </Button>
        }
        stats={[
          { label: "أيام العمل", value: <span className="mz-num">{summary?.workingDays ?? 0}</span> },
          { label: "أيام الحضور", value: <span className="mz-num">{summary?.daysPresent ?? 0}</span> },
          { label: "أيام التأخير", value: <span className="mz-num">{summary?.daysLate ?? 0}</span> },
          { label: "أيام الغياب", value: <span className="mz-num">{summary?.daysAbsent ?? 0}</span> },
          { label: "نسبة الحضور", value: <span className="mz-num">{summary?.attendanceRatePercent ?? 0}%</span> },
        ]}
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="min-w-[150px]">
              <TextField label="الشهر" value={month} onChange={setMonth} placeholder="YYYY-MM" />
            </div>
            <div className="min-w-[190px]">
              <SelectField
                label="الموظف"
                value={employeeId}
                onChange={setEmployeeId}
                options={[{ value: "", label: "كل الموظفين" }, ...employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))]}
              />
            </div>
            <div className="min-w-[160px]">
              <SelectField label="الحالة" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            </div>
          </div>
        }
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{entries.length}</span> سجل حضور
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد سجلات حضور لهذه الفترة</div>}
      />

      {employeeId !== "" && summary ? (
        <Card className="mt-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-ink">الملخص الشهري للحضور</p>
          <div className="mt-[10px] grid grid-cols-2 gap-[10px] text-[12.5px] text-ink-muted sm:grid-cols-4">
            <div>
              أنصاف الأيام: <span className="mz-num text-ink">{summary.halfDays}</span>
            </div>
            <div>
              أيام الإجازات: <span className="mz-num text-ink">{summary.daysOnLeave}</span>
            </div>
            <div>
              الإجازات الرسمية: <span className="mz-num text-ink">{summary.holidays}</span>
            </div>
            <div>
              ساعات العمل: <span className="mz-num text-ink">{formatWorkedDuration(summary.workedMinutes)}</span>
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
        title={editingId ? "تعديل سجل الحضور" : "تسجيل حضور"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label="الموظف *"
            value={draft.employeeId}
            onChange={(v) => setDraft((d) => ({ ...d, employeeId: v }))}
            options={employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))}
            disabled={editingId !== null}
          />
          <TextField
            label="التاريخ *"
            value={draft.date}
            onChange={(v) => setDraft((d) => ({ ...d, date: v }))}
            placeholder="YYYY-MM-DD"
            disabled={editingId !== null}
          />
          <TextField label="وقت الحضور" value={draft.checkIn} onChange={(v) => setDraft((d) => ({ ...d, checkIn: v }))} placeholder="09:00" />
          <TextField label="وقت الانصراف" value={draft.checkOut} onChange={(v) => setDraft((d) => ({ ...d, checkOut: v }))} placeholder="17:00" />
          <TextField
            label="بداية الوردية"
            value={draft.expectedCheckIn}
            onChange={(v) => setDraft((d) => ({ ...d, expectedCheckIn: v }))}
            placeholder="09:00"
            hint="اتركه فارغاً إذا لم يكن هناك وقت بداية محدد؛ يُستخدم لاحتساب التأخير"
          />
          <ToggleField label="نصف يوم" checked={draft.halfDay} onChange={(v) => setDraft((d) => ({ ...d, halfDay: v }))} />
          <SelectField
            label="تجاوز الحالة"
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
            options={[{ value: "", label: "احتساب تلقائي" }, ...STATUS_OPTIONS.slice(1)]}
            hint="الاحتساب التلقائي يراعي الإجازات الرسمية والإجازات المعتمدة والعطلة الأسبوعية"
          />
          <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? "حفظ التعديلات" : "تسجيل"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
