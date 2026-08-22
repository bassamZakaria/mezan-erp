import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, SidePanel, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { ActivityDTO, ActivityStatusDTO, ActivityTypeDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { useCancelActivity, useCompleteActivity, useCreateActivity, useCrmActivities } from "../data/hooks";

/** الأنشطة (CRM Activities / My Tasks) — docs/catalog/06 §"مهامي / الأنشطة". List + create + complete/cancel row actions. */

const TYPE_LABEL: Record<ActivityTypeDTO, string> = { call: "مكالمة", meeting: "اجتماع", todo: "مهمة", email: "بريد إلكتروني" };
const STATUS_LABEL: Record<ActivityStatusDTO, string> = { pending: "معلق", completed: "مكتمل", cancelled: "ملغى" };
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

function validateDraft(draft: ActivityDraft): string | null {
  if (draft.subject.trim() === "") return "الموضوع مطلوب.";
  return null;
}

export function ActivitiesScreen() {
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
      setFormError(error);
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
      setFormError(err instanceof Error ? err.message : "تعذّرت العملية.");
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
      setActionError(err instanceof Error ? err.message : "تعذّرت العملية.");
    } finally {
      setPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: activities.length },
    ...ACTIVITY_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], count: activities.filter((a) => a.status === s).length })),
  ];

  const columns: DocumentListColumn<ActivityDTO>[] = [
    { key: "subject", header: "الموضوع", render: (a) => <span className="font-semibold text-ink">{a.subject}</span> },
    { key: "type", header: "النوع", render: (a) => TYPE_LABEL[a.type] },
    { key: "status", header: "الحالة", render: (a) => <StatusPill label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} /> },
    { key: "dueDate", header: "تاريخ الاستحقاق", render: (a) => <span className="mz-num">{a.dueDate ?? "—"}</span> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (a) =>
        a.status === "pending" ? (
          <div className="flex items-center justify-end gap-[6px]">
            <Button size="sm" variant="primary" disabled={pendingId !== null} onClick={() => runAction(a, "complete")}>
              إكمال
            </Button>
            <Button size="sm" variant="danger-outline" disabled={pendingId !== null} onClick={() => runAction(a, "cancel")}>
              إلغاء
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الأنشطة.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {actionError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}
      <DocumentList<ActivityDTO>
        eyebrow="CRM · Activities"
        title="الأنشطة"
        description="سجل مهام المتابعة (مكالمات، اجتماعات، مهام) المرتبطة بالعملاء المحتملين والفرص"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            نشاط جديد
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{activities.length}</span> },
          { label: "معلق", value: <span className="mz-num">{activities.filter((a) => a.status === "pending").length}</span> },
          { label: "مكتمل", value: <span className="mz-num">{activities.filter((a) => a.status === "completed").length}</span> },
          { label: "ملغى", value: <span className="mz-num">{activities.filter((a) => a.status === "cancelled").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | ActivityStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالموضوع..."
        columns={columns}
        rows={filtered}
        rowKey={(a) => a.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{activities.length}</span> نشاط
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أنشطة</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="نشاط جديد" description="بيانات النشاط">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label="الموضوع *" value={draft.subject} onChange={(v) => setDraft((d) => ({ ...d, subject: v }))} />
          <SelectField
            label="النوع"
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as ActivityTypeDTO }))}
            options={(Object.keys(TYPE_LABEL) as ActivityTypeDTO[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
          <TextField label="تاريخ الاستحقاق" value={draft.dueDate} onChange={(v) => setDraft((d) => ({ ...d, dueDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              إضافة
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
