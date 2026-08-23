import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, StatusPill, Card, Button, SidePanel, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { LeaveApplicationDTO, LeaveApplicationStatusDTO, LeaveTypeCodeDTO, SubmitLeaveApplicationDTO } from "@mezan/contracts";
import {
  ApiError,
  useCancelLeaveApplication,
  useDecideLeaveApplication,
  useHrEmployeesRef,
  useLeaveApplications,
  useSubmitLeaveApplication,
} from "../data/hooks";
import { Field, SelectField, TextField, ToggleField } from "../settings/form-controls";

/** طلبات الإجازات — Leave Requests (docs/catalog/06-crm-hr.md §"طلبات الإجازات"). List + submit + decide/cancel actions. */

const STATUS_LABEL: Record<LeaveApplicationStatusDTO, string> = {
  PENDING: "بانتظار الموافقة",
  APPROVED: "موافق عليه",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
};
const STATUS_TONE: Record<LeaveApplicationStatusDTO, PillTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

const LEAVE_TYPE_LABEL: Record<LeaveTypeCodeDTO, string> = {
  ANNUAL: "إجازة سنوية",
  SICK: "إجازة مرضية",
  PERSONAL: "إجازة شخصية",
  CASUAL: "إجازة عارضة",
  MATERNITY: "إجازة أمومة",
  PATERNITY: "إجازة أبوة",
  UNPAID: "إجازة بدون أجر",
  EMERGENCY: "إجازة طارئة",
};
const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABEL) as LeaveTypeCodeDTO[];

interface RequestDraft {
  employeeId: string;
  leaveTypeCode: LeaveTypeCodeDTO;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  reason: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankDraft(): RequestDraft {
  return { employeeId: "", leaveTypeCode: "ANNUAL", startDate: today(), endDate: today(), halfDay: false, reason: "" };
}

function validateDraft(draft: RequestDraft): string | null {
  if (draft.employeeId.trim() === "") return "اختر الموظف.";
  if (!draft.startDate || !draft.endDate) return "حدد تاريخ البداية والنهاية.";
  if (draft.endDate < draft.startDate) return "تاريخ النهاية يجب أن يكون بعد تاريخ البداية.";
  if (draft.halfDay && draft.startDate !== draft.endDate) return "طلب نصف يوم يجب أن يكون ليوم واحد فقط.";
  return null;
}

export function LeaveRequestsScreen() {
  const employeesQuery = useHrEmployeesRef();
  const query = useLeaveApplications();
  const submitRequest = useSubmitLeaveApplication();
  const decideRequest = useDecideLeaveApplication();
  const cancelRequest = useCancelLeaveApplication();

  const employees = employeesQuery.data ?? [];
  const requests = query.data ?? [];

  const [statusFilter, setStatusFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<RequestDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function employeeName(employeeId: string): string {
    return employees.find((e) => e.id === employeeId)?.nameAr ?? employeeId;
  }

  const filtered = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const body: SubmitLeaveApplicationDTO = {
      employeeId: draft.employeeId,
      leaveTypeCode: draft.leaveTypeCode,
      startDate: draft.startDate,
      endDate: draft.endDate,
      halfDay: draft.halfDay,
      reason: draft.reason.trim() === "" ? null : draft.reason.trim(),
    };
    try {
      await submitRequest.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر إرسال طلب الإجازة.");
    }
  }

  async function handleDecide(request: LeaveApplicationDTO, decision: "approve" | "reject") {
    if (actionId !== null) return;
    setActionId(request.id);
    setActionError(null);
    try {
      await decideRequest.mutateAsync({ id: request.id, body: { decision } });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "تعذّر تسجيل القرار.");
    } finally {
      setActionId(null);
    }
  }

  async function handleCancel(request: LeaveApplicationDTO) {
    if (actionId !== null) return;
    setActionId(request.id);
    setActionError(null);
    try {
      await cancelRequest.mutateAsync(request.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "تعذّر إلغاء الطلب.");
    } finally {
      setActionId(null);
    }
  }

  const columns: DocumentListColumn<LeaveApplicationDTO>[] = [
    { key: "requestNo", header: "رقم الطلب", render: (r) => <span className="mz-num font-semibold text-ink">{r.requestNo}</span> },
    { key: "employee", header: "اسم الموظف", render: (r) => employeeName(r.employeeId) },
    { key: "type", header: "نوع الإجازة", render: (r) => LEAVE_TYPE_LABEL[r.leaveTypeCode] },
    { key: "period", header: "الفترة", render: (r) => <span className="mz-num">{r.startDate} — {r.endDate}</span> },
    { key: "days", header: "عدد الأيام", align: "end", render: (r) => <span className="mz-num">{r.days}</span> },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        r.status === "PENDING" ? (
          <div className="flex justify-end gap-[6px]">
            <Button
              size="sm"
              variant="primary"
              disabled={actionId === r.id}
              onClick={(event) => {
                event.stopPropagation();
                void handleDecide(r, "approve");
              }}
            >
              موافقة
            </Button>
            <Button
              size="sm"
              disabled={actionId === r.id}
              onClick={(event) => {
                event.stopPropagation();
                void handleDecide(r, "reject");
              }}
            >
              رفض
            </Button>
            <Button
              size="sm"
              disabled={actionId === r.id}
              onClick={(event) => {
                event.stopPropagation();
                void handleCancel(r);
              }}
            >
              إلغاء
            </Button>
          </div>
        ) : null,
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: requests.length },
    { key: "PENDING", label: "بانتظار الموافقة", count: requests.filter((r) => r.status === "PENDING").length },
    { key: "APPROVED", label: "موافق عليه", count: requests.filter((r) => r.status === "APPROVED").length },
    { key: "REJECTED", label: "مرفوض", count: requests.filter((r) => r.status === "REJECTED").length },
    { key: "CANCELLED", label: "ملغى", count: requests.filter((r) => r.status === "CANCELLED").length },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل طلبات الإجازات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {actionError ? (
        <Card className="mb-[18px] p-[14px_18px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {actionError}
          </p>
        </Card>
      ) : null}
      <DocumentList<LeaveApplicationDTO>
        eyebrow="HR · Leave"
        title="طلبات الإجازات"
        description="تقديم طلبات الإجازة ومتابعة الموافقة عليها عبر سلسلة الاعتماد"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            طلب إجازة جديد
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{requests.length}</span> },
          { label: "بانتظار الموافقة", value: <span className="mz-num">{requests.filter((r) => r.status === "PENDING").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={setStatusFilter}
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{requests.length}</span> طلب
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد نتائج مطابقة للفلتر الحالي</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="طلب إجازة جديد" description="بيانات طلب الإجازة">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <SelectField
            label="اسم الموظف *"
            value={draft.employeeId}
            onChange={(v) => setDraft((d) => ({ ...d, employeeId: v }))}
            options={[{ value: "", label: "اختر الموظف..." }, ...employees.map((e) => ({ value: e.id, label: `${e.nameAr} (${e.code})` }))]}
          />
          <SelectField
            label="نوع الإجازة *"
            value={draft.leaveTypeCode}
            onChange={(v) => setDraft((d) => ({ ...d, leaveTypeCode: v as LeaveTypeCodeDTO }))}
            options={LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABEL[t] }))}
          />
          <ToggleField
            label="نصف يوم"
            hint="حدد يوماً واحداً وسيتم احتساب نصف يوم (0.5)"
            checked={draft.halfDay}
            onChange={(v) => setDraft((d) => ({ ...d, halfDay: v, endDate: v ? d.startDate : d.endDate }))}
          />
          <Field label="تاريخ البداية *">
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value, endDate: d.halfDay ? e.target.value : d.endDate }))}
              className="mz-num w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
            />
          </Field>
          <Field label="تاريخ النهاية *">
            <input
              type="date"
              value={draft.endDate}
              disabled={draft.halfDay}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
              className="mz-num w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-3"
            />
          </Field>
          <TextField label="السبب" value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              إرسال الطلب
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
