import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  Money as MoneyDisplay,
  MoneyInput,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import type { LeadDTO, LeadSourceDTO, LeadStatusDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useConvertLead, useCreateLead, useLeads, usePipelineStages, useTransitionLead } from "../data/hooks";

/** العملاء المحتملون (Leads) — docs/catalog/06 §"العملاء المحتملون". List + detail + create + status transitions + convert. */

const STATUS_LABEL: Record<LeadStatusDTO, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  qualified: "مؤهل",
  converted: "محول",
  lost: "خسارة",
  unqualified: "غير مؤهل",
};

const STATUS_TONE: Record<LeadStatusDTO, PillTone> = {
  new: "info",
  contacted: "warning",
  qualified: "success",
  converted: "success",
  lost: "danger",
  unqualified: "neutral",
};

const SOURCE_LABEL: Record<LeadSourceDTO, string> = {
  website: "الموقع الإلكتروني",
  referral: "إحالة",
  phone: "هاتف",
  social: "وسائل التواصل",
  other: "أخرى",
};

const LEAD_STATUSES: LeadStatusDTO[] = ["new", "contacted", "qualified", "converted", "lost", "unqualified"];

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

function validateDraft(draft: LeadDraft): string | null {
  if (draft.name.trim() === "") return "الاسم مطلوب.";
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

function blankConvertDraft(lead: LeadDTO, firstStageId: string): ConvertDraft {
  return {
    createCustomer: true,
    customerCode: lead.name.trim().slice(0, 20),
    createOpportunity: true,
    opportunityTitle: `${lead.name} — فرصة`,
    opportunityStageId: firstStageId,
    opportunityExpectedValue: toMajor(lead.expectedValue),
    opportunityProbability: 50,
    opportunityExpectedCloseDate: "",
  };
}

export function LeadsScreen() {
  const query = useLeads();
  const stagesQuery = usePipelineStages();
  const createLead = useCreateLead();
  const transitionLead = useTransitionLead();
  const convertLead = useConvertLead();
  const leads = query.data ?? [];
  const stages = useMemo(() => [...(stagesQuery.data ?? [])].filter((s) => s.active).sort((a, b) => a.order - b.order), [stagesQuery.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatusDTO>("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<LeadStatusDTO | null>(null);

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
      setFormError(err instanceof Error ? err.message : "تعذّرت العملية.");
    }
  }

  async function runTransition(lead: LeadDTO, status: LeadStatusDTO) {
    if (pendingStatus) return;
    setPendingStatus(status);
    setDetailError(null);
    try {
      await transitionLead.mutateAsync({ id: lead.id, body: { status } });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "تعذّر تحديث الحالة.");
    } finally {
      setPendingStatus(null);
    }
  }

  function openConvertForm(lead: LeadDTO) {
    setConvertDraft(blankConvertDraft(lead, stages[0]?.id ?? ""));
    setConvertError(null);
    setConvertOpen(true);
  }

  async function submitConvert(event: FormEvent) {
    event.preventDefault();
    if (!selected || !convertDraft) return;
    if (convertDraft.createCustomer && convertDraft.customerCode.trim() === "") {
      setConvertError("كود العميل مطلوب لإنشاء عميل جديد.");
      return;
    }
    if (convertDraft.createOpportunity && (convertDraft.opportunityTitle.trim() === "" || convertDraft.opportunityStageId === "")) {
      setConvertError("عنوان الفرصة والمرحلة مطلوبان لإنشاء فرصة جديدة.");
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
      setConvertError(err instanceof Error ? err.message : "تعذّر تحويل العميل المحتمل.");
    } finally {
      setConvertPending(false);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: leads.length },
    ...LEAD_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], count: leads.filter((l) => l.status === s).length })),
  ];

  const columns: DocumentListColumn<LeadDTO>[] = [
    { key: "name", header: "الاسم", render: (l) => <span className="font-semibold text-ink">{l.name}</span> },
    { key: "company", header: "الشركة", render: (l) => <span className="text-ink-muted">{l.company ?? "—"}</span> },
    { key: "source", header: "المصدر", render: (l) => SOURCE_LABEL[l.source] },
    { key: "status", header: "الحالة", render: (l) => <StatusPill label={STATUS_LABEL[l.status]} tone={STATUS_TONE[l.status]} /> },
    {
      key: "expectedValue",
      header: "القيمة المتوقعة",
      align: "end",
      render: (l) => (toMajor(l.expectedValue) === null ? <span className="text-ink-faint">—</span> : <MoneyDisplay value={toMajor(l.expectedValue) ?? 0} />),
    },
    { key: "createdAt", header: "تاريخ الإنشاء", render: (l) => <span className="mz-num text-[11px] text-ink-faint">{l.createdAt.slice(0, 10)}</span> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل العملاء المحتملين.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<LeadDTO>
        eyebrow="CRM · Leads"
        title="العملاء المحتملون"
        description="التقاط وتأهيل العملاء المحتملين قبل تحويلهم إلى فرص بيعية"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            عميل محتمل جديد
          </Button>
        }
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | LeadStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم أو الشركة..."
        columns={columns}
        rows={filtered}
        rowKey={(l) => l.id}
        onRowClick={(l) => {
          setDetailError(null);
          setSelectedId(l.id);
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{leads.length}</span> عميل محتمل
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد بيانات</div>}
      />

      {/* -------- Lead detail panel -------- */}
      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.name : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الشركة</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.company ?? "—"}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">المصدر</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{SOURCE_LABEL[selected.source]}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">البريد الإلكتروني</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.email ?? "—"}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الهاتف</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.phone ?? "—"}</div>
              </div>
            </Card>
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">القيمة المتوقعة</div>
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
                <div className="text-[11px] font-semibold text-ink-faint">الاهتمام</div>
                <div className="mt-[6px] text-[13px] text-ink">{selected.interest}</div>
              </Card>
            ) : null}
            {selected.notes ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">ملاحظات</div>
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
                <Button key={status} variant="primary" disabled={pendingStatus !== null} onClick={() => runTransition(selected, status)}>
                  {STATUS_LABEL[status]}
                </Button>
              ))}
              {selected.status === "qualified" ? (
                <Button variant="primary" disabled={pendingStatus !== null} onClick={() => openConvertForm(selected)}>
                  تحويل
                </Button>
              ) : null}
              {validTransitions(selected.status).length === 0 && selected.status !== "qualified" ? (
                <div className="text-[12.5px] text-ink-muted">لا توجد إجراءات متاحة على هذا العميل المحتمل.</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Add lead form -------- */}
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="عميل محتمل جديد" description="بيانات العميل المحتمل الأساسية">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label="الاسم *" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label="الشركة" value={draft.company} onChange={(v) => setDraft((d) => ({ ...d, company: v }))} />
          <TextField label="البريد الإلكتروني" type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
          <TextField label="الهاتف" type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
          <SelectField
            label="المصدر"
            value={draft.source}
            onChange={(v) => setDraft((d) => ({ ...d, source: v as LeadSourceDTO }))}
            options={(Object.keys(SOURCE_LABEL) as LeadSourceDTO[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
          />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">القيمة المتوقعة</div>
            <MoneyInput value={draft.expectedValue} onChange={(v) => setDraft((d) => ({ ...d, expectedValue: v }))} />
          </div>
          <TextField
            label="الاهتمام"
            value={draft.interest}
            onChange={(v) => setDraft((d) => ({ ...d, interest: v }))}
            placeholder="ما هو المنتج أو الخدمة محل الاهتمام؟"
          />
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

      {/* -------- Convert lead form -------- */}
      <SidePanel open={convertOpen} onClose={() => setConvertOpen(false)} title="تحويل العميل المحتمل" description="إنشاء عميل و/أو فرصة من هذا العميل المحتمل">
        {convertDraft ? (
          <form onSubmit={submitConvert} className="flex flex-col gap-[14px]">
            {convertError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {convertError}
              </div>
            ) : null}

            <ToggleField
              label="إنشاء عميل"
              checked={convertDraft.createCustomer}
              onChange={(v) => setConvertDraft((d) => (d ? { ...d, createCustomer: v } : d))}
            />
            {convertDraft.createCustomer ? (
              <TextField
                label="كود العميل *"
                value={convertDraft.customerCode}
                onChange={(v) => setConvertDraft((d) => (d ? { ...d, customerCode: v } : d))}
              />
            ) : null}

            <ToggleField
              label="إنشاء فرصة"
              checked={convertDraft.createOpportunity}
              onChange={(v) => setConvertDraft((d) => (d ? { ...d, createOpportunity: v } : d))}
            />
            {convertDraft.createOpportunity ? (
              <>
                <TextField
                  label="عنوان الفرصة *"
                  value={convertDraft.opportunityTitle}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityTitle: v } : d))}
                />
                <SelectField
                  label="المرحلة *"
                  value={convertDraft.opportunityStageId}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityStageId: v } : d))}
                  options={stages.map((s) => ({ value: s.id, label: s.name }))}
                />
                <div>
                  <div className="mb-[6px] text-[12.5px] font-semibold text-ink">القيمة المتوقعة</div>
                  <MoneyInput
                    value={convertDraft.opportunityExpectedValue}
                    onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityExpectedValue: v } : d))}
                  />
                </div>
                <NumberField
                  label="الاحتمالية %"
                  value={convertDraft.opportunityProbability}
                  min={0}
                  max={100}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityProbability: v } : d))}
                />
                <TextField
                  label="تاريخ الإغلاق المتوقع"
                  value={convertDraft.opportunityExpectedCloseDate}
                  onChange={(v) => setConvertDraft((d) => (d ? { ...d, opportunityExpectedCloseDate: v } : d))}
                  placeholder="YYYY-MM-DD"
                />
              </>
            ) : null}

            <div className="mt-[6px] flex justify-end gap-[9px]">
              <Button type="button" onClick={() => setConvertOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" variant="primary" disabled={convertPending}>
                تحويل
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>
    </div>
  );
}
