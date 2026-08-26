import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  MoneyInput,
  RowMenu,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { LeadDTO, LeadSourceDTO, LeadStatusDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useConvertLead, useCreateLead, useLeads, usePipelineStages, useTransitionLead } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** العملاء المحتملون (Leads) — docs/catalog/06 §"العملاء المحتملون". List + detail + create + status transitions + convert. */

const STATUS_KEY: Record<LeadStatusDTO, AppTranslationKey> = {
  new: "leads.status.new",
  contacted: "leads.status.contacted",
  qualified: "leads.status.qualified",
  converted: "leads.status.converted",
  lost: "leads.status.lost",
  unqualified: "leads.status.unqualified",
};

const STATUS_TONE: Record<LeadStatusDTO, PillTone> = {
  new: "info",
  contacted: "warning",
  qualified: "success",
  converted: "success",
  lost: "danger",
  unqualified: "neutral",
};

const SOURCE_KEY: Record<LeadSourceDTO, AppTranslationKey> = {
  website: "leads.source.website",
  referral: "leads.source.referral",
  phone: "leads.source.phone",
  social: "leads.source.social",
  other: "leads.source.other",
};

const LEAD_STATUSES: LeadStatusDTO[] = ["new", "contacted", "qualified", "converted", "lost", "unqualified"];

const PAGE_SIZES = [10, 25, 50, 100] as const;

/** The lifecycle transitions legal from a lead's CURRENT status (docs/catalog/06 state machine). */
function validTransitions(status: LeadStatusDTO): LeadStatusDTO[] {
  switch (status) {
    case "new":
      return ["contacted", "unqualified", "lost"];
    case "contacted":
      return ["qualified", "unqualified", "lost"];
    case "qualified":
      return ["lost"];
    default:
      return [];
  }
}

function toMajor(scaledDecimalString: string | null): number | null {
  return scaledDecimalString === null ? null : Number(scaledDecimalString);
}

interface LeadDraft {
  name: string;
  company: string;
  email: string;
  phone: string;
  source: LeadSourceDTO;
  expectedValue: number | null;
  interest: string;
  notes: string;
}

function blankDraft(): LeadDraft {
  return { name: "", company: "", email: "", phone: "", source: "other", expectedValue: null, interest: "", notes: "" };
}

/** Returns a catalogue KEY, so the caller decides the locale. */
function validateDraft(draft: LeadDraft): AppTranslationKey | null {
  if (draft.name.trim() === "") return "leads.nameRequired";
  return null;
}

interface ConvertDraft {
  createCustomer: boolean;
  customerCode: string;
  createOpportunity: boolean;
  opportunityTitle: string;
  opportunityStageId: string;
  opportunityExpectedValue: number | null;
  opportunityProbability: number;
  opportunityExpectedCloseDate: string;
}

function blankConvertDraft(lead: LeadDTO, firstStageId: string, t: (key: AppTranslationKey, params?: Record<string, string | number>) => string): ConvertDraft {
  return {
    createCustomer: true,
    customerCode: lead.name.trim().slice(0, 20),
    createOpportunity: true,
    opportunityTitle: t("leads.opportunityTitle", { name: lead.name }),
    opportunityStageId: firstStageId,
    opportunityExpectedValue: toMajor(lead.expectedValue),
    opportunityProbability: 50,
    opportunityExpectedCloseDate: "",
  };
}

export function LeadsScreen() {
  const { t } = useAppTranslation();
  const query = useLeads();
  const stagesQuery = usePipelineStages();
  const createLead = useCreateLead();
  const transitionLead = useTransitionLead();
  const convertLead = useConvertLead();
  const leads = query.data ?? [];
  const stages = useMemo(() => [...(stagesQuery.data ?? [])].filter((s) => s.active).sort((a, b) => a.order - b.order), [stagesQuery.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatusDTO>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<LeadDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertDraft, setConvertDraft] = useState<ConvertDraft | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertPending, setConvertPending] = useState(false);

  const filtered = useMemo(() => {
    let rows = leads;
    if (statusFilter !== "all") rows = rows.filter((l) => l.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((l) => l.name.toLowerCase().includes(q) || (l.company ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [leads, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const selected = selectedId ? (leads.find((l) => l.id === selectedId) ?? null) : null;

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
      await createLead.mutateAsync({
        id: crypto.randomUUID(),
        name: draft.name.trim(),
        company: draft.company.trim() === "" ? null : draft.company.trim(),
        email: draft.email.trim() === "" ? null : draft.email.trim(),
        phone: draft.phone.trim() === "" ? null : draft.phone.trim(),
        source: draft.source,
        expectedValue: draft.expectedValue === null ? null : draft.expectedValue.toFixed(6),
        interest: draft.interest.trim() === "" ? null : draft.interest.trim(),
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("leads.theOperationFailed"));
    }
  }

  async function runTransition(lead: LeadDTO, status: LeadStatusDTO) {
    if (pendingRowId) return;
    setPendingRowId(lead.id);
    setDetailError(null);
    try {
      await transitionLead.mutateAsync({ id: lead.id, body: { status } });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : t("leads.failedToUpdateTheStatus"));
    } finally {
      setPendingRowId(null);
    }
  }

  function openConvertForm(lead: LeadDTO) {
    setConvertDraft(blankConvertDraft(lead, stages[0]?.id ?? "", t));
    setConvertError(null);
    setConvertOpen(true);
  }

  async function submitConvert(event: FormEvent) {
    event.preventDefault();
    if (!selected || !convertDraft) return;
    if (convertDraft.createCustomer && convertDraft.customerCode.trim() === "") {
      setConvertError(t("leads.customerCodeIsRequiredTo"));
      return;
    }
    if (convertDraft.createOpportunity && (convertDraft.opportunityTitle.trim() === "" || convertDraft.opportunityStageId === "")) {
      setConvertError(t("leads.opportunityTitleAndStageAre"));
      return;
    }
    setConvertError(null);
    setConvertPending(true);
    try {
      await convertLead.mutateAsync({
        id: selected.id,
        body: {
          createCustomer: convertDraft.createCustomer,
          customer: convertDraft.createCustomer ? { id: crypto.randomUUID(), code: convertDraft.customerCode.trim() } : undefined,
          createOpportunity: convertDraft.createOpportunity,
          opportunity: convertDraft.createOpportunity
            ? {
                id: crypto.randomUUID(),
                title: convertDraft.opportunityTitle.trim(),
                stageId: convertDraft.opportunityStageId,
                expectedValue: (convertDraft.opportunityExpectedValue ?? 0).toFixed(6),
                probability: convertDraft.opportunityProbability,
                expectedCloseDate: convertDraft.opportunityExpectedCloseDate.trim() === "" ? null : convertDraft.opportunityExpectedCloseDate.trim(),
              }
            : undefined,
        },
      });
      setConvertOpen(false);
      setSelectedId(null);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : t("leads.failedToConvertTheLead"));
    } finally {
      setConvertPending(false);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: leads.length },
    ...LEAD_STATUSES.map((s) => ({ key: s, label: t(STATUS_KEY[s]), count: leads.filter((l) => l.status === s).length })),
  ];

  const columns: DocumentListColumn<LeadDTO>[] = [
    { key: "name", header: t("common.name"), render: (l) => <span className="font-semibold text-ink">{l.name}</span> },
    { key: "company", header: t("leads.company"), render: (l) => <span className="text-ink-muted">{l.company ?? "—"}</span> },
    { key: "source", header: t("leads.source"), render: (l) => t(SOURCE_KEY[l.source]) },
    { key: "status", header: t("common.status"), render: (l) => <StatusPill label={t(STATUS_KEY[l.status])} tone={STATUS_TONE[l.status]} /> },
    {
      key: "expectedValue",
      header: t("leads.expectedValue"),
      align: "end",
      render: (l) => (toMajor(l.expectedValue) === null ? <span className="text-ink-faint">—</span> : <MoneyDisplay value={toMajor(l.expectedValue) ?? 0} />),
    },
    { key: "createdAt", header: t("leads.createdDate"), render: (l) => <span className="mz-num text-[11px] text-ink-faint">{l.createdAt.slice(0, 10)}</span> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("leads.failedToLoadLeads")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {detailError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {detailError}
        </div>
      ) : null}
      <DocumentList<LeadDTO>
        title={t("leads.leads")}
        description={t("leads.captureAndQualifyLeadsBefore")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("leads.newLead")}
          </Button>
        }
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | LeadStatusDTO);
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder={t("leads.searchByNameOrCompany")}
        columns={columns}
        rows={pageRows}
        rowKey={(l) => l.id}
        onRowClick={(l) => {
          setDetailError(null);
          setSelectedId(l.id);
        }}
        rowAction={(l) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => { setDetailError(null); setSelectedId(l.id); } },
            ...validTransitions(l.status).map((status) => ({
              key: `transition-${status}`,
              label: t(STATUS_KEY[status]),
              tone: status === "lost" || status === "unqualified" ? ("danger" as const) : undefined,
              disabled: pendingRowId === l.id,
              onSelect: () => void runTransition(l, status),
            })),
            // Converting collects a customer code and an opportunity stage, so it opens that form.
            ...(l.status === "qualified"
              ? [
                  {
                    key: "convert",
                    label: t("leads.convert"),
                    disabled: pendingRowId === l.id,
                    onSelect: () => {
                      setDetailError(null);
                      setSelectedId(l.id);
                      openConvertForm(l);
                    },
                  },
                ]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: l.name })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("leads.lead")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("leads.noData")}
            description={t("leads.emptyBody")}
            action={{ label: t("leads.newLead"), onClick: openCreateForm }}
          />
        }
      />

      {/* -------- Lead detail panel -------- */}
      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.name : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("leads.company")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.company ?? "—"}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("leads.source")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(SOURCE_KEY[selected.source])}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.email")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.email ?? "—"}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.phone")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.phone ?? "—"}</div>
              </div>
            </Card>
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("leads.expectedValue")}</div>
              <div className="mt-[6px]">
                {toMajor(selected.expectedValue) === null ? (
                  <span className="text-ink-faint">—</span>
                ) : (
                  <MoneyDisplay value={toMajor(selected.expectedValue) ?? 0} className="text-[18px] font-bold" />
                )}
              </div>
            </Card>
            {selected.interest ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("leads.interest")}</div>
                <div className="mt-[6px] text-[13px] text-ink">{selected.interest}</div>
              </Card>
            ) : null}
            {selected.notes ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.notes")}</div>
                <div className="mt-[6px] text-[13px] text-ink">{selected.notes}</div>
              </Card>
            ) : null}

            {detailError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {detailError}
              </div>
            ) : null}

            <div className="flex flex-col gap-[8px]">
              {validTransitions(selected.status).map((status) => (
                <Button key={status} variant="primary" disabled={pendingRowId === selected.id} onClick={() => void runTransition(selected, status)}>
                  {t(STATUS_KEY[status])}
                </Button>
              ))}
              {selected.status === "qualified" ? (
                <Button variant="primary" disabled={pendingRowId === selected.id} onClick={() => openConvertForm(selected)}>
                  {t("leads.convert")}
                </Button>
              ) : null}
              {validTransitions(selected.status).length === 0 && selected.status !== "qualified" ? (
                <div className="text-[12.5px] text-ink-muted">{t("leads.noActionsAreAvailableFor")}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Add lead form -------- */}
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("leads.newLead")} description={t("leads.basicLeadInformation")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label={t("leads.name")} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label={t("leads.company")} value={draft.company} onChange={(v) => setDraft((d) => ({ ...d, company: v }))} />
          <TextField label={t("common.email")} type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
          <TextField label={t("common.phone")} type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
          <SelectField
            label={t("leads.source")}
            value={draft.source}
            onChange={(v) => setDraft((d) => ({ ...d, source: v as LeadSourceDTO }))}
            options={(Object.keys(SOURCE_KEY) as LeadSourceDTO[]).map((s) => ({ value: s, label: t(SOURCE_KEY[s]) }))}
          />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("leads.expectedValue")}</div>
            <MoneyInput aria-label={t("leads.expectedValue")} value={draft.expectedValue} onChange={(v) => setDraft((d) => ({ ...d, expectedValue: v }))} />
          </div>
          <TextField
            label={t("leads.interest")}
            value={draft.interest}
            onChange={(v) => setDraft((d) => ({ ...d, interest: v }))}
            placeholder={t("leads.whatProductOrServiceAre")}
          />
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

      {/* -------- Convert lead form -------- */}
      <SidePanel open={convertOpen} onClose={() => setConvertOpen(false)} title={t("leads.convertLead")} description={t("leads.createACustomerAndOr")}>
        {convertDraft ? (
          <form onSubmit={submitConvert} className="flex flex-col gap-[14px]">
            {convertError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {convertError}
              </div>
            ) : null}

            <ToggleField
              label={t("leads.createCustomer")}
              checked={convertDraft.createCustomer}
              onChange={(v) => setConvertDraft((d) => (d ? { ...d, createCustomer: v } : d))}
            />
            {convertDraft.createCustomer ? (
              <TextField
                label={t("leads.customerCode")}
                value={convertDraft.customerCode}
                onChange={(v) => setConvertDraft((d) => (d ? { ...d, customerCode: v } : d))}
              />
            ) : null}

            <ToggleField
              label={t("leads.createOpportunity")}
              checked={convertDraft.createOpportunity}
              onChange={(v) => setConvertDraft((d) => (d ? { ...d, createOpportunity: v } : d))}
            />
            {convertDraft.createOpportunity ? (
              <>
                <TextField
                  label={t("leads.opportunityTitle")}
                  value={convertDraft.opportunityTitle}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityTitle: v } : d))}
                />
                <SelectField
                  label={t("leads.stage")}
                  value={convertDraft.opportunityStageId}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityStageId: v } : d))}
                  options={stages.map((s) => ({ value: s.id, label: s.name }))}
                />
                <div>
                  <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("leads.expectedValue")}</div>
                  <MoneyInput
                    aria-label={t("leads.expectedValue")}
                    value={convertDraft.opportunityExpectedValue}
                    onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityExpectedValue: v } : d))}
                  />
                </div>
                <NumberField
                  label={t("leads.probability")}
                  value={convertDraft.opportunityProbability}
                  min={0}
                  max={100}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityProbability: v } : d))}
                />
                <TextField
                  label={t("leads.expectedCloseDate")}
                  value={convertDraft.opportunityExpectedCloseDate}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityExpectedCloseDate: v } : d))}
                  placeholder="YYYY-MM-DD"
                />
              </>
            ) : null}

            <div className="mt-[6px] flex justify-end gap-[9px]">
              <Button type="button" onClick={() => setConvertOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={convertPending}>
                {t("leads.convert")}
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>
    </div>
  );
}
