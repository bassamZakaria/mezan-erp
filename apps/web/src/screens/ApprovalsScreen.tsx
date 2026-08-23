import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  formatDate,
  Money as MoneyDisplay,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import type { ApprovalRequestDTO, ApprovalStatusDTO, WorkflowRequestScopeDTO } from "@mezan/contracts";
import { useApproveWorkflowRequest, useRejectWorkflowRequest, useWorkflowRequests } from "../data/workflow-hooks";

/**
 * صندوق الموافقات — the approvals inbox (docs/catalog/09 §الموافقات, route
 * `/approvals`). Three tabs over `/workflow/requests?scope=...`: الوارد
 * (awaiting my decision), طلباتي (things I submitted), إجراءاتي (things I've
 * already approved/rejected). Approve/reject carry an optional comment and
 * only ever touch the ONE row acted on — never a mutation-wide pending flag.
 */

const SCOPES: { key: WorkflowRequestScopeDTO; label: string }[] = [
  { key: "inbox", label: "الوارد" },
  { key: "mine", label: "طلباتي" },
  { key: "acted", label: "إجراءاتي" },
];

const STATUS_LABEL: Record<ApprovalStatusDTO, string> = {
  pending: "بانتظار الموافقة",
  approved: "معتمد",
  rejected: "مرفوض",
  modification_requested: "مطلوب تعديل",
};

const STATUS_TONE: Record<ApprovalStatusDTO, PillTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  modification_requested: "info",
};

const EMPTY_MESSAGE: Record<WorkflowRequestScopeDTO, string> = {
  inbox: "لا توجد مهام بانتظار موافقتك!",
  mine: "لا توجد طلبات مقدَّمة منك.",
  acted: "لا توجد عناصر معلقة! لم تتخذ أي إجراء بعد.",
};

function subjectLabel(row: ApprovalRequestDTO): string {
  if (!row.subject) return row.actionLabelAr;
  return row.subject.docNo ? `${row.subject.docTypeLabelAr} ${row.subject.docNo}` : row.subject.docTypeLabelAr;
}

export function ApprovalsScreen() {
  const [scope, setScope] = useState<WorkflowRequestScopeDTO>("inbox");
  const query = useWorkflowRequests(scope);
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const approve = useApproveWorkflowRequest();
  const reject = useRejectWorkflowRequest();

  const selected = selectedId ? (rows.find((r) => r.id === selectedId) ?? null) : null;

  async function act(row: ApprovalRequestDTO, decision: "approve" | "reject") {
    if (pendingId) return;
    setPendingId(row.id);
    setActionError(null);
    try {
      const mutation = decision === "approve" ? approve : reject;
      await mutation.mutateAsync({ id: row.id, body: { comment: comment.trim() === "" ? undefined : comment.trim() } });
      setComment("");
      setSelectedId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = SCOPES.map((s) => ({
    key: s.key,
    label: s.label,
    count: s.key === scope ? rows.length : 0,
  }));

  const columns: DocumentListColumn<ApprovalRequestDTO>[] = [
    {
      key: "subject",
      header: "المستند",
      render: (r) => (
        <div className="flex flex-col gap-[2px]">
          <span className="font-semibold text-ink">{subjectLabel(r)}</span>
          <span className="text-[11.5px] text-ink-muted">{r.actionLabelAr}</span>
        </div>
      ),
    },
    {
      key: "submittedBy",
      header: "مقدَّم من",
      render: (r) => <span className="text-ink">{r.submittedByName ?? r.submittedBy}</span>,
    },
    {
      key: "createdAt",
      header: "التاريخ",
      sortable: true,
      render: (r) => <span className="mz-num text-ink-muted">{formatDate(r.createdAt)}</span>,
    },
    {
      key: "amount",
      header: "المبلغ",
      align: "end",
      render: (r) => (r.subject?.amount ? <MoneyDisplay value={Number(r.subject.amount)} /> : <span className="text-ink-faint">—</span>),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r) => (
        <div className="flex flex-col items-start gap-[4px]">
          <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
          {r.status === "pending" && r.currentStepRole ? (
            <span className="text-[11px] text-ink-faint">
              بانتظار: {r.currentStepRole} (خطوة <span className="mz-num">{r.currentStep + 1}</span> من{" "}
              <span className="mz-num">{r.totalSteps}</span>)
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-5">
      <DocumentList
        eyebrow="سير العمل"
        title="الموافقات"
        description="طلبات الموافقة التي تحتاج قرارك، وما قدّمته، وما بتّ فيه."
        statusChips={statusChips}
        activeStatusKey={scope}
        onStatusChange={(key) => setScope(key as WorkflowRequestScopeDTO)}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => {
          setSelectedId(r.id);
          setComment("");
          setActionError(null);
        }}
        page={1}
        pageCount={1}
        emptyState={<div className="p-6 text-center text-[13px] text-ink-muted">{EMPTY_MESSAGE[scope]}</div>}
      />

      <SidePanel
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected ? subjectLabel(selected) : "طلب موافقة"}
        description={selected?.actionLabelAr}
      >
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />

            <Card className="flex flex-col gap-[6px] p-3 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">مقدَّم من</span>
                <span className="text-ink">{selected.submittedByName ?? selected.submittedBy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">تاريخ الطلب</span>
                <span className="mz-num text-ink">{formatDate(selected.createdAt)}</span>
              </div>
              {selected.subject?.amount ? (
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-ink-muted">المبلغ</span>
                  <MoneyDisplay value={Number(selected.subject.amount)} />
                </div>
              ) : null}
            </Card>

            <div className="flex flex-col gap-2">
              <span className="text-[12.5px] font-semibold text-ink">خطوات الاعتماد</span>
              {selected.steps.length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">لا توجد خطوات معتمدة على هذا الإجراء.</div>
              ) : (
                selected.steps.map((step, index) => (
                  <div
                    key={`${step.role}-${index}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[12.5px]"
                  >
                    <div className="flex flex-col">
                      <span className="text-ink">{step.role}</span>
                      {step.description ? <span className="text-[11px] text-ink-faint">{step.description}</span> : null}
                    </div>
                    {index === selected.currentStep && selected.status === "pending" ? (
                      <StatusPill label="الدور الحالي" tone="warning" />
                    ) : index < selected.currentStep || selected.status === "approved" ? (
                      <StatusPill label="تم" tone="success" />
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {selected.decisions.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-[12.5px] font-semibold text-ink">سجل القرارات</span>
                {selected.decisions.map((d, index) => (
                  <div key={index} className="flex flex-col gap-[2px] rounded-md bg-surface-3 px-3 py-2 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="text-ink">{d.actorName ?? d.actorId}</span>
                      <span className="text-ink-muted">{DECISION_LABEL[d.kind] ?? d.kind}</span>
                    </div>
                    {d.comment ? <span className="text-ink-muted">{d.comment}</span> : null}
                    {d.at ? <span className="mz-num text-[11px] text-ink-faint">{formatDate(d.at)}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {actionError ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{actionError}</div> : null}

            {selected.canAct ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-[6px]">
                  <span className="text-[12.5px] font-semibold text-ink">تعليق (اختياري)</span>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none transition-colors focus:border-brand"
                  />
                </label>
                <div className="flex gap-2">
                  <Button variant="primary" disabled={pendingId === selected.id} onClick={() => act(selected, "approve")}>
                    اعتماد
                  </Button>
                  <Button variant="danger-outline" disabled={pendingId === selected.id} onClick={() => act(selected, "reject")}>
                    رفض
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

const DECISION_LABEL: Record<string, string> = {
  approve: "اعتماد",
  reject: "رفض",
  request_modification: "طلب تعديل",
  bypass: "تجاوز (مسؤول)",
};
