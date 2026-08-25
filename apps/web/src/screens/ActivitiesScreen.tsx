import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, SidePanel, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { ActivityDTO, ActivityStatusDTO, ActivityTypeDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { useCancelActivity, useCompleteActivity, useCreateActivity, useCrmActivities } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** الأنشطة (CRM Activities / My Tasks) — docs/catalog/06 §"مهامي / الأنشطة". List + create + complete/cancel row actions. */

const TYPE_KEY: Record<ActivityTypeDTO, AppTranslationKey> = { call: "activities.type.call", meeting: "activities.type.meeting", todo: "activities.type.todo", email: "activities.typeEmail" };
const STATUS_KEY: Record<ActivityStatusDTO, AppTranslationKey> = { pending: "activities.status.pending", completed: "activities.status.completed", cancelled: "activities.status.cancelled" };
const STATUS_TONE: Record<ActivityStatusDTO, PillTone> = { pending: "warning", completed: "success", cancelled: "neutral" };
const ACTIVITY_STATUSES: ActivityStatusDTO[] = ["pending", "completed", "cancelled"];

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
  const activities = query.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ActivityStatusDTO>("all");
  const [formOpen, setFormOpen] = useState(false);
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
    {
      key: "actions",
      header: "",
      align: "end",
      render: (a) =>
        a.status === "pending" ? (
          <div className="flex items-center justify-end gap-[6px]">
            <Button size="sm" variant="primary" disabled={pendingId !== null} onClick={() => runAction(a, "complete")}>
              {t("activities.complete")}
            </Button>
            <Button size="sm" variant="danger-outline" disabled={pendingId !== null} onClick={() => runAction(a, "cancel")}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("activities.activitiesCouldNotBeLoaded")}</p>
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
        eyebrow={t("eyebrow.crm.activities")}
        title={t("activities.activities")}
        description={t("activities.aRecordOfFollowUp")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("activities.newActivity")}
          </Button>
        }
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{activities.length}</span> },
          { label: t("activities.pending"), value: <span className="mz-num">{activities.filter((a) => a.status === "pending").length}</span> },
          { label: t("activities.completed"), value: <span className="mz-num">{activities.filter((a) => a.status === "completed").length}</span> },
          { label: t("activities.cancelled"), value: <span className="mz-num">{activities.filter((a) => a.status === "cancelled").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | ActivityStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("activities.searchBySubject")}
        columns={columns}
        rows={filtered}
        rowKey={(a) => a.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{activities.length}</span> {t("activities.activities2")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("activities.noActivities")}</div>}
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
