import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, Money as MoneyDisplay, StatusPill, Card, Button, SidePanel, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { CreateAccrualBatchDTO, LeaveAccrualBatchDTO, LeaveAccrualBatchStatusDTO, LeaveAccrualRunTypeDTO } from "@mezan/contracts";
import { ApiError, useLeaveAccrualBatches, useRunLeaveAccrualNow } from "../data/hooks";
import { Field } from "../settings/form-controls";

/** استحقاقات الإجازات — Leave Accrual Batches (docs/catalog/06-crm-hr.md §"استحقاقات الإجازات"). List + "تشغيل استحقاق الآن". */

const STATUS_LABEL: Record<LeaveAccrualBatchStatusDTO, string> = { draft: "مسودة", posted: "مرحّل", cancelled: "ملغي" };
const STATUS_TONE: Record<LeaveAccrualBatchStatusDTO, PillTone> = { draft: "neutral", posted: "success", cancelled: "danger" };
const RUN_TYPE_LABEL: Record<LeaveAccrualRunTypeDTO, string> = { MANUAL: "يدوي", SCHEDULED: "مجدول" };

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LeaveAccrualBatchesScreen() {
  const query = useLeaveAccrualBatches();
  const runNow = useRunLeaveAccrualNow();

  const batches = query.data ?? [];

  const [typeFilter, setTypeFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [runDate, setRunDate] = useState(today());
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return batches;
    return batches.filter((b) => b.runType === typeFilter);
  }, [batches, typeFilter]);

  const selected = selectedId ? batches.find((b) => b.id === selectedId) ?? null : null;

  function openRunForm() {
    setRunDate(today());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!runDate) {
      setFormError("حدد تاريخ التشغيل.");
      return;
    }
    setFormError(null);
    const body: CreateAccrualBatchDTO = { runDate, runType: "MANUAL" };
    try {
      await runNow.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر تشغيل دورة الاستحقاق.");
    }
  }

  const columns: DocumentListColumn<LeaveAccrualBatchDTO>[] = [
    { key: "runDate", header: "تاريخ التشغيل", render: (b) => <span className="mz-num font-semibold text-ink">{b.runDate}</span> },
    { key: "runType", header: "نوع التشغيل", render: (b) => RUN_TYPE_LABEL[b.runType] },
    { key: "employees", header: "عدد الموظفين", align: "end", render: (b) => <span className="mz-num">{new Set(b.lines.map((l) => l.employeeId)).size}</span> },
    { key: "days", header: "إجمالي الأيام", align: "end", render: (b) => <span className="mz-num">{b.totalDays}</span> },
    { key: "value", header: "القيمة الإجمالية", align: "end", render: (b) => <MoneyDisplay value={toMajor(b.totalValue)} /> },
    { key: "executedBy", header: "المنفذ", render: (b) => b.executedBy ?? "—" },
    { key: "status", header: "الحالة", render: (b) => <StatusPill label={STATUS_LABEL[b.status]} tone={STATUS_TONE[b.status]} /> },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: batches.length },
    { key: "MANUAL", label: "يدوي", count: batches.filter((b) => b.runType === "MANUAL").length },
    { key: "SCHEDULED", label: "مجدول", count: batches.filter((b) => b.runType === "SCHEDULED").length },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل دورات استحقاق الإجازات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<LeaveAccrualBatchDTO>
        eyebrow="HR · Leave"
        title="استحقاقات الإجازات"
        description="دورات استحقاق الإجازات المجدولة واليدوية — كل دورة تحرر قيداً محاسبياً وتحدّث الأرصدة فوراً"
        actions={
          <Button variant="primary" onClick={openRunForm}>
            تشغيل استحقاق الآن
          </Button>
        }
        stats={[
          { label: "إجمالي الدورات", value: <span className="mz-num">{batches.length}</span> },
          { label: "مرحّل", value: <span className="mz-num">{batches.filter((b) => b.status === "posted").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={typeFilter}
        onStatusChange={setTypeFilter}
        columns={columns}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={(b) => setSelectedId(b.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{batches.length}</span> دورة
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            لا توجد دورات استحقاق بعد — ستظهر هنا كل دورات الاستحقاق المجدولة واليدوية
          </div>
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? `دورة استحقاق — ${selected.runDate}` : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">القيمة الإجمالية</div>
              <MoneyDisplay value={toMajor(selected.totalValue)} className="mt-[6px] text-[18px] font-bold" />
              {selected.journalEntryId ? (
                <div className="mz-num mt-[8px] text-[11.5px] text-ink-faint">قيد اليومية: {selected.journalEntryId}</div>
              ) : null}
            </Card>
            <div>
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">تفاصيل الاستحقاق</h3>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-surface-2 text-ink-faint">
                    <tr>
                      <th className="p-[9px_12px] text-start font-semibold">الموظف</th>
                      <th className="p-[9px_12px] text-start font-semibold">نوع الإجازة</th>
                      <th className="p-[9px_12px] text-end font-semibold">الأيام</th>
                      <th className="p-[9px_12px] text-end font-semibold">القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line, i) => (
                      <tr key={`${line.employeeId}-${line.leaveTypeCode}-${i}`} className="border-t border-border">
                        <td className="mz-num p-[9px_12px] text-ink">{line.employeeId}</td>
                        <td className="p-[9px_12px] text-ink">{line.leaveTypeCode}</td>
                        <td className="mz-num p-[9px_12px] text-end">{line.creditedDays}</td>
                        <td className="p-[9px_12px] text-end">
                          <MoneyDisplay value={toMajor(line.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="تشغيل استحقاق الآن" description="تشغيل دورة استحقاق الإجازات يدوياً لكل الموظفين المؤهلين. يحرر قيد محاسبي وتحدث الأرصدة فوراً">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <Field label="تاريخ التشغيل *">
            <input
              type="date"
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
              className="mz-num w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
            />
          </Field>
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
