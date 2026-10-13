import { useEffect, useMemo, useState } from "react";
import { ApprovalStatusCode } from "@mezan/contracts";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentList,
  EmptyState,
  RowMenu,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { GATEABLE_ACTION_TYPES } from "@mezan/domain";
import type { ApprovalRequestDTO } from "@mezan/contracts";
import { useDecideApproval, useMyApprovalDecisions, useMyApprovalRequests, usePendingApprovals, useRoles, useUsers } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { useDomainLabels } from "../lib/domain-labels";
import { useUrlNumber, useUrlSearch } from "../lib/url-state";

/**
 * الموافقات (docs/archive/reference-parity/REQUIREMENTS.md R12.1, R14.1) — three
 * scoped views over the same approval log:
 *
 * - **الوارد** requests whose CURRENT step's role the signed-in user holds,
 *   server-filtered by `x-role-code`; the only tab that can decide anything.
 * - **طلباتي** requests this user submitted, whatever their state.
 * - **إجراءاتي** requests this user has already decided on.
 *
 * Each decision calls the real gate engine through
 * `POST /workflow/requests/:id/decide` — no client-side approval logic here.
 */

type TabKey = "inbox" | "mine" | "acted";
type DecisionAction = "approve" | "reject" | "request_modification";

const ANY_TYPE = "__all__";
const PAGE_SIZES = [10, 25, 50, 100] as const;

/** What the request is about: its own label, else the held document's number, else the reference the document was saved under. */
function requestLabel(request: ApprovalRequestDTO): string | null {
  return request.entityLabel ?? request.documentNo ?? request.documentId;
}

export function ApprovalsInboxScreen() {
  const { t } = useAppTranslation();
  const { label: domainLabel } = useDomainLabels();

  const inbox = usePendingApprovals();
  const mine = useMyApprovalRequests();
  const acted = useMyApprovalDecisions();
  const decide = useDecideApproval();
  const roles = useRoles().data;
  const users = useUsers().data;
  const roleNames = useMemo(() => new Map((roles ?? []).map((role) => [role.code, role.name])), [roles]);
  const userNames = useMemo(() => new Map((users ?? []).map((user) => [user.id, user.nameAr])), [users]);

  const [tab, setTab] = useState<TabKey>("inbox");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchText, setSearchText, search] = useUrlSearch();
  const [actionTypeFilter, setActionTypeFilter] = useState<string>(ANY_TYPE);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const actionTypeLabel = useMemo(() => {
    const byCode = new Map<string, string>(GATEABLE_ACTION_TYPES.map((a) => [a.code, domainLabel(a)]));
    return (code: string) => byCode.get(code) ?? code;
  }, [domainLabel]);

  const query = tab === "inbox" ? inbox : tab === "mine" ? mine : acted;
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((row) => {
      if (actionTypeFilter !== ANY_TYPE && row.actionType !== actionTypeFilter) return false;
      if (q === "") return true;
      return actionTypeLabel(row.actionType).includes(q) || (requestLabel(row) ?? "").includes(q) || (row.submittedByName ?? "").includes(q);
    });
  }, [rows, search, actionTypeFilter, actionTypeLabel]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = actionTypeFilter === ANY_TYPE ? 0 : 1;

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
      setActionError(err instanceof Error ? err.message : t("approvals.couldNotRecordTheDecision"));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  const documentColumn: DocumentListColumn<ApprovalRequestDTO> = {
    key: "entity",
    header: t("approvals.document"),
    render: (r) => (
      <span className="flex flex-col">
        <span className="font-semibold text-ink">{requestLabel(r) ?? "—"}</span>
        <span className="text-xs text-ink-muted">{actionTypeLabel(r.actionType)}</span>
      </span>
    ),
  };

  const progressColumn: DocumentListColumn<ApprovalRequestDTO> = {
    key: "step",
    header: t("approvals.progress"),
    render: (r) => (
      <span className="mz-num">
        {Math.min(r.currentStep + 1, r.steps.length)} / {r.steps.length}
      </span>
    ),
  };

  const statusColumn: DocumentListColumn<ApprovalRequestDTO> = {
    key: "status",
    header: t("approvals.status"),
    render: (r) => <StatusPill tone={approvalTone(r.status)} label={t(approvalStatusKey(r.status))} />,
  };

  const submittedColumn: DocumentListColumn<ApprovalRequestDTO> = {
    key: "createdAt",
    header: t("approvals.submittedAt"),
    render: (r) => <span className="mz-num">{r.createdAt.slice(0, 10)}</span>,
  };

  const noteColumn: DocumentListColumn<ApprovalRequestDTO> = {
    key: "note",
    header: "",
    align: "end",
    render: (r) => (
      <div onClick={(e) => e.stopPropagation()}>
        <TextInput
          size="sm"
          className="min-h-0 w-[140px] px-[8px] py-[5px] text-[11.5px]"
          value={commentDraft[r.id] ?? ""}
          onChange={(e) => setCommentDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
          placeholder={t("approvals.noteOptional")}
          aria-label={t("approvals.noteLabel", { request: requestLabel(r) ?? r.id })}
        />
      </div>
    ),
  };

  const columns: DocumentListColumn<ApprovalRequestDTO>[] =
    tab === "inbox"
      ? [
          documentColumn,
          progressColumn,
          { key: "role", header: t("approvals.roleRequired"), render: (r) => roleNames.get(r.steps[r.currentStep]?.role ?? "") ?? r.steps[r.currentStep]?.role ?? "—" },
          { key: "submittedBy", header: t("approvals.raisedBy"), render: (r) => r.submittedByName ?? userNames.get(r.submittedBy) ?? <span className="mz-lat">{r.submittedBy}</span> },
          noteColumn,
        ]
      : [documentColumn, statusColumn, progressColumn, submittedColumn];

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("approvals.couldNotLoadThePending")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <DocumentList<ApprovalRequestDTO>
      title={t("approvals.approvals")}
      description={t("approvals.theRequestsWaitingOnYou")}
      listKey="approvals-inbox"
      statsCollapsible
      stats={[{ label: t("approvals.awaitingApproval"), value: <span className="mz-num">{inbox.data?.length ?? 0}</span> }]}
      statusChips={[
        { key: "inbox", label: t("approvals.tab.inbox"), count: inbox.data?.length ?? 0 },
        { key: "mine", label: t("approvals.tab.mine"), count: mine.data?.length ?? 0 },
        { key: "acted", label: t("approvals.tab.acted"), count: acted.data?.length ?? 0 },
      ]}
      activeStatusKey={tab}
      onStatusChange={(key) => {
        setTab(key as TabKey);
        setPage(1);
      }}
      searchValue={searchText}
      onSearchChange={(value) => {
        setSearchText(value);
        setPage(1);
      }}
      searchPlaceholder={t("approvals.searchByActionTypeOr")}
      filterBarCollapsible
      activeFilterCount={activeFilterCount}
      filterBarExtra={
        <div className="flex flex-wrap items-center gap-[10px]">
          <Select
            size="sm"
            aria-label={t("approvals.filterByDocumentType")}
            value={actionTypeFilter}
            onChange={(v) => {
              setActionTypeFilter(v);
              setPage(1);
            }}
            className="w-[220px]"
            options={[
              { value: ANY_TYPE, label: t("approvals.allDocumentTypes") },
              ...GATEABLE_ACTION_TYPES.map((a) => ({ value: a.code, label: domainLabel(a) })),
            ]}
          />
          {actionError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">{actionError}</div>
          ) : null}
        </div>
      }
      columns={columns}
      rows={pageRows}
      loading={query.isLoading}
      rowKey={(r) => r.id}
      rowAction={
        tab === "inbox"
          ? (r) => {
              const menuItems: RowMenuItem[] =
                r.status === "pending"
                  ? [
                      { key: "approve", label: t("approvals.approve"), disabled: pendingId === r.id, onSelect: () => act(r, "approve") },
                      {
                        key: "request_modification",
                        label: t("approvals.askForAChange"),
                        disabled: pendingId === r.id,
                        onSelect: () => act(r, "request_modification"),
                      },
                      { key: "reject", label: t("approvals.reject"), tone: "danger", disabled: pendingId === r.id, onSelect: () => act(r, "reject") },
                    ]
                  : [];
              return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: requestLabel(r) ?? r.id })} />;
            }
          : undefined
      }
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
          {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{rows.length}</span>
        </>
      }
      emptyState={<EmptyState title={t(emptyKeyFor(tab))} description={t("approvals.emptyBody")} />}
    />
  );
}

function approvalTone(status: ApprovalRequestDTO["status"]): PillTone {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "modification_requested" || status === ApprovalStatusCode.ReapprovalRequired) return "warning";
  return "neutral";
}

function approvalStatusKey(status: ApprovalRequestDTO["status"]) {
  if (status === "approved") return "approvals.status.approved" as const;
  if (status === "rejected") return "approvals.status.rejected" as const;
  if (status === "modification_requested") return "approvals.status.changesRequested" as const;
  if (status === ApprovalStatusCode.ReapprovalRequired) return "approvals.status.reapprovalRequired" as const;
  return "approvals.status.pending" as const;
}

function emptyKeyFor(tab: TabKey) {
  if (tab === "mine") return "approvals.empty.mine" as const;
  if (tab === "acted") return "approvals.empty.acted" as const;
  return "approvals.noApprovalsArePending" as const;
}
