import { useMemo, useState } from "react";
import { DocumentList, DocumentDetail, StatusPill, Card, Button, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { PhysicalCountDTO, PhysicalCountStatusDTO } from "@mezan/contracts";
import {
  useCompletePhysicalCount,
  useGenerateAdjustmentFromCount,
  useItems,
  usePhysicalCounts,
  useRecordPhysicalCountEntries,
  useStartPhysicalCount,
  useStockBalance,
  useWarehouses,
} from "../data/hooks";
import { TextField, SelectField } from "../settings/form-controls";

/**
 * الجرد الفعلي (Physical Counts) — docs/catalog/03: start → record counts →
 * complete → generate the reconciling stock adjustment, on the real
 * `/inventory/physical-counts` API (packages/api/src/stock-documents-routes.ts).
 */

const STATUS_LABEL: Record<PhysicalCountStatusDTO, string> = {
  IN_PROGRESS: "قيد التنفيذ",
  COMPLETED: "مكتمل",
  ADJUSTMENT_GENERATED: "تم إنشاء التسوية",
  CANCELLED: "ملغي",
};
const STATUS_TONE: Record<PhysicalCountStatusDTO, PillTone> = {
  IN_PROGRESS: "warning",
  COMPLETED: "info",
  ADJUSTMENT_GENERATED: "success",
  CANCELLED: "neutral",
};

/**
 * Signed variance for one line: counted − system, formatted to the SAME 6dp
 * exact-decimal-string convention every Qty crosses the wire as (display
 * only — the real variance the generated adjustment posts is computed
 * server-side, from the domain's own `Qty` subtraction).
 */
function varianceOf(l: { systemQty: string; countedQty: string | null }): string | null {
  if (l.countedQty === null) return null;
  const diff = Number(l.countedQty) - Number(l.systemQty);
  return diff.toFixed(6);
}

export function PhysicalCountsScreen() {
  const query = usePhysicalCounts();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const counts = query.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  function warehouseLabel(id: string): string {
    return warehouses.find((w) => w.id === id)?.name ?? id;
  }
  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }

  const [mode, setMode] = useState<"list" | "new" | "count" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | PhysicalCountStatusDTO>("all");
  const [search, setSearch] = useState("");

  const stats = useMemo(() => {
    const c = { all: counts.length, IN_PROGRESS: 0, COMPLETED: 0, ADJUSTMENT_GENERATED: 0, CANCELLED: 0 };
    for (const item of counts) c[item.status] += 1;
    return c;
  }, [counts]);

  const filtered = useMemo(() => {
    let rows = counts;
    if (statusFilter !== "all") rows = rows.filter((c) => c.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => (c.countNo ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [counts, statusFilter, search]);

  const selected = selectedId ? counts.find((c) => c.id === selectedId) ?? null : null;
  const active = activeCountId ? counts.find((c) => c.id === activeCountId) ?? null : null;

  const columns: DocumentListColumn<PhysicalCountDTO>[] = [
    { key: "countNo", header: "الجرد", sortable: true, render: (c) => <span className="mz-num font-semibold text-ink">{c.countNo ?? "—"}</span> },
    { key: "warehouse", header: "المستودع", render: (c) => <span className="text-ink">{warehouseLabel(c.warehouseId)}</span> },
    { key: "date", header: "التاريخ", render: (c) => <span className="mz-num text-ink-muted">{c.date}</span> },
    { key: "lines", header: "عدد الأصناف", align: "end", render: (c) => <span className="mz-num">{c.lines.length}</span> },
    { key: "status", header: "الحالة", render: (c) => <StatusPill label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} /> },
  ];

  function openDetail(id: string) {
    setSelectedId(id);
    setMode("detail");
  }

  if (mode === "new") {
    return (
      <NewCountView
        warehouses={warehouses}
        warehouseLabel={warehouseLabel}
        onStarted={(id) => {
          setActiveCountId(id);
          setMode("count");
        }}
        onCancel={() => setMode("list")}
      />
    );
  }

  if (mode === "count" && active) {
    return (
      <CountEntryView
        count={active}
        itemLabel={itemLabel}
        warehouseLabel={warehouseLabel}
        onDone={() => {
          setActiveCountId(null);
          setMode("list");
        }}
      />
    );
  }

  if (mode === "detail" && selected) {
    return (
      <CountDetailView
        count={selected}
        itemLabel={itemLabel}
        warehouseLabel={warehouseLabel}
        onBack={() => setMode("list")}
        onResume={() => {
          setActiveCountId(selected.id);
          setMode("count");
        }}
      />
    );
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل قوائم الجرد.</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
      <DocumentList<PhysicalCountDTO>
        eyebrow="Inventory · Physical Counts"
        title="الجرد الفعلي"
        description="قيد التنفيذ ← مكتمل ← تم إنشاء التسوية — جلسة جرد تُطابق المخزون الفعلي مع النظام"
        actions={
          <Button variant="primary" onClick={() => setMode("new")}>
            جرد جديد
          </Button>
        }
        stats={[
          { label: "إجمالي عمليات الجرد", value: <span className="mz-num">{stats.all}</span> },
          { label: "قيد التنفيذ", value: <span className="mz-num">{stats.IN_PROGRESS}</span> },
          { label: "مكتمل", value: <span className="mz-num">{stats.COMPLETED}</span> },
          { label: "تم إنشاء التسوية", value: <span className="mz-num">{stats.ADJUSTMENT_GENERATED}</span> },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: stats.all },
          { key: "IN_PROGRESS", label: "قيد التنفيذ", count: stats.IN_PROGRESS },
          { key: "COMPLETED", label: "مكتمل", count: stats.COMPLETED },
          { key: "ADJUSTMENT_GENERATED", label: "تم إنشاء التسوية", count: stats.ADJUSTMENT_GENERATED },
          { key: "CANCELLED", label: "ملغي", count: stats.CANCELLED },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | PhysicalCountStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم الجرد..."
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        onRowClick={(c) => openDetail(c.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{stats.all}</span> جرد
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام</div>}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* New count dialog                                                     */
/* -------------------------------------------------------------------- */

function NewCountView({
  warehouses,
  warehouseLabel,
  onStarted,
  onCancel,
}: {
  warehouses: ReturnType<typeof useWarehouses>["data"];
  warehouseLabel: (id: string) => string;
  onStarted: (id: string) => void;
  onCancel: () => void;
}) {
  const startCount = useStartPhysicalCount();
  const warehouseList = warehouses ?? [];
  const [warehouseId, setWarehouseId] = useState(warehouseList[0]?.id ?? "");
  const [date, setDate] = useState("2026-08-22");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const balanceQuery = useStockBalance({ warehouseId: warehouseId || undefined });
  const balance = balanceQuery.data ?? [];

  const warehouseOptions = useMemo(() => warehouseList.map((w) => ({ value: w.id, label: w.name })), [warehouseList]);
  const itemIds = useMemo(() => balance.filter((r) => Number(r.onHand) !== 0).map((r) => r.itemId), [balance]);

  async function handleStart() {
    if (warehouseId === "" || itemIds.length === 0) return;
    setError(null);
    try {
      const count = await startCount.mutateAsync({ id: crypto.randomUUID(), warehouseId, date, memo: memo.trim() || undefined, itemIds });
      onStarted(count.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر بدء الجرد.");
    }
  }

  return (
    <div className="w-full max-w-[560px]">
      <div className="mb-[18px]">
        <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Inventory · New Physical Count</div>
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">جرد جديد</h1>
      </div>
      <Card className="flex flex-col gap-[14px] p-[18px]">
        <SelectField label="المستودع *" value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} />
        <TextField label="التاريخ *" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label="ملاحظات" value={memo} onChange={setMemo} placeholder="ملاحظات الجرد..." />
        <p className="text-[11.5px] text-ink-faint">سيتم تحميل جميع الأصناف المتوفرة في المستودع المحدد مع أرصدتها الحالية ({itemIds.length} صنف) — {warehouseLabel(warehouseId)}.</p>
        {error ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-[9px]">
          <Button onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" disabled={startCount.isPending || itemIds.length === 0} onClick={handleStart}>
            إضافة
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Count entry grid                                                     */
/* -------------------------------------------------------------------- */

function CountEntryView({
  count,
  itemLabel,
  warehouseLabel,
  onDone,
}: {
  count: PhysicalCountDTO;
  itemLabel: (id: string) => string;
  warehouseLabel: (id: string) => string;
  onDone: () => void;
}) {
  const recordEntries = useRecordPhysicalCountEntries();
  const completeCount = useCompletePhysicalCount();
  const [counted, setCounted] = useState<Record<string, number>>(() =>
    Object.fromEntries(count.lines.map((l) => [l.itemId, l.countedQty !== null ? Number(l.countedQty) : Number(l.systemQty)])),
  );
  const [error, setError] = useState<string | null>(null);

  const allCounted = count.lines.every((l) => counted[l.itemId] !== undefined && counted[l.itemId] !== null);
  const isInProgress = count.status === "IN_PROGRESS";
  const busy = recordEntries.isPending || completeCount.isPending;

  async function handleComplete() {
    setError(null);
    try {
      await recordEntries.mutateAsync({
        id: count.id,
        body: { entries: count.lines.map((l) => ({ itemId: l.itemId, countedQty: String(counted[l.itemId] ?? Number(l.systemQty)) })) },
      });
      await completeCount.mutateAsync(count.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ الكميات المعدودة.");
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Inventory · Physical Count</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{count.countNo} — {warehouseLabel(count.warehouseId)}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>حفظ ومتابعة لاحقاً</Button>
          {isInProgress ? (
            <Button variant="primary" disabled={busy || !allCounted} onClick={handleComplete}>
              إنهاء الجرد
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">النظام</th>
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">المعدود</th>
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الفرق</th>
              </tr>
            </thead>
            <tbody>
              {count.lines.map((l) => {
                const value = counted[l.itemId] ?? Number(l.systemQty);
                const diff = value - Number(l.systemQty);
                return (
                  <tr key={l.itemId} className="border-b border-border last:border-b-0">
                    <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                    <td className="px-[15px] py-[11px] text-end mz-num text-ink-muted">{l.systemQty}</td>
                    <td className="px-[15px] py-[8px] text-end">
                      <input
                        type="number"
                        aria-label={`الكمية المعدودة لصنف ${itemLabel(l.itemId)}`}
                        value={value}
                        min={0}
                        disabled={!isInProgress}
                        onChange={(e) => setCounted((prev) => ({ ...prev, [l.itemId]: e.target.valueAsNumber || 0 }))}
                        className="mz-num w-[110px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-end text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-surface-3"
                      />
                    </td>
                    <td className={`px-[15px] py-[11px] text-end mz-num font-semibold ${diff === 0 ? "text-ink-muted" : diff > 0 ? "text-success-ink" : "text-danger-ink"}`}>
                      {diff > 0 ? `+${diff}` : diff}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Detail view (completed / adjustment-generated)                       */
/* -------------------------------------------------------------------- */

function CountDetailView({
  count,
  itemLabel,
  warehouseLabel,
  onBack,
  onResume,
}: {
  count: PhysicalCountDTO;
  itemLabel: (id: string) => string;
  warehouseLabel: (id: string) => string;
  onBack: () => void;
  onResume: () => void;
}) {
  const generateAdjustment = useGenerateAdjustmentFromCount();
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    try {
      await generateAdjustment.mutateAsync({ id: count.id, body: { adjustmentId: crypto.randomUUID() } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر توليد التسوية.");
    }
  }

  return (
    <div className="w-full">
      <DocumentDetail
        title={count.countNo ?? "جرد فعلي"}
        statusLabel={STATUS_LABEL[count.status]}
        statusTone={STATUS_TONE[count.status]}
        actions={
          <>
            <Button onClick={onBack}>رجوع</Button>
            {count.status === "IN_PROGRESS" ? <Button variant="primary" onClick={onResume}>متابعة الجرد</Button> : null}
            {count.status === "COMPLETED" ? (
              <Button variant="primary" disabled={generateAdjustment.isPending} onClick={handleGenerate}>
                توليد تسوية
              </Button>
            ) : null}
          </>
        }
        summary={[
          { label: "المستودع", value: warehouseLabel(count.warehouseId) },
          { label: "التاريخ", value: <span className="mz-num">{count.date}</span> },
          { label: "عدد الأصناف", value: <span className="mz-num">{count.lines.length}</span> },
          { label: "التسوية الناتجة", value: count.generatedAdjustmentId ? "تم إنشاؤها" : "—" },
        ]}
        tabs={[
          {
            key: "lines",
            label: "بنود الجرد",
            content: (
              <Card className="overflow-hidden">
                {error ? (
                  <div role="alert" className="border-b border-border bg-danger-soft px-[14px] py-[10px] text-[12.5px] text-danger-ink">
                    {error}
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">النظام</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">المعدود</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الفرق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {count.lines.map((l) => {
                        const variance = varianceOf(l);
                        return (
                          <tr key={l.itemId} className="border-b border-border last:border-b-0">
                            <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                            <td className="px-[15px] py-[11px] text-end mz-num text-ink-muted">{l.systemQty}</td>
                            <td className="px-[15px] py-[11px] text-end mz-num">{l.countedQty ?? "—"}</td>
                            <td className="px-[15px] py-[11px] text-end mz-num font-semibold">
                              {variance !== null ? (Number(variance) < 0 ? variance : `+${variance}`) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
