import { useMemo, useState } from "react";
import { Button, Card, DocumentList, type DocumentListColumn } from "@mezan/ui";
import { GATEABLE_ACTION_TYPES } from "@mezan/domain";
import type { ApprovalRequestDTO } from "@mezan/contracts";
import { useDecideApproval, usePendingApprovals } from "../data/hooks";

/**
 * الموافقات inbox (docs/catalog/09 §الموافقات) — pending approval requests
 * whose CURRENT step's role the signed-in user holds (server-filtered by
 * `x-role-code`, see workflow-routes.ts's `actorRoles`). Each row's approve /
 * reject / request-modification action calls the real gate engine through
 * `POST /workflow/requests/:id/decide` — no client-side approval logic here.
 */

const ACTION_TYPE_LABEL = new Map<string, string>(GATEABLE_ACTION_TYPES.map((a) => [a.code, a.labelAr]));

function actionTypeLabel(code: string): string {
  return ACTION_TYPE_LABEL.get(code) ?? code;
}

type DecisionAction = "approve" | "reject" | "request_modification";

export function ApprovalsInboxScreen() {
  const query = usePendingApprovals();
  const decide = useDecideApproval();
  const requests = query.data ?? [];

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    if (search.trim() === "") return requests;
    const q = search.trim();
    return requests.filter((r) => actionTypeLabel(r.actionType).includes(q) || (r.entityLabel ?? "").includes(q));
  }, [requests, search]);

  async function act(request: ApprovalRequestDTO, decision: DecisionAction) {
    if (pendingId) return;
    setPendingId(request.id);
    setActionError(null);
    try {
      const comment = commentDraft[request.id]?.trim();
      await decide.mutateAsync({ id: request.id, body: { decision, comment: comment ? comment : undefined } });
      setCommentDraft((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذر تنفيذ القرار");
    } finally {
      setPendingId(null);
    }
  }

  const columns: DocumentListColumn<ApprovalRequestDTO>[] = [
    {
      key: "actionType",
      header: "نوع الإجراء",
      render: (r) => <span className="font-semibold text-ink">{actionTypeLabel(r.actionType)}</span>,
    },
    { key: "entity", header: "التفاصيل", render: (r) => r.entityLabel ?? "—" },
    {
      key: "step",
      header: "الخطوة الحالية",
      render: (r) => (
        <span className="mz-num">
          {r.currentStep + 1} / {r.steps.length}
        </span>
      ),
    },
    { key: "role", header: "الدور المطلوب", render: (r) => r.steps[r.currentStep]?.role ?? "—" },
    { key: "submittedBy", header: "مُقدَّم من", render: (r) => <span className="mz-lat">{r.submittedBy}</span> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <div className="flex items-center justify-end gap-[6px]" onClick={(e) => e.stopPropagation()}>
          <input
            value={commentDraft[r.id] ?? ""}
            onChange={(e) => setCommentDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
            placeholder="ملاحظة (اختياري)"
            aria-label={`ملاحظة على الطلب ${r.entityLabel ?? r.id}`}
            className="w-[140px] rounded-md border border-border bg-surface px-[8px] py-[5px] text-[11.5px] text-ink outline-none transition-colors focus:border-brand"
          />
          <Button size="sm" variant="primary" disabled={pendingId === r.id} onClick={() => void act(r, "approve")}>
            موافقة
          </Button>
          <Button size="sm" variant="ghost" disabled={pendingId === r.id} onClick={() => void act(r, "request_modification")}>
            طلب تعديل
          </Button>
          <Button size="sm" variant="danger-outline" disabled={pendingId === r.id} onClick={() => void act(r, "reject")}>
            رفض
          </Button>
        </div>
      ),
    },
  ];

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الموافقات المعلّقة.</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <DocumentList<ApprovalRequestDTO>
      eyebrow="الموافقات"
      title="الموافقات"
      description="الطلبات المعلّقة بانتظار موافقتك بحسب الأدوار المسندة إليك."
      stats={[{ label: "بانتظار الموافقة", value: <span className="mz-num">{requests.length}</span> }]}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="بحث بنوع الإجراء أو التفاصيل…"
      columns={columns}
      rows={filtered}
      rowKey={(r) => r.id}
      page={1}
      pageCount={1}
      pageSummary={
        <>
          عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{requests.length}</span>
        </>
      }
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد موافقات معلّقة</div>}
      filterBarExtra={
        actionError ? (
          <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">{actionError}</div>
        ) : undefined
      }
    />
  );
}
