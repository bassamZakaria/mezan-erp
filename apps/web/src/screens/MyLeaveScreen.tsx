import { useState, type FormEvent } from "react";
import { Button, Card, SidePanel, StatusPill } from "@mezan/ui";
import type { LeaveRequestDTO, LeaveTypeDTO } from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useCancelLeaveRequest, useCreateLeaveRequest, useMyLeave } from "../data/hooks";
import { LEAVE_STATUS_LABEL, LEAVE_STATUS_TONE, LEAVE_TYPE_LABEL, LEAVE_TYPE_OPTIONS } from "./hr-leave-labels";

/** إجازاتي (My Leave — employee self-service) — docs/catalog/06 §"إجازاتي". Lets the logged-in user request leave and see their own leave-request history, gated on their account being linked to an HR employee record. */

interface LeaveDraft {
  leaveType: LeaveTypeDTO;
  halfDay: boolean;
  startDate: string;
  endDate: string;
  reason: string;
}

function blankDraft(): LeaveDraft {
  return { leaveType: "annual", halfDay: false, startDate: "", endDate: "", reason: "" };
}

export function MyLeaveScreen() {
  const query = useMyLeave();
  const createLeaveRequest = useCreateLeaveRequest();
  const cancelLeaveRequest = useCancelLeaveRequest();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<LeaveDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const requests = query.data?.requests ?? [];
  const linked = query.data?.employeeId != null;

  function openForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.startDate.trim() === "" || draft.endDate.trim() === "") {
      setFormError("تاريخ البداية والنهاية مطلوبان.");
      return;
    }
    setFormError(null);
    try {
      await createLeaveRequest.mutateAsync({
        leaveType: draft.leaveType,
        halfDay: draft.halfDay,
        startDate: draft.startDate.trim(),
        endDate: draft.halfDay ? draft.startDate.trim() : draft.endDate.trim(),
        reason: draft.reason.trim() === "" ? null : draft.reason.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر إرسال طلب الإجازة.");
    }
  }

  async function handleCancel(request: LeaveRequestDTO) {
    if (cancellingId) return;
    setCancellingId(request.id);
    setRowError(null);
    try {
      await cancelLeaveRequest.mutateAsync(request.id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "تعذّر إلغاء طلب الإجازة.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">HR · My Leave</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">إجازاتي</h1>
        </div>
        {linked ? (
          <Button variant="primary" onClick={openForm}>
            طلب إجازة
          </Button>
        ) : null}
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل إجازاتي.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      {!query.isLoading && !linked ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-ink">غير مرتبط بموظف</p>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">حسابك غير مرتبط بسجل موظف. تواصل مع المسؤول.</p>
        </Card>
      ) : null}

      {rowError ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}

      {linked ? (
        requests.length > 0 ? (
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-ink-faint">
                  <th className="px-[14px] py-[10px] text-start font-semibold">نوع الإجازة</th>
                  <th className="px-[14px] py-[10px] text-start font-semibold">الفترة</th>
                  <th className="px-[14px] py-[10px] text-end font-semibold">عدد الأيام</th>
                  <th className="px-[14px] py-[10px] text-start font-semibold">الحالة</th>
                  <th className="px-[14px] py-[10px]" />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-[14px] py-[10px] font-semibold text-ink">{LEAVE_TYPE_LABEL[r.leaveType]}</td>
                    <td className="mz-num px-[14px] py-[10px] text-ink">
                      {r.startDate} — {r.endDate}
                    </td>
                    <td className="mz-num px-[14px] py-[10px] text-end text-ink">{r.days}</td>
                    <td className="px-[14px] py-[10px]">
                      <StatusPill label={LEAVE_STATUS_LABEL[r.status]} tone={LEAVE_STATUS_TONE[r.status]} />
                    </td>
                    <td className="px-[14px] py-[10px] text-end">
                      {r.status === "pending" || r.status === "approved" ? (
                        <Button size="sm" aria-label={`إلغاء طلب الإجازة ${r.number}`} disabled={cancellingId !== null} onClick={() => handleCancel(r)}>
                          إلغاء
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card className="p-[18px_20px] text-center text-[12.5px] text-ink-muted">لا توجد طلبات إجازة — لم تقدم أي طلب إجازة بعد</Card>
        )
      ) : null}

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="طلب إجازة">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label="نوع الإجازة *"
            value={draft.leaveType}
            onChange={(v) => setDraft((d) => ({ ...d, leaveType: v as LeaveTypeDTO }))}
            options={LEAVE_TYPE_OPTIONS}
          />
          <ToggleField
            label="نصف يوم"
            checked={draft.halfDay}
            onChange={(v) => setDraft((d) => ({ ...d, halfDay: v }))}
            hint="حدد يوماً واحداً وسيتم احتساب نصف يوم (0.5)"
          />
          <TextField label="تاريخ البداية *" value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField
            label="تاريخ النهاية *"
            value={draft.halfDay ? draft.startDate : draft.endDate}
            onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
            placeholder="YYYY-MM-DD"
            disabled={draft.halfDay}
          />
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
