import { useState } from "react";
import { Button, Card, DocumentList, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type { LeaveRequestDTO, LeaveRequestStatusDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { ApiError, useDecideLeaveRequest, useEmployees, useLeaveRequestCounts, useLeaveRequests } from "../data/hooks";
import { LEAVE_STATUS_KEY, LEAVE_STATUS_TONE, LEAVE_TYPE_KEY, leaveTypeOptions } from "./hr-leave-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** طلبات الإجازات (Leave Requests — admin) — docs/catalog/06 §"طلبات الإجازات". Manager list with employee/status/date filters plus approve/reject, which route through the workflow gate configured for the leave type. */

function statusChips(t: (key: AppTranslationKey) => string): Array<{ key: string; label: string }> {
  return [
    { key: "", label: t("common.all") },
    ...(Object.keys(LEAVE_STATUS_KEY) as LeaveRequestStatusDTO[]).map((code) => ({ key: code, label: t(LEAVE_STATUS_KEY[code]) })),
  ];
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
        eyebrow="HR · Leave Requests"
        title={t("leaveRequests.leaveRequests")}
        description={t("leaveRequests.reviewEmployeesLeaveRequestsAnd")}
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
    </div>
  );
}
