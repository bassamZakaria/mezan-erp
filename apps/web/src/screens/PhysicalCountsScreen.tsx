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
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * الجرد الفعلي (Physical Counts) — docs/catalog/03: start → record counts →
 * complete → generate the reconciling stock adjustment, backed by
 * `/inventory/physical-counts`.
 */

const STATUS_KEY: Record<PhysicalCountStatusDTO, AppTranslationKey> = {
  IN_PROGRESS: "counts.status.IN_PROGRESS",
  COMPLETED: "counts.status.COMPLETED",
  ADJUSTMENT_GENERATED: "counts.status.ADJUSTMENT_GENERATED",
  CANCELLED: "counts.status.CANCELLED",
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
  const { t } = useAppTranslation();
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
    { key: "countNo", header: t("counts.count"), sortable: true, render: (c) => <span className="mz-num font-semibold text-ink">{c.countNo ?? "—"}</span> },
    { key: "warehouse", header: t("common.warehouse"), render: (c) => <span className="text-ink">{warehouseLabel(c.warehouseId)}</span> },
    { key: "date", header: t("common.date"), render: (c) => <span className="mz-num text-ink-muted">{c.date}</span> },
    { key: "lines", header: t("counts.items"), align: "end", render: (c) => <span className="mz-num">{c.lines.length}</span> },
    {
      key: "variance",
      header: t("counts.netVarianceValue"),
      align: "end",
      render: (c) =>
        c.variance ? (
          <VarianceBeam value={Number(c.variance.netValue)} className="font-semibold">
            <span className="mz-num">{signedDisplay(c.variance.netValue)}</span>
          </VarianceBeam>
        ) : (
          <span className="text-[11.5px] text-ink-faint">{c.blind ? t("counts.blindCount") : "—"}</span>
        ),
    },
    { key: "status", header: t("common.status"), render: (c) => <StatusPill label={t(STATUS_KEY[c.status])} tone={STATUS_TONE[c.status]} /> },
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
        title={t("counts.physicalCounts")}
        description={t("counts.inProgressCompletedAdjustmentCreated")}
        actions={
          <Button variant="primary" onClick={() => setMode("new")}>
            {t("counts.newCount")}
          </Button>
        }
        stats={[
          { label: t("counts.totalCounts"), value: <span className="mz-num">{stats.all}</span> },
          { label: t("counts.inProgress"), value: <span className="mz-num">{stats.IN_PROGRESS}</span> },
          { label: t("counts.completed"), value: <span className="mz-num">{stats.COMPLETED}</span> },
          { label: t("counts.adjustmentCreated"), value: <span className="mz-num">{stats.ADJUSTMENT_GENERATED}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: stats.all },
          { key: "IN_PROGRESS", label: t("counts.inProgress"), count: stats.IN_PROGRESS },
          { key: "COMPLETED", label: t("counts.completed"), count: stats.COMPLETED },
          { key: "ADJUSTMENT_GENERATED", label: t("counts.adjustmentCreated"), count: stats.ADJUSTMENT_GENERATED },
          { key: "CANCELLED", label: t("docStatus.cancelled"), count: stats.CANCELLED },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | PhysicalCountStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("counts.searchByCountNumber")}
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        onRowClick={(c) => openDetail(c.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{stats.all}</span> {t("counts.counts")}
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading
              ? t("common.loading")
              : query.isError
                ? (query.error?.message ?? t("counts.physicalCountsCouldNotBe"))
                : t("counts.noCountsYetStartOne")}
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
  const { t } = useAppTranslation();
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
      setError(err instanceof ApiError ? err.message : t("counts.theCountCouldNotBe"));
    }
  }

  return (
    <div className="w-full max-w-[560px]">
      <div className="mb-[16px]">
        <div className="mz-eyebrow">{t("eyebrow.inventory.newPhysicalCount")}</div>
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("counts.newCount")}</h1>
      </div>
      <FulcrumRule />
      <Card className="flex flex-col gap-[14px] p-[18px]">
        <SelectField label={t("counts.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} />
        <TextField label={t("counts.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label={t("common.notes")} value={memo} onChange={setMemo} placeholder={t("counts.notesAboutThisCount")} />
        <ToggleField
          label={t("counts.blindCount")}
          checked={blind}
          onChange={setBlind}
          hint={t("counts.hidesSystemQuantitiesFromThe")}
        />
        <p className="text-[11.5px] text-ink-faint">{t("counts.everyItemInTheChosen")}{itemIds.length} {t("counts.items2")}</p>
        {error ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-[9px]">
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={start.isPending || itemIds.length === 0} onClick={handleStart}>
            {t("common.add")}
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
  const { t } = useAppTranslation();
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
      setError(err instanceof ApiError ? err.message : t("counts.theCountedQuantitiesCouldNot"));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="mz-eyebrow">{t("eyebrow.inventory.physicalCount")}</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{count.countNo} — {warehouseLabel(count.warehouseId)}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>{t("counts.saveAndContinueLater")}</Button>
          {isInProgress ? (
            <Button variant="primary" disabled={busy || !allCounted} onClick={handleComplete}>
              {t("counts.finishCount")}
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
          {t("counts.blindCountSystemQuantitiesAnd")}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
                {blindOpen ? null : (
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.system")}</th>
                )}
                <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.counted")}</th>
                {blindOpen ? null : (
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.variance")}</th>
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
                        aria-label={t("counts.countedQtyFor", { item: itemLabel(l.itemId) })}
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
  const { t } = useAppTranslation();
  const generate = useGenerateAdjustmentFromCount();
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    try {
      await generate.mutateAsync({ id: count.id, body: { adjustmentId: crypto.randomUUID() } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("counts.theAdjustmentCouldNotBe"));
    }
  }

  return (
    <div className="w-full">
      <DocumentDetail
        title={count.countNo ?? t("counts.physicalCount")}
        statusLabel={t(STATUS_KEY[count.status])}
        statusTone={STATUS_TONE[count.status]}
        actions={
          <>
            <Button onClick={onBack}>{t("common.back")}</Button>
            {count.status === "IN_PROGRESS" ? <Button variant="primary" onClick={onResume}>{t("counts.continueCount")}</Button> : null}
            {count.status === "COMPLETED" ? (
              <Button variant="primary" disabled={generate.isPending} onClick={handleGenerate}>
                {t("counts.generateAdjustment")}
              </Button>
            ) : null}
          </>
        }
        summary={[
          { label: t("common.warehouse"), value: warehouseLabel(count.warehouseId) },
          { label: t("common.date"), value: <span className="mz-num">{count.date}</span> },
          { label: t("counts.items"), value: <span className="mz-num">{count.lines.length}</span> },
          { label: t("counts.countType"), value: count.blind ? t("counts.blindCount") : t("counts.openCount") },
          {
            label: t("counts.itemsWithVariances"),
            value: (
              <span className="mz-num">
                {count.variance ? count.variance.overLines + count.variance.shortLines : "—"}
              </span>
            ),
          },
          {
            label: t("counts.valueOfOverages"),
            value: <span className="mz-num text-success-ink">{count.variance ? trimMoneyString(count.variance.overValue) : "—"}</span>,
          },
          {
            label: t("counts.valueOfShortages"),
            value: <span className="mz-num text-danger-ink">{count.variance ? trimMoneyString(count.variance.shortValue) : "—"}</span>,
          },
          {
            label: t("counts.netVarianceValue"),
            value: (
              <VarianceBeam value={Number(count.variance?.netValue ?? 0)} className="font-semibold">
                <span className="mz-num">{signedDisplay(count.variance?.netValue ?? null)}</span>
              </VarianceBeam>
            ),
          },
          { label: t("counts.resultingAdjustment"), value: count.generatedAdjustmentId ? t("counts.created") : "—" },
        ]}
        tabs={[
          {
            key: "lines",
            label: t("counts.countLines"),
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
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.system")}</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.counted")}</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.variance")}</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.unitCost")}</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("counts.varianceValue")}</th>
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
