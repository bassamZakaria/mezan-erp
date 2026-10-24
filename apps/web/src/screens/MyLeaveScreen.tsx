import { useState, type FormEvent } from "react";
import { Button, Card, SidePanel, StatusPill } from "@mezan/ui";
import type { LeaveRequestDTO, LeaveTypeDTO } from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useMyLeave } from "../data/hooks";
import { useCancelSelfLeaveRequest, useCreateSelfLeaveRequest } from "../data/hr-self-hooks";
import { LEAVE_STATUS_KEY, LEAVE_STATUS_TONE, LEAVE_TYPE_KEY, leaveTypeOptions } from "./hr-leave-labels";
import { useAppTranslation } from "../i18n";

/** إجازاتي (My Leave — employee self-service) — docs/archive/catalog/06 §"إجازاتي". Lets the logged-in user request leave and see their own leave-request history, gated on their account being linked to an HR employee record. */

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
  const { t } = useAppTranslation();
  const query = useMyLeave();
  const createLeaveRequest = useCreateSelfLeaveRequest();
  const cancelLeaveRequest = useCancelSelfLeaveRequest();

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
      setFormError(t("myLeave.bothAStartAndAn"));
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
      setFormError(err instanceof ApiError ? err.message : t("myLeave.theLeaveRequestCouldNot"));
    }
  }

  async function handleCancel(request: LeaveRequestDTO) {
    if (cancellingId) return;
    setCancellingId(request.id);
    setRowError(null);
    try {
      await cancelLeaveRequest.mutateAsync(request.id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("myLeave.theLeaveRequestCouldNot2"));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">{t("eyebrow.hr.myLeave")}</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("myLeave.myLeave")}</h1>
        </div>
        {linked ? (
          <Button variant="primary" onClick={openForm}>
            {t("myLeave.requestLeave")}
          </Button>
        ) : null}
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("myLeave.yourLeaveCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {!query.isLoading && !linked ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-ink">{t("myLeave.notLinkedToAnEmployee")}</p>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("myLeave.yourAccountIsNotLinked")}</p>
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
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-ink-faint">
                    <th className="px-[14px] py-[10px] text-start font-semibold">{t("myLeave.leaveType")}</th>
                    <th className="px-[14px] py-[10px] text-start font-semibold">{t("common.period")}</th>
                    <th className="px-[14px] py-[10px] text-end font-semibold">{t("myLeave.days")}</th>
                    <th className="px-[14px] py-[10px] text-start font-semibold">{t("common.status")}</th>
                    <th className="px-[14px] py-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-[14px] py-[10px] font-semibold text-ink">{t(LEAVE_TYPE_KEY[r.leaveType])}</td>
                      <td className="mz-num px-[14px] py-[10px] text-ink">
                        {r.startDate} — {r.endDate}
                      </td>
                      <td className="mz-num px-[14px] py-[10px] text-end text-ink">{r.days}</td>
                      <td className="px-[14px] py-[10px]">
                        <StatusPill label={t(LEAVE_STATUS_KEY[r.status])} tone={LEAVE_STATUS_TONE[r.status]} />
                      </td>
                      <td className="px-[14px] py-[10px] text-end">
                        {r.status === "pending" || r.status === "approved" ? (
                          <Button size="sm" aria-label={t("myLeave.cancelRequestLabel", { number: r.number })} disabled={cancellingId !== null} onClick={() => handleCancel(r)}>
                            {t("common.cancel")}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card className="p-[18px_20px] text-center text-[12.5px] text-ink-muted">{t("myLeave.noLeaveRequestsYouHave")}</Card>
        )
      ) : null}

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("myLeave.requestLeave")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label={t("myLeave.leaveType2")}
            value={draft.leaveType}
            onChange={(v) => setDraft((d) => ({ ...d, leaveType: v as LeaveTypeDTO }))}
            options={leaveTypeOptions(t)}
          />
          <ToggleField
            label={t("myLeave.halfDay")}
            checked={draft.halfDay}
            onChange={(v) => setDraft((d) => ({ ...d, halfDay: v }))}
            hint={t("myLeave.pickASingleDayAnd")}
          />
          <TextField label={t("myLeave.startDate")} value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField
            label={t("myLeave.endDate")}
            value={draft.halfDay ? draft.startDate : draft.endDate}
            onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
            placeholder="YYYY-MM-DD"
            disabled={draft.halfDay}
          />
          <TextField label={t("myLeave.reason")} value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("myLeave.submitRequest")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
