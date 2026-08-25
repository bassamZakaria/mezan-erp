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
import { useAppTranslation } from "../i18n";

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
  const { t } = useAppTranslation();
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
      setError(err instanceof Error ? err.message : t("common.failed"));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <TextField label={t("opportunities.title")} value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} />
      <div>
        <EntityPicker
          label={t("opportunities.customer")}
          value={customerOptions.find((o) => o.id === draft.customerId) ?? null}
          onChange={(o) => setDraft((d) => ({ ...d, customerId: o?.id ?? "" }))}
          options={customerOptions}
          placeholder={t("opportunities.chooseTheCustomer")}
        />
      </div>
      <SelectField
        label={t("opportunities.stage")}
        value={draft.stageId}
        onChange={(v) => setDraft((d) => ({ ...d, stageId: v }))}
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
      />
      <div>
        <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("opportunities.expectedValue")}</div>
        <MoneyInput aria-label={t("opportunities.expectedValue")} value={draft.expectedValue} onChange={(v) => setDraft((d) => ({ ...d, expectedValue: v }))} />
      </div>
      <NumberField label={t("opportunities.probability")} value={draft.probability} min={0} max={100} onChange={(v) => setDraft((d) => ({ ...d, probability: v }))} />
      <TextField
        label={t("opportunities.expectedCloseDate")}
        value={draft.expectedCloseDate}
        onChange={(v) => setDraft((d) => ({ ...d, expectedCloseDate: v }))}
        placeholder="YYYY-MM-DD"
      />
      <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

      <div className="mt-[6px] flex justify-end gap-[9px]">
        <Button type="button" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary">
          {t("common.add")}
        </Button>
      </div>
    </form>
  );
}

export function OpportunitiesScreen() {
  const { t } = useAppTranslation();
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
    { key: "all", label: t("common.all"), count: opportunities.length },
    { key: "open", label: t("opportunities.open"), count: openCount },
    { key: "won", label: t("opportunities.won"), count: wonCount },
    { key: "lost", label: t("opportunities.lost"), count: opportunities.filter((o) => o.status === "lost").length },
  ];

  const columns: DocumentListColumn<OpportunityDTO>[] = [
    { key: "title", header: t("opportunities.title2"), render: (o) => <span className="font-semibold text-ink">{o.title}</span> },
    { key: "customer", header: t("common.customer"), render: (o) => <span className="text-ink-muted">{customerName(o.customerId)}</span> },
    { key: "stage", header: t("opportunities.stage2"), render: (o) => stageName(o.stageId) },
    { key: "probability", header: t("opportunities.probability2"), render: (o) => <span className="mz-num">{o.probability}%</span> },
    { key: "expectedValue", header: t("opportunities.expectedValue"), align: "end", render: (o) => <MoneyDisplay value={Number(o.expectedValue)} /> },
    { key: "expectedCloseDate", header: t("opportunities.expectedCloseDate"), render: (o) => <span className="mz-num">{o.expectedCloseDate ?? "—"}</span> },
    { key: "status", header: t("common.status"), render: (o) => <StatusPill label={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("opportunities.opportunitiesCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<OpportunityDTO>
        eyebrow="CRM · Opportunities"
        title={t("opportunities.opportunities")}
        description={t("opportunities.trackingLiveDealsAgainstA")}
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            {t("opportunities.newOpportunity")}
          </Button>
        }
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{opportunities.length}</span> },
          { label: t("opportunities.open"), value: <span className="mz-num">{openCount}</span> },
          { label: t("opportunities.won"), value: <span className="mz-num">{wonCount}</span> },
          { label: t("opportunities.expectedValue"), value: <MoneyDisplay value={totalExpectedValue} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | OpportunityStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("opportunities.searchByTitle")}
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{opportunities.length}</span> {t("opportunities.opportunities2")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("opportunities.nothingToShow")}</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("opportunities.newOpportunity")} description={t("opportunities.opportunityDetails")}>
        <CreateOpportunityForm onDone={() => setFormOpen(false)} onCancel={() => setFormOpen(false)} />
      </SidePanel>
    </div>
  );
}
