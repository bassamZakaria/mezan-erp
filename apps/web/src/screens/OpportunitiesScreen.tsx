import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  EntityPicker,
  Money as MoneyDisplay,
  MoneyInput,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import type { OpportunityDTO, OpportunityStatusDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import { useCreateOpportunity, useCustomers, useOpportunities, usePipelineStages } from "../data/hooks";

/** الفرص (Opportunities) — docs/catalog/06 §"الفرص". List + create. Stage moves happen from the Pipeline board. */

const STATUS_LABEL: Record<OpportunityStatusDTO, string> = { open: "مفتوحة", won: "مكسوبة", lost: "خسارة" };
const STATUS_TONE: Record<OpportunityStatusDTO, PillTone> = { open: "info", won: "success", lost: "danger" };

interface OpportunityDraft {
  title: string;
  customerId: string;
  stageId: string;
  expectedValue: number | null;
  probability: number;
  expectedCloseDate: string;
  notes: string;
}

export function blankOpportunityDraft(defaultStageId: string): OpportunityDraft {
  return { title: "", customerId: "", stageId: defaultStageId, expectedValue: null, probability: 50, expectedCloseDate: "", notes: "" };
}

export function validateOpportunityDraft(draft: OpportunityDraft): string | null {
  if (draft.title.trim() === "") return "العنوان مطلوب.";
  if (draft.customerId === "") return "العميل مطلوب.";
  if (draft.stageId === "") return "المرحلة مطلوبة.";
  return null;
}

interface CreateOpportunityFormProps {
  onDone: () => void;
  onCancel: () => void;
  defaultStageId?: string;
}

/** Shared create-opportunity form — reused as-is by PipelineScreen's "إضافة فرصة" action. */
export function CreateOpportunityForm({ onDone, onCancel, defaultStageId }: CreateOpportunityFormProps) {
  const customersQuery = useCustomers();
  const stagesQuery = usePipelineStages();
  const createOpportunity = useCreateOpportunity();
  const stages = useMemo(() => [...(stagesQuery.data ?? [])].filter((s) => s.active).sort((a, b) => a.order - b.order), [stagesQuery.data]);
  const [draft, setDraft] = useState<OpportunityDraft>(() => blankOpportunityDraft(defaultStageId ?? stages[0]?.id ?? ""));
  const [error, setError] = useState<string | null>(null);

  // Pipeline stages load asynchronously, so the form's default stage (when the
  // caller doesn't pass one) is only known once that query resolves.
  useEffect(() => {
    if (defaultStageId === undefined && draft.stageId === "" && stages.length > 0) {
      setDraft((d) => (d.stageId === "" ? { ...d, stageId: stages[0]!.id } : d));
    }
  }, [defaultStageId, stages, draft.stageId]);

  const customerOptions: EntityPickerOption[] = (customersQuery.data ?? []).map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateOpportunityDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    try {
      await createOpportunity.mutateAsync({
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        customerId: draft.customerId,
        stageId: draft.stageId,
        expectedValue: draft.expectedValue === null ? undefined : draft.expectedValue.toFixed(6),
        probability: draft.probability,
        expectedCloseDate: draft.expectedCloseDate.trim() === "" ? null : draft.expectedCloseDate.trim(),
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّرت العملية.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <TextField label="العنوان *" value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} />
      <div>
        <EntityPicker
          label="العميل *"
          value={customerOptions.find((o) => o.id === draft.customerId) ?? null}
          onChange={(o) => setDraft((d) => ({ ...d, customerId: o?.id ?? "" }))}
          options={customerOptions}
          placeholder="اختر العميل..."
        />
      </div>
      <SelectField
        label="المرحلة *"
        value={draft.stageId}
        onChange={(v) => setDraft((d) => ({ ...d, stageId: v }))}
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
      />
      <div>
        <div className="mb-[6px] text-[12.5px] font-semibold text-ink">القيمة المتوقعة</div>
        <MoneyInput aria-label="القيمة المتوقعة" value={draft.expectedValue} onChange={(v) => setDraft((d) => ({ ...d, expectedValue: v }))} />
      </div>
      <NumberField label="الاحتمالية %" value={draft.probability} min={0} max={100} onChange={(v) => setDraft((d) => ({ ...d, probability: v }))} />
      <TextField
        label="تاريخ الإغلاق المتوقع"
        value={draft.expectedCloseDate}
        onChange={(v) => setDraft((d) => ({ ...d, expectedCloseDate: v }))}
        placeholder="YYYY-MM-DD"
      />
      <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

      <div className="mt-[6px] flex justify-end gap-[9px]">
        <Button type="button" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" variant="primary">
          إضافة
        </Button>
      </div>
    </form>
  );
}

export function OpportunitiesScreen() {
  const query = useOpportunities();
  const customersQuery = useCustomers();
  const stagesQuery = usePipelineStages();
  const opportunities = query.data ?? [];

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customersQuery.data ?? []) map.set(c.id, c.nameAr);
    return (id: string) => map.get(id) ?? id;
  }, [customersQuery.data]);

  const stageName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stagesQuery.data ?? []) map.set(s.id, s.name);
    return (id: string) => map.get(id) ?? id;
  }, [stagesQuery.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OpportunityStatusDTO>("all");
  const [formOpen, setFormOpen] = useState(false);

  const filtered = useMemo(() => {
    let rows = opportunities;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) => o.title.toLowerCase().includes(q));
    }
    return rows;
  }, [opportunities, statusFilter, search]);

  const openCount = opportunities.filter((o) => o.status === "open").length;
  const wonCount = opportunities.filter((o) => o.status === "won").length;
  const totalExpectedValue = opportunities.reduce((sum, o) => sum + Number(o.expectedValue), 0);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: opportunities.length },
    { key: "open", label: "مفتوحة", count: openCount },
    { key: "won", label: "مكسوبة", count: wonCount },
    { key: "lost", label: "خسارة", count: opportunities.filter((o) => o.status === "lost").length },
  ];

  const columns: DocumentListColumn<OpportunityDTO>[] = [
    { key: "title", header: "العنوان", render: (o) => <span className="font-semibold text-ink">{o.title}</span> },
    { key: "customer", header: "العميل", render: (o) => <span className="text-ink-muted">{customerName(o.customerId)}</span> },
    { key: "stage", header: "المرحلة", render: (o) => stageName(o.stageId) },
    { key: "probability", header: "الاحتمالية", render: (o) => <span className="mz-num">{o.probability}%</span> },
    { key: "expectedValue", header: "القيمة المتوقعة", align: "end", render: (o) => <MoneyDisplay value={Number(o.expectedValue)} /> },
    { key: "expectedCloseDate", header: "تاريخ الإغلاق المتوقع", render: (o) => <span className="mz-num">{o.expectedCloseDate ?? "—"}</span> },
    { key: "status", header: "الحالة", render: (o) => <StatusPill label={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الفرص.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<OpportunityDTO>
        eyebrow="CRM · Opportunities"
        title="الفرص"
        description="متابعة الصفقات البيعية الجارية مقابل عميل، بقيمة وتاريخ إغلاق متوقعين ومرحلة في خط المبيعات"
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            فرصة جديدة
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{opportunities.length}</span> },
          { label: "مفتوحة", value: <span className="mz-num">{openCount}</span> },
          { label: "مكسوبة", value: <span className="mz-num">{wonCount}</span> },
          { label: "القيمة المتوقعة", value: <MoneyDisplay value={totalExpectedValue} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | OpportunityStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالعنوان..."
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{opportunities.length}</span> فرصة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد بيانات</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="فرصة جديدة" description="بيانات الفرصة البيعية">
        <CreateOpportunityForm onDone={() => setFormOpen(false)} onCancel={() => setFormOpen(false)} />
      </SidePanel>
    </div>
  );
}
