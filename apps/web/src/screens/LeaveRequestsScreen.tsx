import { useState, type FormEvent } from "react";
import { Button, Card, DocumentList, EntityPicker, SidePanel, StatusPill, type DocumentListColumn, type EntityPickerOption } from "@mezan/ui";
import type { LeaveRequestDTO, LeaveRequestStatusDTO, LeaveTypeDTO } from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useCreateLeaveRequest, useDecideLeaveRequest, useEmployees, useLeaveRequestCounts, useLeaveRequests } from "../data/hooks";
import { LEAVE_STATUS_KEY, LEAVE_STATUS_TONE, LEAVE_TYPE_KEY, leaveTypeOptions } from "./hr-leave-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** طلبات الإجازات (Leave Requests — admin) — docs/catalog/06 §"طلبات الإجازات". Manager list with employee/status/date filters plus approve/reject, which route through the workflow gate configured for the leave type. */

function statusChips(t: (key: AppTranslationKey) => string): Array<{ key: string; label: string }> {
  return [
    { key: "", label: t("common.all") },
    ...(Object.keys(LEAVE_STATUS_KEY) as LeaveRequestStatusDTO[]).map((code) => ({ key: code, label: t(LEAVE_STATUS_KEY[code]) })),
  ];
}

interface LeaveDraft {
  employeeId: string;
  leaveType: LeaveTypeDTO;
  halfDay: boolean;
  startDate: string;
  endDate: string;
  reason: string;
}

function blankDraft(): LeaveDraft {
  return { employeeId: "", leaveType: "annual", halfDay: false, startDate: "", endDate: "", reason: "" };
}

export function LeaveRequestsScreen() {
  const { t } = useAppTranslation();
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const employeesQuery = useEmployees();
  const employees = employeesQuery.data ?? [];
  const query = useLeaveRequests({ employeeId: employeeId || null, status: status || null, leaveType: leaveType || null, from: from || null, to: to || null });
  const countsQuery = useLeaveRequestCounts();
  const decideRequest = useDecideLeaveRequest();

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const createRequest = useCreateLeaveRequest();
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<LeaveDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const requests = query.data ?? [];
  const counts = countsQuery.data;
  const employeeName = (id: string) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee) return id;
    return [employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ").trim() || `${employee.firstName} ${employee.lastName}`.trim();
  };

  async function decide(request: LeaveRequestDTO, decision: "approved" | "rejected") {
    if (decidingId) return;
    setDecidingId(request.id);
    setRowError(null);
    setBanner(null);
    try {
      const result = await decideRequest.mutateAsync({ id: request.id, decision });
      if (result.held) {
        setBanner(
          result.requiredRole
        ? t("leaveRequests.awaitingApprovalsWithRole", { number: request.number, role: result.requiredRole })
        : t("leaveRequests.awaitingApprovals", { number: request.number }),
        );
      }
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("leaveRequests.theDecisionOnThisLeave"));
    } finally {
      setDecidingId(null);
    }
  }

  function openForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function submitDraft(event: FormEvent) {
    event.preventDefault();
    if (draft.employeeId === "") {
      setFormError(t("leaveRequests.pickTheEmployeeTheRequest"));
      return;
    }
    if (draft.startDate.trim() === "" || (!draft.halfDay && draft.endDate.trim() === "")) {
      setFormError(t("leaveRequests.bothAStartAndAn"));
      return;
    }
    setFormError(null);
    try {
      await createRequest.mutateAsync({
        employeeId: draft.employeeId,
        leaveType: draft.leaveType,
        halfDay: draft.halfDay,
        startDate: draft.startDate.trim(),
        endDate: draft.halfDay ? draft.startDate.trim() : draft.endDate.trim(),
        reason: draft.reason.trim() === "" ? null : draft.reason.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("leaveRequests.theLeaveRequestCouldNot"));
    }
  }

  const employeeOptions: EntityPickerOption[] = employees
    .filter((e) => e.status !== "terminated")
    .map((e) => ({ id: e.id, label: employeeName(e.id), sublabel: e.code }));
  const selectedEmployee = employeeOptions.find((o) => o.id === draft.employeeId) ?? null;

  const columns: DocumentListColumn<LeaveRequestDTO>[] = [
    { key: "number", header: t("leaveRequests.requestNumber"), render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    { key: "employee", header: t("leaveRequests.employee"), render: (r) => <span className="font-semibold text-ink">{employeeName(r.employeeId)}</span> },
    { key: "leaveType", header: t("leaveRequests.leaveType"), render: (r) => <span className="text-ink">{t(LEAVE_TYPE_KEY[r.leaveType])}</span> },
    {
      key: "period",
      header: t("common.period"),
      render: (r) => (
        <span className="mz-num text-ink">
          {r.startDate} — {r.endDate}
        </span>
      ),
    },
    { key: "days", header: t("leaveRequests.days"), align: "end", render: (r) => <span className="mz-num text-ink">{r.days}</span> },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={t(LEAVE_STATUS_KEY[r.status])} tone={LEAVE_STATUS_TONE[r.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        r.status === "pending" ? (
          <div className="flex items-center justify-end gap-[6px]">
            <Button size="sm" variant="primary" disabled={decidingId !== null} onClick={() => decide(r, "approved")}>
              {t("leaveRequests.approve")}
            </Button>
            <Button size="sm" disabled={decidingId !== null} onClick={() => decide(r, "rejected")}>
              {t("leaveRequests.reject")}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("leaveRequests.leaveRequestsCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      {banner ? (
        <div role="status" className="mb-[14px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
          {banner}
        </div>
      ) : null}

      <DocumentList<LeaveRequestDTO>
        title={t("leaveRequests.leaveRequests")}
        description={t("leaveRequests.reviewEmployeesLeaveRequestsAnd")}
        actions={
          <Button variant="primary" onClick={openForm}>
            {t("leaveRequests.newLeaveRequest")}
          </Button>
        }
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{counts?.total ?? 0}</span> },
          { label: t("leaveStatus.pending"), value: <span className="mz-num">{counts?.pending ?? 0}</span> },
          { label: t("leaveStatus.approved"), value: <span className="mz-num">{counts?.approved ?? 0}</span> },
          { label: t("leaveStatus.rejected"), value: <span className="mz-num">{counts?.rejected ?? 0}</span> },
          { label: t("leaveStatus.cancelled"), value: <span className="mz-num">{counts?.cancelled ?? 0}</span> },
        ]}
        statusChips={statusChips(t).map((chip) => ({
          key: chip.key,
          label: chip.label,
          count: chip.key === "" ? requests.length : requests.filter((r) => r.status === chip.key).length,
        }))}
        activeStatusKey={status}
        onStatusChange={setStatus}
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="min-w-[200px]">
              <SelectField
                label={t("leaveRequests.employee2")}
                value={employeeId}
                onChange={setEmployeeId}
                options={[{ value: "", label: t("leaveRequests.allEmployees") }, ...employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))]}
              />
            </div>
            <div className="min-w-[180px]">
              <SelectField
                label={t("leaveRequests.leaveType")}
                value={leaveType}
                onChange={setLeaveType}
                options={[{ value: "", label: t("leaveRequests.allTypes") }, ...leaveTypeOptions(t)]}
              />
            </div>
            <div className="min-w-[150px]">
              <TextField label={t("leaveRequests.from")} value={from} onChange={setFrom} placeholder="YYYY-MM-DD" />
            </div>
            <div className="min-w-[150px]">
              <TextField label={t("leaveRequests.to")} value={to} onChange={setTo} placeholder="YYYY-MM-DD" />
            </div>
          </div>
        }
        columns={columns}
        rows={requests}
        rowKey={(r) => r.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{requests.length}</span> {t("leaveRequests.requests")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("leaveRequests.nothingMatchesTheCurrentFilter")}</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("leaveRequests.newLeaveRequest")}>
        <form onSubmit={submitDraft} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label={t("leaveRequests.employee2")}
            options={employeeOptions}
            value={selectedEmployee}
            onChange={(option) => setDraft((d) => ({ ...d, employeeId: option?.id ?? "" }))}
            placeholder={t("leaveRequests.searchForAnEmployee")}
          />
          <SelectField
            label={t("leaveRequests.leaveType")}
            value={draft.leaveType}
            onChange={(v) => setDraft((d) => ({ ...d, leaveType: v as LeaveTypeDTO }))}
            options={leaveTypeOptions(t)}
          />
          <ToggleField
            label={t("leaveRequests.halfDay")}
            checked={draft.halfDay}
            onChange={(v) => setDraft((d) => ({ ...d, halfDay: v }))}
            hint={t("leaveRequests.pickASingleDayAnd")}
          />
          <TextField label={t("leaveRequests.startDate")} value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField
            label={t("leaveRequests.endDate")}
            value={draft.halfDay ? draft.startDate : draft.endDate}
            onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
            placeholder="YYYY-MM-DD"
            disabled={draft.halfDay}
          />
          <TextField label={t("leaveRequests.reason")} value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={createRequest.isPending}>
              {t("leaveRequests.submitRequest")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
