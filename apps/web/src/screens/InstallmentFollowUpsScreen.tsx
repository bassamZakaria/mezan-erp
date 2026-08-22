import { useMemo, useRef, useState } from "react";
import { Button, DocumentList, StatusPill, SidePanel, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import { createFollowUp, completeFollowUp, cancelFollowUp, type CollectionFollowUp, type FollowUpStatus, type FollowUpType } from "@mezan/domain";
import { SelectField, TextField } from "../settings/form-controls";
import { demoCustomers } from "../partners-sample-data";
import { createReturnsLandedInstallmentsStore } from "../store/returns-landed-installments-store";
import { demoAccounts, demoOpenPeriod } from "../store/document-demo-shared";

/** متابعة التحصيل (Collection Follow-ups) — docs/catalog/05. A collections-agent worklog against customers with overdue installment balances. */

const TYPE_LABEL: Record<FollowUpType, string> = { CALL: "اتصال", VISIT: "زيارة", SMS: "رسالة نصية", EMAIL: "بريد إلكتروني", NOTE: "ملاحظة" };
const STATUS_LABEL: Record<FollowUpStatus, string> = { pending: "معلق", completed: "مكتمل", cancelled: "ملغي" };
const STATUS_TONE: Record<FollowUpStatus, PillTone> = { pending: "warning", completed: "success", cancelled: "neutral" };

export function InstallmentFollowUpsScreen() {
  const storeRef = useRef(createReturnsLandedInstallmentsStore({ accounts: demoAccounts, period: demoOpenPeriod }));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const followUps = useMemo(() => storeRef.current.snapshot().followUps, [version]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | FollowUpStatus>("all");
  const [customerId, setCustomerId] = useState(demoCustomers[0]?.id ?? "");
  const [type, setType] = useState<FollowUpType>("CALL");
  const [followUpDate, setFollowUpDate] = useState("2026-08-21");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");

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
  const selected = typeof panel === "object" ? followUps.find((f) => f.id === panel.id) ?? null : null;

  function customerName(id: string): string {
    return demoCustomers.find((c) => c.id === id)?.nameAr ?? id;
  }

  async function submit() {
    const f = createFollowUp({
      id: crypto.randomUUID(),
      customerId,
      type,
      followUpDate,
      notes: notes.trim() || null,
      createdAt: new Date().toISOString(),
    });
    await storeRef.current.followUps.save(f);
    bump();
    setPanel("none");
    setNotes("");
  }

  async function complete(f: CollectionFollowUp) {
    await storeRef.current.followUps.update(completeFollowUp(f, outcome.trim() || "تمت المتابعة"));
    bump();
    setPanel("none");
    setOutcome("");
  }

  async function cancel(f: CollectionFollowUp) {
    await storeRef.current.followUps.update(cancelFollowUp(f));
    bump();
    setPanel("none");
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "pending", label: "معلق", count: counts.pending },
    { key: "completed", label: "مكتمل", count: counts.completed },
    { key: "cancelled", label: "ملغي", count: counts.cancelled },
  ];

  const columns: DocumentListColumn<CollectionFollowUp>[] = [
    { key: "customer", header: "العميل", render: (f) => customerName(f.customerId) },
    { key: "type", header: "نوع المتابعة", render: (f) => TYPE_LABEL[f.type] },
    { key: "date", header: "تاريخ المتابعة", render: (f) => <span className="mz-num">{f.followUpDate}</span> },
    { key: "owner", header: "مسؤول المتابعة", render: (f) => f.assignedTo ?? "أنا" },
    { key: "outcome", header: "النتيجة", render: (f) => f.outcome ?? "—" },
    { key: "status", header: "الحالة", render: (f) => <StatusPill label={STATUS_LABEL[f.status]} tone={STATUS_TONE[f.status]} /> },
  ];

  return (
    <div className="w-full">
      <DocumentList<CollectionFollowUp>
        eyebrow="Installments · Collection Follow-ups"
        title="متابعة التحصيل"
        description="سجل نقاط تواصل التحصيل مع عملاء عليهم أقساط متأخرة."
        actions={
          <Button variant="primary" onClick={() => setPanel("create")}>
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
        onStatusChange={(k) => setStatusFilter(k as "all" | FollowUpStatus)}
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
          <SelectField label="العميل *" value={customerId} onChange={setCustomerId} options={demoCustomers.map((c) => ({ value: c.id, label: c.nameAr }))} />
          <SelectField label="نوع المتابعة *" value={type} onChange={(v) => setType(v as FollowUpType)} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
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
          <Button variant="primary" onClick={submit}>
            إضافة
          </Button>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected ? customerName(selected.customerId) : "متابعة"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <div className="text-[12.5px] text-ink-muted">{TYPE_LABEL[selected.type]} — {selected.followUpDate}</div>
            {selected.notes ? <div className="text-[13px] text-ink">{selected.notes}</div> : null}
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
