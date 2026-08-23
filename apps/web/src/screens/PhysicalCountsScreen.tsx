import { useMemo, useState } from "react";
import { FulcrumRule, DocumentList, DocumentDetail, StatusPill, VarianceBeam, Card, Button, trimMoneyString, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { PhysicalCountDTO, PhysicalCountStatusDTO } from "@mezan/contracts";
import {
  useCancelPhysicalCount,
  useCompletePhysicalCount,
  useGenerateAdjustmentFromCount,
  usePhysicalCounts,
  useRecordPhysicalCounts,
  useStartPhysicalCount,
  useStockBalance,
} from "../data/inventory-ops-hooks";
import { useItems, useWarehouses, ApiError } from "../data/hooks";
import { TextField, SelectField, ToggleField } from "../settings/form-controls";

/**
 * الجرد الفعلي (Physical Counts) — docs/catalog/03: start → record counts →
 * complete → generate the reconciling stock adjustment, backed by
 * `/inventory/physical-counts`.
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
 * Variance figures are computed by the API from the snapshot the count took
 * when it opened (and withheld entirely while a blind count is open), so the
 * screen only ever formats the exact decimal strings it is handed — it never
 * recomputes counted − system itself.
 */
function signedDisplay(value: string | null, digits = 2): string {
  if (value === null) return "—";
  const trimmed = trimMoneyString(value, digits);
  return trimmed.startsWith("-") ? trimmed : `+${trimmed}`;
}

function qtyDisplay(value: string | null, digits = 2): string {
  return value === null ? "—" : trimMoneyString(value, digits);
}

const QTY_SCALE = 1_000_000n;

/** Exact decimal string → scaled bigint (1e-6), the wire scale. Null when unparseable. */
function toScaled(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const frac = ((match[3] ?? "") + "000000").slice(0, 6);
  const abs = BigInt(match[2] ?? "0") * QTY_SCALE + BigInt(frac);
  return match[1] === "-" ? -abs : abs;
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / QTY_SCALE}.${(abs % QTY_SCALE).toString().padStart(6, "0")}`;
}

export function PhysicalCountsScreen() {
  const query = usePhysicalCounts();
  const itemsQuery = useItems();
  const warehousesQuery = useWarehouses();

  const [mode, setMode] = useState<"list" | "new" | "count" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | PhysicalCountStatusDTO>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => query.data ?? [], [query.data]);
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const warehouseLabel = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.id, w.name]));
    return (id: string) => map.get(id) ?? id;
  }, [warehouses]);
  const itemLabel = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, `${i.nameAr} (${i.code})`]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

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

  const selected = selectedId ? (counts.find((c) => c.id === selectedId) ?? null) : null;
  const active = activeCountId ? (counts.find((c) => c.id === activeCountId) ?? null) : null;

  const columns: DocumentListColumn<PhysicalCountDTO>[] = [
    { key: "countNo", header: "الجرد", sortable: true, render: (c) => <span className="mz-num font-semibold text-ink">{c.countNo ?? "—"}</span> },
    { key: "warehouse", header: "المستودع", render: (c) => <span className="text-ink">{warehouseLabel(c.warehouseId)}</span> },
    { key: "date", header: "التاريخ", render: (c) => <span className="mz-num text-ink-muted">{c.date}</span> },
    { key: "lines", header: "عدد الأصناف", align: "end", render: (c) => <span className="mz-num">{c.lines.length}</span> },
    {
      key: "variance",
      header: "صافي قيمة الفرق",
      align: "end",
      render: (c) =>
        c.variance ? (
          <VarianceBeam value={Number(c.variance.netValue)} className="font-semibold">
            <span className="mz-num">{signedDisplay(c.variance.netValue)}</span>
          </VarianceBeam>
        ) : (
          <span className="text-[11.5px] text-ink-faint">{c.blind ? "جرد أعمى" : "—"}</span>
        ),
    },
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
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading
              ? "جارِ التحميل…"
              : query.isError
                ? (query.error?.message ?? "تعذّر تحميل عمليات الجرد.")
                : "لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام"}
          </div>
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* New count dialog                                                     */
/* -------------------------------------------------------------------- */

function NewCountView({
  warehouses,
  onStarted,
  onCancel,
}: {
  warehouses: { id: string; name: string }[];
  onStarted: (id: string) => void;
  onCancel: () => void;
}) {
  const start = useStartPhysicalCount();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [date, setDate] = useState("2026-08-22");
  const [memo, setMemo] = useState("");
  const [blind, setBlind] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceQuery = useStockBalance(warehouseId || undefined);
  const warehouseOptions = useMemo(() => warehouses.map((w) => ({ value: w.id, label: w.name })), [warehouses]);
  const itemIds = useMemo(
    () => (balanceQuery.data ?? []).filter((r) => Number(r.onHand) !== 0).map((r) => r.itemId),
    [balanceQuery.data],
  );

  async function handleStart() {
    if (warehouseId === "" || itemIds.length === 0) return;
    setError(null);
    try {
      const count = await start.mutateAsync({
        id: crypto.randomUUID(),
        warehouseId,
        date,
        memo: memo.trim() === "" ? undefined : memo.trim(),
        itemIds,
        blind,
      });
      onStarted(count.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر بدء الجرد.");
    }
  }

  return (
    <div className="w-full max-w-[560px]">
      <div className="mb-[16px]">
        <div className="mz-eyebrow">Inventory · New Physical Count</div>
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">جرد جديد</h1>
      </div>
      <FulcrumRule />
      <Card className="flex flex-col gap-[14px] p-[18px]">
        <SelectField label="المستودع *" value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} />
        <TextField label="التاريخ *" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label="ملاحظات" value={memo} onChange={setMemo} placeholder="ملاحظات الجرد..." />
        <ToggleField
          label="جرد أعمى"
          checked={blind}
          onChange={setBlind}
          hint="يُخفي كميات النظام عن القائم بالجرد حتى إنهاء الجلسة — الرصيد يُلتقط عند الفتح في الحالتين."
        />
        <p className="text-[11.5px] text-ink-faint">سيتم تحميل جميع الأصناف المتوفرة في المستودع المحدد مع أرصدتها الحالية ({itemIds.length} صنف).</p>
        {error ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-[9px]">
          <Button onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" disabled={start.isPending || itemIds.length === 0} onClick={handleStart}>
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
  const recordCounts = useRecordPhysicalCounts();
  const complete = useCompletePhysicalCount();
  const blindOpen = count.blind && count.status === "IN_PROGRESS";
  const [counted, setCounted] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      count.lines.map((l) => [l.itemId, l.countedQty ?? (count.blind ? "0" : (l.systemQty ?? "0"))]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const allCounted = count.lines.every((l) => toScaled(counted[l.itemId] ?? "") !== null);
  const isInProgress = count.status === "IN_PROGRESS";
  const busy = recordCounts.isPending || complete.isPending;

  async function handleComplete() {
    setError(null);
    try {
      await recordCounts.mutateAsync({
        id: count.id,
        body: {
          entries: count.lines.map((l) => ({ itemId: l.itemId, countedQty: counted[l.itemId] ?? "0" })),
        },
      });
      await complete.mutateAsync(count.id);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر حفظ الكميات المعدودة.");
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="mz-eyebrow">Inventory · Physical Count</div>
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
      <FulcrumRule />

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      {blindOpen ? (
        <div className="mb-[16px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink-muted">
          جرد أعمى — كميات النظام والفروقات مخفية حتى إنهاء الجرد.
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                {blindOpen ? null : (
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">النظام</th>
                )}
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">المعدود</th>
                {blindOpen ? null : (
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الفرق</th>
                )}
              </tr>
            </thead>
            <tbody>
              {count.lines.map((l) => {
                const value = counted[l.itemId] ?? "0";
                const systemScaled = l.systemQty === null ? null : toScaled(l.systemQty);
                const countedScaled = toScaled(value);
                const diff =
                  systemScaled !== null && countedScaled !== null ? fromScaled(countedScaled - systemScaled) : null;
                return (
                  <tr key={l.itemId} className="border-b border-border last:border-b-0">
                    <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                    {blindOpen ? null : (
                      <td className="px-[15px] py-[11px] text-end mz-num text-ink-muted">{qtyDisplay(l.systemQty)}</td>
                    )}
                    <td className="px-[15px] py-[8px] text-end">
                      <input
                        type="number"
                        aria-label={`الكمية المعدودة لصنف ${itemLabel(l.itemId)}`}
                        value={value}
                        min={0}
                        step="any"
                        disabled={!isInProgress}
                        onChange={(e) => setCounted((prev) => ({ ...prev, [l.itemId]: e.target.value }))}
                        className="mz-num w-[110px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-end text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-surface-3"
                      />
                    </td>
                    {blindOpen ? null : (
                      <td className="px-[15px] py-[11px] text-end font-semibold">
                        <VarianceBeam value={Number(diff ?? 0)}>
                          <span className="mz-num">{signedDisplay(diff)}</span>
                        </VarianceBeam>
                      </td>
                    )}
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
  const generate = useGenerateAdjustmentFromCount();
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    try {
      await generate.mutateAsync({ id: count.id, body: { adjustmentId: crypto.randomUUID() } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر توليد التسوية.");
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
              <Button variant="primary" disabled={generate.isPending} onClick={handleGenerate}>
                توليد تسوية
              </Button>
            ) : null}
          </>
        }
        summary={[
          { label: "المستودع", value: warehouseLabel(count.warehouseId) },
          { label: "التاريخ", value: <span className="mz-num">{count.date}</span> },
          { label: "عدد الأصناف", value: <span className="mz-num">{count.lines.length}</span> },
          { label: "نوع الجرد", value: count.blind ? "جرد أعمى" : "جرد ظاهر" },
          {
            label: "أصناف بها فروقات",
            value: (
              <span className="mz-num">
                {count.variance ? count.variance.overLines + count.variance.shortLines : "—"}
              </span>
            ),
          },
          {
            label: "قيمة الزيادة",
            value: <span className="mz-num text-success-ink">{count.variance ? trimMoneyString(count.variance.overValue) : "—"}</span>,
          },
          {
            label: "قيمة العجز",
            value: <span className="mz-num text-danger-ink">{count.variance ? trimMoneyString(count.variance.shortValue) : "—"}</span>,
          },
          {
            label: "صافي قيمة الفرق",
            value: (
              <VarianceBeam value={Number(count.variance?.netValue ?? 0)} className="font-semibold">
                <span className="mz-num">{signedDisplay(count.variance?.netValue ?? null)}</span>
              </VarianceBeam>
            ),
          },
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
                  <table className="w-full min-w-[760px] border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">النظام</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">المعدود</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الفرق</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">تكلفة الوحدة</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">قيمة الفرق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {count.lines.map((l) => (
                        <tr key={l.itemId} className="border-b border-border last:border-b-0">
                          <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                          <td className="px-[15px] py-[11px] text-end mz-num text-ink-muted">{qtyDisplay(l.systemQty)}</td>
                          <td className="px-[15px] py-[11px] text-end mz-num">{qtyDisplay(l.countedQty)}</td>
                          <td className="px-[15px] py-[11px] text-end font-semibold">
                            <VarianceBeam value={Number(l.varianceQty ?? 0)}>
                              <span className="mz-num">{signedDisplay(l.varianceQty)}</span>
                            </VarianceBeam>
                          </td>
                          <td className="px-[15px] py-[11px] text-end mz-num text-ink-muted">{qtyDisplay(l.unitCost)}</td>
                          <td className="px-[15px] py-[11px] text-end font-semibold">
                            <VarianceBeam value={Number(l.varianceValue ?? 0)}>
                              <span className="mz-num">{signedDisplay(l.varianceValue)}</span>
                            </VarianceBeam>
                          </td>
                        </tr>
                      ))}
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
