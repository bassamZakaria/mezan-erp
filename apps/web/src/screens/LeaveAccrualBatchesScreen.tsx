import { useState, type FormEvent } from "react";
import { Button, Card, Chip, DocumentList, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type { LeaveAccrualBatchDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { ApiError, useLeaveAccrualBatches, useRunLeaveAccrual } from "../data/hooks";
import { formatDays } from "./hr-leave-labels";

/** استحقاقات الإجازات (Leave Accrual Batches) — docs/catalog/06 §"استحقاقات الإجازات". Manual and scheduled runs that credit entitlement across every eligible employee; a period already run is never credited twice. */

const RUN_TYPE_FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "الكل" },
  { key: "scheduled", label: "مجدول" },
  { key: "manual", label: "يدوي" },
];

interface RunDraft {
  runDate: string;
  frequency: "monthly" | "annual";
  notes: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LeaveAccrualBatchesScreen() {
  const [runType, setRunType] = useState("");
  const query = useLeaveAccrualBatches(runType || null);
  const runAccrual = useRunLeaveAccrual();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<RunDraft>({ runDate: today(), frequency: "monthly", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const batches = query.data ?? [];

  function openForm() {
    setDraft({ runDate: today(), frequency: "monthly", notes: "" });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.runDate.trim() === "") {
      setFormError("تاريخ التشغيل مطلوب.");
      return;
    }
    setFormError(null);
    try {
      const result = await runAccrual.mutateAsync({
        runDate: draft.runDate.trim(),
        frequency: draft.frequency,
        runType: "manual",
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setBanner(
        result.created
          ? `تم تشغيل دورة الاستحقاق ${result.batch.number} لفترة ${result.batch.periodKey}.`
          : `فترة ${result.batch.periodKey} سبق تشغيلها في الدورة ${result.batch.number} — لم تُضف أي أيام.`,
      );
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر تشغيل دورة الاستحقاق.");
    }
  }

  const columns: DocumentListColumn<LeaveAccrualBatchDTO>[] = [
    { key: "number", header: "رقم الدورة", render: (b) => <span className="mz-num font-semibold text-ink">{b.number}</span> },
    { key: "runDate", header: "تاريخ التشغيل", render: (b) => <span className="mz-num text-ink">{b.runDate}</span> },
    { key: "period", header: "الفترة", render: (b) => <span className="mz-num text-ink">{b.periodKey}</span> },
    {
      key: "runType",
      header: "نوع التشغيل",
      render: (b) => <StatusPill label={b.runType === "manual" ? "يدوي" : "مجدول"} tone={b.runType === "manual" ? "neutral" : "info"} />,
    },
    { key: "notes", header: "ملاحظات", render: (b) => <span className="text-ink-muted">{b.notes ?? "—"}</span> },
    { key: "employees", header: "عدد الموظفين", align: "end", render: (b) => <span className="mz-num text-ink">{b.employeeCount}</span> },
    { key: "totalDays", header: "إجمالي الأيام", align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.totalDays)}</span> },
    { key: "runBy", header: "المنفذ", render: (b) => <span className="text-ink-muted">{b.runBy ?? "—"}</span> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل دورات الاستحقاق.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {banner ? (
        <div role="status" className="mb-[14px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
          {banner}
        </div>
      ) : null}

      <div className="mb-[14px] flex flex-wrap gap-[6px]" role="group" aria-label="نوع التشغيل">
        {RUN_TYPE_FILTERS.map((filter) => (
          <Chip key={filter.key} type="button" active={runType === filter.key} onClick={() => setRunType(filter.key)}>
            {filter.label}
          </Chip>
        ))}
      </div>

      <DocumentList<LeaveAccrualBatchDTO>
        eyebrow="HR · Leave Accrual"
        title="استحقاقات الإجازات"
        description="دورات استحقاق الإجازات المجدولة واليدوية التي تُضيف الأيام إلى أرصدة الموظفين"
        actions={
          <Button variant="primary" onClick={openForm}>
            تشغيل استحقاق الآن
          </Button>
        }
        stats={[
          { label: "عدد الدورات", value: <span className="mz-num">{batches.length}</span> },
          {
            label: "إجمالي الأيام",
            value: <span className="mz-num">{formatDays(String(batches.reduce((sum, b) => sum + Number(b.totalDays), 0)))}</span>,
          },
        ]}
        columns={columns}
        rows={batches}
        rowKey={(b) => b.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{batches.length}</span> دورة استحقاق
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">لا توجد دورات استحقاق بعد — ستظهر هنا كل دورات الاستحقاق المجدولة واليدوية</div>
        }
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="تشغيل استحقاق الآن">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <p className="text-[12.5px] text-ink-muted">
            تشغيل دورة استحقاق الإجازات يدوياً لكل الموظفين المؤهلين وتحديث الأرصدة فوراً. تشغيل نفس الفترة مرة أخرى لا يضيف أي أيام.
          </p>
          <TextField label="تاريخ التشغيل *" value={draft.runDate} onChange={(v) => setDraft((d) => ({ ...d, runDate: v }))} placeholder="YYYY-MM-DD" />
          <SelectField
            label="وتيرة الاستحقاق *"
            value={draft.frequency}
            onChange={(v) => setDraft((d) => ({ ...d, frequency: v as "monthly" | "annual" }))}
            options={[
              { value: "monthly", label: "شهرياً" },
              { value: "annual", label: "سنوياً" },
            ]}
            hint="تُحتسب السياسات ذات نفس الوتيرة فقط"
          />
          <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              تشغيل
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
