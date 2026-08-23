import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, Money as MoneyDisplay, StatusPill, Card, Button, SidePanel, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { CreateWritedownRunDTO, WritedownRunDTO, WritedownRunStatusDTO } from "@mezan/contracts";
import { ApiError, useWarehouses, useCreateWritedownRun, useWritedownRuns, usePostWritedownRun } from "../data/hooks";
import { NumberField, SelectField } from "../settings/form-controls";

/**
 * هبوط قيمة المخزون (Inventory Aging Write-down Runs) — docs/tasks.md Phase 4
 * "Aging-based inventory write-down batch". Monthly, manually-triggered,
 * per-period-idempotent batch that provisions Dr 5060 (write-down expense) /
 * Cr 1190 (contra-asset provision) against slow-moving stock — never touches
 * the item's recorded WAC/cost layers.
 */

const STATUS_LABEL: Record<WritedownRunStatusDTO, string> = { draft: "مسودة", posted: "مرحل", cancelled: "ملغي" };
const STATUS_TONE: Record<WritedownRunStatusDTO, PillTone> = { draft: "neutral", posted: "success", cancelled: "danger" };

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

interface RunDraft {
  year: number;
  month: number;
  warehouseId: string;
}

function blankDraft(): RunDraft {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, warehouseId: "" };
}

function formatPeriod(draft: RunDraft): string {
  return `${draft.year}-${String(draft.month).padStart(2, "0")}`;
}

function validateDraft(draft: RunDraft): string | null {
  if (!Number.isInteger(draft.year) || draft.year < 2000 || draft.year > 2100) return "السنة غير صحيحة.";
  if (!Number.isInteger(draft.month) || draft.month < 1 || draft.month > 12) return "الشهر يجب أن يكون بين 1 و12.";
  return null;
}

export function WritedownRunsScreen() {
  const query = useWritedownRuns();
  const warehousesQuery = useWarehouses();
  const createRun = useCreateWritedownRun();
  const postRun = usePostWritedownRun();

  const runs = query.data ?? [];
  const warehouses = warehousesQuery.data ?? [];

  const [statusFilter, setStatusFilter] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<RunDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [postingId, setPostingId] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function warehouseName(warehouseId: string | null): string {
    if (warehouseId === null) return "كل المستودعات";
    return warehouses.find((w) => w.id === warehouseId)?.name ?? warehouseId;
  }

  const filtered = useMemo(() => {
    if (statusFilter === "all") return runs;
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);

  const totalCount = runs.length;
  const draftCount = runs.filter((r) => r.status === "draft").length;
  const postedCount = runs.filter((r) => r.status === "posted").length;

  const selected = selectedId ? runs.find((r) => r.id === selectedId) ?? null : null;

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
    const body: CreateWritedownRunDTO = {
      period: formatPeriod(draft),
      warehouseId: draft.warehouseId.trim() === "" ? null : draft.warehouseId.trim(),
    };
    try {
      await createRun.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر إنشاء عملية هبوط قيمة المخزون.");
    }
  }

  async function handlePost(run: WritedownRunDTO) {
    if (postingId !== null) return;
    setPostingId(run.id);
    setPostError(null);
    try {
      await postRun.mutateAsync(run.id);
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : "تعذّر ترحيل عملية هبوط قيمة المخزون.");
    } finally {
      setPostingId(null);
    }
  }

  const columns: DocumentListColumn<WritedownRunDTO>[] = [
    { key: "period", header: "الفترة", render: (r) => <span className="mz-num font-semibold text-ink">{r.period}</span> },
    { key: "warehouse", header: "المستودع", render: (r) => warehouseName(r.warehouseId) },
    { key: "lines", header: "عدد البنود", align: "end", render: (r) => <span className="mz-num">{r.lines.length}</span> },
    { key: "total", header: "قيمة المخصص", align: "end", render: (r) => <MoneyDisplay value={toMajor(r.totalAmount)} /> },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        r.status === "draft" ? (
          <Button
            size="sm"
            variant="primary"
            disabled={postingId === r.id}
            onClick={(event) => {
              event.stopPropagation();
              void handlePost(r);
            }}
          >
            {postingId === r.id ? "جارٍ الترحيل..." : "ترحيل"}
          </Button>
        ) : r.journalEntryId ? (
          <span className="mz-num text-[11px] text-ink-faint">{r.journalEntryId}</span>
        ) : null,
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: totalCount },
    { key: "draft", label: "مسودة", count: draftCount },
    { key: "posted", label: "مرحل", count: postedCount },
    { key: "cancelled", label: "ملغي", count: runs.filter((r) => r.status === "cancelled").length },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل عمليات هبوط قيمة المخزون.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {postError ? (
        <Card className="mb-[18px] p-[14px_18px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {postError}
          </p>
        </Card>
      ) : null}
      <DocumentList<WritedownRunDTO>
        eyebrow="Inventory · Aging Write-down"
        title="هبوط قيمة المخزون"
        description="عملية شهرية اختيارية تُحسب حسب تقادم المخزون وتُنشئ مخصصاً محاسبياً (مدين مصروف / دائن مخصص هبوط) للأصناف بطيئة الحركة — دون المساس بتكلفة المخزون المسجلة"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            تشغيل عملية جديدة
          </Button>
        }
        stats={[
          { label: "إجمالي العمليات", value: <span className="mz-num">{totalCount}</span> },
          { label: "مسودة", value: <span className="mz-num">{draftCount}</span> },
          { label: "مرحل", value: <span className="mz-num">{postedCount}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={setStatusFilter}
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{totalCount}</span> عملية
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد عمليات هبوط قيمة — لم يتم تشغيل أي عملية بعد</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? `عملية هبوط قيمة — ${selected.period}` : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الفترة</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.period}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">المستودع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{warehouseName(selected.warehouseId)}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ الإنشاء</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.createdAt}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ الترحيل</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.postedAt ?? "—"}</div>
              </div>
            </Card>
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">قيمة المخصص الإجمالية</div>
              <MoneyDisplay value={toMajor(selected.totalAmount)} className="mt-[6px] text-[18px] font-bold" />
              {selected.journalEntryId ? (
                <div className="mz-num mt-[8px] text-[11.5px] text-ink-faint">قيد اليومية: {selected.journalEntryId}</div>
              ) : null}
            </Card>
            <div>
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">تفاصيل البنود</h3>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-surface-2 text-ink-faint">
                    <tr>
                      <th className="p-[9px_12px] text-start font-semibold">الصنف</th>
                      <th className="p-[9px_12px] text-end font-semibold">أيام التقادم</th>
                      <th className="p-[9px_12px] text-end font-semibold">نسبة المخصص</th>
                      <th className="p-[9px_12px] text-end font-semibold">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line, i) => (
                      <tr key={`${line.itemId}-${line.warehouseId}-${i}`} className="border-t border-border">
                        <td className="mz-num p-[9px_12px] text-ink">{line.itemId}</td>
                        <td className="mz-num p-[9px_12px] text-end">{line.agingDays}</td>
                        <td className="mz-num p-[9px_12px] text-end">{(line.writedownRateBps / 100).toFixed(1)}%</td>
                        <td className="p-[9px_12px] text-end">
                          <MoneyDisplay value={toMajor(line.amount)} />
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

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="تشغيل عملية هبوط قيمة جديدة" description="بيانات الفترة والمستودع">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <NumberField label="السنة *" value={draft.year} onChange={(v) => setDraft((d) => ({ ...d, year: v }))} min={2000} max={2100} step={1} />
          <NumberField label="الشهر *" value={draft.month} onChange={(v) => setDraft((d) => ({ ...d, month: v }))} min={1} max={12} step={1} />
          <SelectField
            label="المستودع"
            value={draft.warehouseId}
            onChange={(v) => setDraft((d) => ({ ...d, warehouseId: v }))}
            options={[{ value: "", label: "كل المستودعات" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
          />

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
