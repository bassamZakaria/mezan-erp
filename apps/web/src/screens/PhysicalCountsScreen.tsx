import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  type DocumentListColumn,
  EmptyState,
  modKeyLabel,
  type PillTone,
  RowMenu,
  type RowMenuItem,
  StatusPill,
  TextInput,
  trimMoneyString,
  VarianceBeam,
} from "@mezan/ui";
import type { PhysicalCountDTO, PhysicalCountStatusDTO } from "@mezan/contracts";
import {
  useCancelPhysicalCount,
  useCompletePhysicalCount,
  useGenerateAdjustmentFromCount,
  useRecordPhysicalCounts,
  useStartPhysicalCount,
  useStockBalance,
} from "../data/inventory-ops-hooks";
import {
  useItems,
  useWarehouses,
  usePhysicalCounts,
  usePhysicalCountCounts,
  usePhysicalCountStats,
  ApiError,
  type PhysicalCountFilter,
} from "../data/hooks";
import { TextField, SelectField, ToggleField } from "../settings/form-controls";
import { useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { todayIso } from "../lib/dates";

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
const PAGE_SIZES = [10, 25, 50, 100] as const;

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
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const itemsQuery = useItems();
  const warehousesQuery = useWarehouses();

  // `#/inventory/physical-counts` · `…/new` · `…/<id>` · `…/<id>/count` (the counting sheet)
  const subPage = useSubPage();
  const [firstSegment, secondSegment] = subPage.segments;
  const [statusFilter, setStatusFilter] = useState<"all" | PhysicalCountStatusDTO>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const cancelCount = useCancelPhysicalCount();

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1) — the chips
   * and the totals used to be counted in the browser over every count the
   * server had sent, so the KPI strip ignored the active status chip.
   */
  const filter = useMemo<PhysicalCountFilter>(
    () => ({ status: statusFilter, search: search.trim() || undefined }),
    [statusFilter, search],
  );

  const query = usePhysicalCounts(filter);
  const counts = query.data ?? [];
  const countsByStatus = usePhysicalCountCounts(filter).data ?? {};
  const stats = usePhysicalCountStats(filter).data ?? {};
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const warehouseLabel = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.id, nameOf(w)]));
    return (id: string) => map.get(id) ?? id;
  }, [warehouses]);
  const itemLabel = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, `${i.nameAr} (${i.code})`]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

  const filtered = counts;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  const selected = selectedId ? (counts.find((c) => c.id === selectedId) ?? null) : null;
  const active = secondSegment === "count" ? selected : null;

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
    subPage.open(id);
  }

  async function cancelRow(id: string): Promise<void> {
    if (rowPendingId) return;
    setRowError(null);
    setRowPendingId(id);
    try {
      await cancelCount.mutateAsync(id);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowPendingId(null);
    }
  }

  if (firstSegment === "new") {
    return (
      <NewCountView
        warehouses={warehouses}
        onStarted={(id) => subPage.open(id, "count")}
        onCancel={subPage.close}
      />
    );
  }

  if (active && secondSegment === "count") {
    return (
      <CountEntryView
        count={active}
        itemLabel={itemLabel}
        warehouseLabel={warehouseLabel}
        onDone={subPage.close}
      />
    );
  }

  if (selected) {
    return (
      <CountDetailView
        count={selected}
        itemLabel={itemLabel}
        warehouseLabel={warehouseLabel}
        onResume={() => subPage.open(selected.id, "count")}
      />
    );
  }

  return (
    <div className="w-full">
      {rowError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      <DocumentList<PhysicalCountDTO>
        title={t("counts.physicalCounts")}
        description={t("counts.inProgressCompletedAdjustmentCreated")}
        actions={
          <Button variant="primary" shortcut={modKeyLabel() + "+N"} onClick={() => subPage.open("new")}>
            {t("counts.newCount")}
          </Button>
        }
        listKey="physical-counts"
        statsCollapsible
        stats={[
          { label: t("counts.totalCounts"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("counts.inProgress"), value: <span className="mz-num">{stats.IN_PROGRESS ?? 0}</span> },
          { label: t("counts.completed"), value: <span className="mz-num">{stats.COMPLETED ?? 0}</span> },
          { label: t("counts.adjustmentCreated"), value: <span className="mz-num">{stats.ADJUSTMENT_GENERATED ?? 0}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: countsByStatus.all ?? 0 },
          { key: "IN_PROGRESS", label: t("counts.inProgress"), count: countsByStatus.IN_PROGRESS ?? 0 },
          { key: "COMPLETED", label: t("counts.completed"), count: countsByStatus.COMPLETED ?? 0 },
          { key: "ADJUSTMENT_GENERATED", label: t("counts.adjustmentCreated"), count: countsByStatus.ADJUSTMENT_GENERATED ?? 0 },
          { key: "CANCELLED", label: t("docStatus.cancelled"), count: countsByStatus.CANCELLED ?? 0 },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | PhysicalCountStatusDTO);
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("counts.searchByCountNumber")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(c) => c.id}
        onRowClick={(c) => openDetail(c.id)}
        rowAction={(c) => {
          // Only a completed count can raise the adjustment, and only a live one can still be abandoned.
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => openDetail(c.id) },
            ...(c.status === "IN_PROGRESS"
              ? [
                  { key: "resume", label: t("counts.continueCount"), onSelect: () => subPage.open(c.id, "count") },
                  {
                    key: "cancel",
                    label: t("common.cancel"),
                    tone: "danger" as const,
                    disabled: rowPendingId === c.id,
                    onSelect: () => void cancelRow(c.id),
                  },
                ]
              : []),
            ...(c.status === "COMPLETED"
              ? [{ key: "generate", label: t("counts.generateAdjustment"), onSelect: () => openDetail(c.id) }]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: c.countNo ?? c.id })} />;
        }}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("counts.counts")}
          </>
        }
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>
          ) : query.isError ? (
            <div className="p-8 text-center text-sm text-ink-muted">{query.error?.message ?? t("counts.physicalCountsCouldNotBe")}</div>
          ) : (
            <EmptyState
              title={t("counts.noCountsYetStartOne")}
              description={t("counts.emptyBody")}
              action={{ label: t("counts.newCount"), onClick: () => subPage.open("new") }}
            />
          )
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
  const [date, setDate] = useState(todayIso());
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
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("counts.newCount")}</h1>
      </div>
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
                      <TextInput
                        type="number"
                        size="sm"
                        numeric
                        className="w-[110px] text-end"
                        aria-label={t("counts.countedQtyFor", { item: itemLabel(l.itemId) })}
                        value={value}
                        min={0}
                        step="any"
                        disabled={!isInProgress}
                        onChange={(e) => setCounted((prev) => ({ ...prev, [l.itemId]: e.target.value }))}
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
  onResume,
}: {
  count: PhysicalCountDTO;
  itemLabel: (id: string) => string;
  warehouseLabel: (id: string) => string;
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
