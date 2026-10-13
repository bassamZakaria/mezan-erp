import { useMemo, useState, type FormEvent } from "react";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentList,
  EmptyState,
  RowMenu,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { ActivityDTO, ActivityStatusDTO, ActivityTypeDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { useCancelActivity, useCompleteActivity, useCreateActivity, useCrmActivities } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** الأنشطة (CRM Activities / My Tasks) — docs/archive/catalog/06 §"مهامي / الأنشطة". List + create + complete/cancel row actions. */

const TYPE_KEY: Record<ActivityTypeDTO, AppTranslationKey> = { call: "activities.type.call", meeting: "activities.type.meeting", todo: "activities.type.todo", email: "activities.typeEmail" };
const STATUS_KEY: Record<ActivityStatusDTO, AppTranslationKey> = { pending: "activities.status.pending", completed: "activities.status.completed", cancelled: "activities.status.cancelled" };
const STATUS_TONE: Record<ActivityStatusDTO, PillTone> = { pending: "warning", completed: "success", cancelled: "neutral" };
const ACTIVITY_STATUSES: ActivityStatusDTO[] = ["pending", "completed", "cancelled"];

const PAGE_SIZES = [10, 25, 50, 100] as const;

interface ActivityDraft {
  subject: string;
  type: ActivityTypeDTO;
  dueDate: string;
  notes: string;
}

function blankDraft(): ActivityDraft {
  return { subject: "", type: "call", dueDate: "", notes: "" };
}

/** Returns a catalogue KEY, so the caller decides the locale. */
function validateDraft(draft: ActivityDraft): AppTranslationKey | null {
  if (draft.subject.trim() === "") return "activities.subjectRequired";
  return null;
}

export function ActivitiesScreen() {
  const { t } = useAppTranslation();
  const query = useCrmActivities();
  const createActivity = useCreateActivity();
  const completeActivity = useCompleteActivity();
  const cancelActivity = useCancelActivity();
  const activities = query.data ?? EMPTY;

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | ActivityStatusDTO,
    (next: string) => void,
  ];
  const [formOpen, setFormOpen] = useState(false);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [draft, setDraft] = useState<ActivityDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = activities;
    if (statusFilter !== "all") rows = rows.filter((a) => a.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((a) => a.subject.toLowerCase().includes(q));
    }
    return rows;
  }, [activities, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft);
    if (error) {
      setFormError(t(error));
      return;
    }
    setFormError(null);
    try {
      await createActivity.mutateAsync({
        id: crypto.randomUUID(),
        subject: draft.subject.trim(),
        type: draft.type,
        dueDate: draft.dueDate.trim() === "" ? null : draft.dueDate.trim(),
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.failed"));
    }
  }

  async function runAction(activity: ActivityDTO, action: "complete" | "cancel") {
    if (pendingId) return;
    setPendingId(activity.id);
    setActionError(null);
    try {
      if (action === "complete") await completeActivity.mutateAsync(activity.id);
      else await cancelActivity.mutateAsync(activity.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("common.failed"));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: activities.length },
    ...ACTIVITY_STATUSES.map((s) => ({ key: s, label: t(STATUS_KEY[s]), count: activities.filter((a) => a.status === s).length })),
  ];

  const columns: DocumentListColumn<ActivityDTO>[] = [
    { key: "subject", header: t("activities.subject"), render: (a) => <span className="font-semibold text-ink">{a.subject}</span> },
    { key: "type", header: t("common.type"), render: (a) => t(TYPE_KEY[a.type]) },
    { key: "status", header: t("common.status"), render: (a) => <StatusPill label={t(STATUS_KEY[a.status])} tone={STATUS_TONE[a.status]} /> },
    { key: "dueDate", header: t("activities.dueDate"), render: (a) => <span className="mz-num">{a.dueDate ?? "—"}</span> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("activities.activitiesCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {actionError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}
      <DocumentList<ActivityDTO>
        title={t("activities.activities")}
        description={t("activities.aRecordOfFollowUp")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("activities.newActivity")}
          </Button>
        }
        listKey="activities"
        statsCollapsible
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{activities.length}</span> },
          { label: t("activities.pending"), value: <span className="mz-num">{activities.filter((a) => a.status === "pending").length}</span> },
          { label: t("activities.completed"), value: <span className="mz-num">{activities.filter((a) => a.status === "completed").length}</span> },
          { label: t("activities.cancelled"), value: <span className="mz-num">{activities.filter((a) => a.status === "cancelled").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | ActivityStatusDTO);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(v) => {
          setSearchText(v);
          setPage(1);
        }}
        searchPlaceholder={t("activities.searchBySubject")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(a) => a.id}
        rowAction={(a) => {
          const menuItems: RowMenuItem[] =
            a.status === "pending"
              ? [
                  { key: "complete", label: t("activities.complete"), disabled: pendingId === a.id, onSelect: () => runAction(a, "complete") },
                  { key: "cancel", label: t("common.cancel"), tone: "danger", disabled: pendingId === a.id, onSelect: () => runAction(a, "cancel") },
                ]
              : [];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: a.subject })} />;
        }}
        page={currentPage}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("activities.activities2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("activities.noActivities")}
            description={t("activities.emptyBody")}
            action={{ label: t("activities.newActivity"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("activities.newActivity")} description={t("activities.activityDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label={t("activities.subject2")} value={draft.subject} onChange={(v) => setDraft((d) => ({ ...d, subject: v }))} />
          <SelectField
            label={t("common.type")}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as ActivityTypeDTO }))}
            options={(Object.keys(TYPE_KEY) as ActivityTypeDTO[]).map((code) => ({ value: code, label: t(TYPE_KEY[code]) }))}
          />
          <TextField label={t("activities.dueDate")} value={draft.dueDate} onChange={(v) => setDraft((d) => ({ ...d, dueDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
