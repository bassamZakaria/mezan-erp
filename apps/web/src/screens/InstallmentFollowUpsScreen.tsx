import { useEffect, useMemo, useState } from "react";
import { Button, Card, DocumentList, StatusPill, SidePanel, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { CollectionFollowUpDTO, FollowUpStatusDTO, FollowUpTypeDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { useCancelFollowUp, useCompleteFollowUp, useCreateFollowUp, useCustomers, useFollowUps } from "../data/hooks";

/** متابعة التحصيل (Collection Follow-ups) — docs/catalog/05. A collections-agent worklog against customers with overdue installment balances. */

const TYPE_LABEL: Record<FollowUpTypeDTO, string> = { CALL: "اتصال", VISIT: "زيارة", SMS: "رسالة نصية", EMAIL: "بريد إلكتروني", NOTE: "ملاحظة" };
const STATUS_LABEL: Record<FollowUpStatusDTO, string> = { pending: "معلق", completed: "مكتمل", cancelled: "ملغي" };
const STATUS_TONE: Record<FollowUpStatusDTO, PillTone> = { pending: "warning", completed: "success", cancelled: "neutral" };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InstallmentFollowUpsScreen() {
  const query = useFollowUps();
  const customersQuery = useCustomers();
  const createFollowUp = useCreateFollowUp();
  const completeFollowUp = useCompleteFollowUp();
  const cancelFollowUp = useCancelFollowUp();

  const followUps = query.data ?? [];
  const customers = customersQuery.data ?? [];

  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [customers]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | FollowUpStatusDTO>("all");
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState<FollowUpTypeDTO>("CALL");
  const [followUpDate, setFollowUpDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: followUps.length, pending: 0, completed: 0, cancelled: 0 };
    for (const f of followUps) {
      if (f.status === "pending") c.pending += 1;
      if (f.status === "completed") c.completed += 1;
      if (f.status === "cancelled") c.cancelled += 1;
    }
    return c;
  }, [followUps]);

  const filtered = statusFilter === "all" ? followUps : followUps.filter((f) => f.status === statusFilter);
  const selected = typeof panel === "object" ? (followUps.find((f) => f.id === panel.id) ?? null) : null;

  // Defaults the create form's customer picker once the customers query resolves —
  // opening the panel alone can't do this if it happens before `customers` has loaded.
  useEffect(() => {
    if (panel !== "create" || customerId !== "") return;
    const firstCustomer = customers[0];
    if (firstCustomer) setCustomerId(firstCustomer.id);
  }, [panel, customers, customerId]);

  function openCreate() {
    setError(null);
    setCustomerId(customers[0]?.id ?? "");
    setType("CALL");
    setFollowUpDate(today());
    setNotes("");
    setPanel("create");
  }

  async function submit() {
    setError(null);
    if (!customerId) {
      setError("اختر عميلاً.");
      return;
    }
    try {
      await createFollowUp.mutateAsync({
        id: crypto.randomUUID(),
        customerId,
        type,
        followUpDate,
        notes: notes.trim() || null,
      });
      setPanel("none");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function complete(f: CollectionFollowUpDTO) {
    setError(null);
    try {
      await completeFollowUp.mutateAsync({ id: f.id, outcome: outcome.trim() || "تمت المتابعة" });
      setPanel("none");
      setOutcome("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancel(f: CollectionFollowUpDTO) {
    setError(null);
    try {
      await cancelFollowUp.mutateAsync(f.id);
      setPanel("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "pending", label: "معلق", count: counts.pending },
    { key: "completed", label: "مكتمل", count: counts.completed },
    { key: "cancelled", label: "ملغي", count: counts.cancelled },
  ];

  const columns: DocumentListColumn<CollectionFollowUpDTO>[] = [
    { key: "customer", header: "العميل", render: (f) => customerName(f.customerId) },
    { key: "type", header: "نوع المتابعة", render: (f) => TYPE_LABEL[f.type] },
    { key: "date", header: "تاريخ المتابعة", render: (f) => <span className="mz-num">{f.followUpDate}</span> },
    { key: "owner", header: "مسؤول المتابعة", render: (f) => f.assignedTo ?? "أنا" },
    { key: "outcome", header: "النتيجة", render: (f) => f.outcome ?? "—" },
    { key: "status", header: "الحالة", render: (f) => <StatusPill label={STATUS_LABEL[f.status]} tone={STATUS_TONE[f.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل متابعات التحصيل.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<CollectionFollowUpDTO>
        eyebrow="Installments · Collection Follow-ups"
        title="متابعة التحصيل"
        description="سجل نقاط تواصل التحصيل مع عملاء عليهم أقساط متأخرة."
        actions={
          <Button variant="primary" onClick={openCreate}>
            متابعة جديدة
          </Button>
        }
        stats={[
          { label: "إجمالي المتابعات", value: <span className="mz-num">{counts.all}</span> },
          { label: "المعلقة", value: <span className="mz-num">{counts.pending}</span> },
          { label: "المكتملة", value: <span className="mz-num">{counts.completed}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | FollowUpStatusDTO)}
        columns={columns}
        rows={filtered}
        rowKey={(f) => f.id}
        onRowClick={(f) => setPanel({ id: f.id })}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> متابعة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لم يتم إنشاء أي متابعات بعد</div>}
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title="متابعة جديدة">
        <div className="flex flex-col gap-4 p-5">
          <SelectField label="العميل *" value={customerId} onChange={setCustomerId} options={customers.map((c) => ({ value: c.id, label: c.nameAr }))} />
          <SelectField label="نوع المتابعة *" value={type} onChange={(v) => setType(v as FollowUpTypeDTO)} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink-muted">تاريخ المتابعة *</span>
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="h-[38px] rounded-[8px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
            />
          </label>
          <TextField label="ملاحظات" value={notes} onChange={setNotes} placeholder="اتركه فارغاً لتعيين المتابعة لنفسك" />
          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
          <Button variant="primary" onClick={submit}>
            إضافة
          </Button>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected ? customerName(selected.customerId) : "متابعة"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <div className="text-[12.5px] text-ink-muted">
              {TYPE_LABEL[selected.type]} — {selected.followUpDate}
            </div>
            {selected.notes ? <div className="text-[13px] text-ink">{selected.notes}</div> : null}
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            {selected.status === "pending" ? (
              <>
                <TextField label="النتيجة" value={outcome} onChange={setOutcome} placeholder="مثال: وعد بالدفع الأسبوع القادم" />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => complete(selected)}>
                    إكمال المتابعة
                  </Button>
                  <Button variant="ghost" onClick={() => cancel(selected)}>
                    إلغاء
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
