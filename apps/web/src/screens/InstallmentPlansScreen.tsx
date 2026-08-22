import { useMemo, useRef, useState } from "react";
import {
  Button,
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import {
  Money,
  generateInstallmentSchedule,
  processOverdueInstallments,
  type DocumentStatus,
  type FrameworkDocument,
  type InstallmentFrequency,
  type InstallmentLine,
  type InstallmentPlanDocument,
} from "@mezan/domain";
import { SelectField, NumberField } from "../settings/form-controls";
import { demoInvoices } from "../sample-data";
import { createReturnsLandedInstallmentsStore } from "../store/returns-landed-installments-store";
import { demoAccounts, demoOpenPeriod } from "../store/document-demo-shared";

/** خطط الأقساط (Installment Plans) — docs/catalog/05. Splits an invoice's balance into a scheduled series of payments; posts no GL, moves no stock. */

type Doc = FrameworkDocument<InstallmentLine>;

const FREQUENCY_LABEL: Record<InstallmentFrequency, string> = {
  WEEKLY: "أسبوعي",
  BIWEEKLY: "كل أسبوعين",
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
};

const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  confirmed: "نشط",
  posted: "نشط",
  cancelled: "ملغي",
  reversed: "معكوس",
};
const STATUS_TONE: Record<DocumentStatus, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  posted: "success",
  cancelled: "neutral",
  reversed: "danger",
};

const TODAY = "2026-08-21";

export function InstallmentPlansScreen() {
  const storeRef = useRef(createReturnsLandedInstallmentsStore({ accounts: demoAccounts, period: demoOpenPeriod }));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const documents = useMemo(() => storeRef.current.snapshot().installments, [version]);

  const [panel, setPanel] = useState<"none" | "create" | "overdue" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatus>("all");
  const [invoiceId, setInvoiceId] = useState(demoInvoices[0]?.id ?? "");
  const [installmentCount, setInstallmentCount] = useState(6);
  const [frequency, setFrequency] = useState<InstallmentFrequency>("MONTHLY");
  const [startDate, setStartDate] = useState(TODAY);
  const [downPayment, setDownPayment] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [overdueResult, setOverdueResult] = useState<{ newlyOverdueCount: number; totalLateFeesApplied: string } | null>(null);

  const selectedInvoice = demoInvoices.find((i) => i.id === invoiceId);
  const preview = useMemo(() => {
    if (!selectedInvoice) return null;
    try {
      return generateInstallmentSchedule({
        invoiceTotal: Money.fromMajor(String(selectedInvoice.remaining)),
        downPayment: Money.fromMajor(String(downPayment)),
        installmentCount,
        frequency,
        startDate,
      });
    } catch {
      return null;
    }
  }, [selectedInvoice, downPayment, installmentCount, frequency, startDate]);

  const counts = useMemo(() => {
    const c = { all: documents.length, active: 0, overdue: 0 };
    for (const d of documents) {
      if (d.status === "confirmed") {
        c.active += 1;
        if (d.lines.some((l) => l.status === "overdue")) c.overdue += 1;
      }
    }
    return c;
  }, [documents]);

  const filtered = statusFilter === "all" ? documents : documents.filter((d) => d.status === statusFilter);
  const selected = typeof panel === "object" ? documents.find((d) => d.id === panel.id) ?? null : null;

  async function submit() {
    setError(null);
    if (!preview || !selectedInvoice) return;
    const id = crypto.randomUUID();
    const lines: InstallmentLine[] = preview.installments.map((i) => ({
      no: i.no,
      customerId: selectedInvoice.customer,
      sourceInvoiceId: selectedInvoice.id,
      sourceInvoiceNumber: selectedInvoice.number,
      frequency,
      downPayment: preview.downPayment,
      dueDate: i.dueDate,
      amount: i.amount,
      paidAmount: Money.zero(),
      status: "pending",
      lateFeeAmount: Money.zero(),
    }));
    try {
      await storeRef.current.installments.createDraft({ id, date: startDate, memo: "", lines });
      await storeRef.current.installments.confirm(id, { actor: "demo", actorRoles: ["*"] });
      bump();
      setPanel("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runOverdueBatch() {
    const confirmedPlans = documents.filter((d) => d.status === "confirmed") as InstallmentPlanDocument[];
    const result = processOverdueInstallments(confirmedPlans, TODAY);
    for (let i = 0; i < confirmedPlans.length; i++) {
      if (result.updatedPlans[i] !== confirmedPlans[i]) {
        await storeRef.current.installmentsRepo.update(result.updatedPlans[i] as InstallmentPlanDocument);
      }
    }
    setOverdueResult({ newlyOverdueCount: result.newlyOverdueCount, totalLateFeesApplied: result.totalLateFeesApplied.toString() });
    bump();
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "confirmed", label: "نشط", count: counts.active },
  ];

  const columns: DocumentListColumn<Doc>[] = [
    { key: "docNo", header: "رقم الخطة", render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? "مسودة"}</span> },
    { key: "customer", header: "العميل", render: (d) => d.lines[0]?.customerId ?? "—" },
    { key: "invoice", header: "الفاتورة", render: (d) => d.lines[0]?.sourceInvoiceNumber ?? "—" },
    { key: "frequency", header: "التكرار", render: (d) => FREQUENCY_LABEL[d.lines[0]?.frequency ?? "MONTHLY"] },
    {
      key: "remaining",
      header: "المتبقي",
      align: "end",
      render: (d) => <MoneyDisplay value={Number(Money.sum(d.lines.filter((l) => l.status !== "paid").map((l) => l.amount)).toString())} />,
    },
    {
      key: "status",
      header: "الحالة",
      render: (d) => (
        <div className="flex items-center gap-1.5">
          <StatusPill label={STATUS_LABEL[d.status]} tone={STATUS_TONE[d.status]} />
          {d.lines.some((l) => l.status === "overdue") ? <StatusPill label="متأخر" tone="danger" /> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<Doc>
        eyebrow="Installments · Plans"
        title="خطط الأقساط"
        description="تقسيم مبلغ فاتورة مبيعات على دفعات دورية — لا يسجل تحصيلاً تلقائياً."
        actions={
          <div className="flex gap-2">
            <Button
              variant="default"
              onClick={() => {
                setOverdueResult(null);
                setPanel("overdue");
              }}
            >
              معالجة المتأخرات
            </Button>
            <Button variant="primary" onClick={() => setPanel("create")}>
              خطة جديدة
            </Button>
          </div>
        }
        stats={[
          { label: "إجمالي الخطط", value: <span className="mz-num">{counts.all}</span> },
          { label: "خطط نشطة", value: <span className="mz-num">{counts.active}</span> },
          { label: "متأخرة", value: <span className="mz-num">{counts.overdue}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatus)}
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => setPanel({ id: d.id })}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> خطة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">أنشئ خطة أقساط لتقسيم مبلغ الفاتورة على دفعات</div>}
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title="خطة أقساط جديدة">
        <div className="flex flex-col gap-4 p-5">
          <SelectField
            label="الفاتورة *"
            value={invoiceId}
            onChange={setInvoiceId}
            options={demoInvoices.filter((i) => i.remaining > 0).map((i) => ({ value: i.id, label: `${i.number} — ${i.customer} / ${i.remaining.toFixed(2)}` }))}
          />
          <NumberField label="عدد الأقساط *" value={installmentCount} onChange={setInstallmentCount} min={1} />
          <SelectField
            label="التكرار *"
            value={frequency}
            onChange={(v) => setFrequency(v as InstallmentFrequency)}
            options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <TextFieldDate label="تاريخ البدء *" value={startDate} onChange={setStartDate} />
          <NumberField label="دفعة مقدمة" value={downPayment} onChange={setDownPayment} min={0} />

          {preview ? (
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-border p-3">
              <div className="text-[12px] font-bold text-ink-muted">معاينة الجدول</div>
              {preview.installments.map((i) => (
                <div key={i.no} className="flex items-center justify-between text-[12.5px]">
                  <span className="mz-num text-ink-muted">
                    #{i.no} — {i.dueDate}
                  </span>
                  <MoneyDisplay value={Number(i.amount.toString())} />
                </div>
              ))}
            </div>
          ) : null}

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <Button variant="primary" onClick={submit} disabled={!preview}>
            حفظ
          </Button>
        </div>
      </SidePanel>

      <SidePanel open={panel === "overdue"} onClose={() => setPanel("none")} title="معالجة المتأخرات" description="سيتم تحديث حالة الأقساط المتأخرة وتطبيق غرامات التأخير حسب إعدادات المنشأة">
        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-[10px] border border-border p-3 text-[12.5px] text-ink-muted">
            تحديث حالة الأقساط المستحقة إلى متأخر (تلقائي) — تطبيق غرامات التأخير (تلقائي؛ لا توجد إعدادات غرامة معرّفة بعد، القيمة صفر حتى تُضاف).
          </div>
          {overdueResult ? (
            <div className="rounded-[8px] bg-surface-2 px-3 py-2 text-[12.5px] text-ink">
              تم تحديث <span className="mz-num">{overdueResult.newlyOverdueCount}</span> قسط إلى متأخر — غرامات مطبّقة:{" "}
              <MoneyDisplay value={Number(overdueResult.totalLateFeesApplied)} />
            </div>
          ) : null}
          <Button variant="primary" onClick={runOverdueBatch}>
            معالجة المتأخرات
          </Button>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? "خطة أقساط"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l) => (
                <div key={l.no} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span className="mz-num text-ink-muted">
                    #{l.no} — {l.dueDate}
                  </span>
                  <MoneyDisplay value={Number(l.amount.toString())} />
                  <StatusPill
                    label={l.status === "pending" ? "مستحق" : l.status === "paid" ? "مدفوع" : l.status === "overdue" ? "متأخر" : "ملغي"}
                    tone={l.status === "paid" ? "success" : l.status === "overdue" ? "danger" : "neutral"}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

/** Minimal date input — `settings/form-controls.tsx`'s `TextField` doesn't expose `type="date"`. */
function TextFieldDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-ink-muted">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[38px] rounded-[8px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
      />
    </label>
  );
}
