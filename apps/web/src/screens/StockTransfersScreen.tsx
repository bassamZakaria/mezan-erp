import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  DocumentStatusStepper,
  EmptyState,
  IconButton,
  RowMenu,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { DocumentStatusDTO, StockTransferDocumentDTO } from "@mezan/contracts";
import { Qty, stockTransferDocumentType } from "@mezan/domain";
import {
  useConfirmStockTransfer,
  useCreateStockTransfer,
  useItems,
  useStockTransfer,
  useStockTransfers,
  useStockTransferCounts,
  useStockTransferStats,
  useWarehouses,
  type StockDocumentListFilter,
} from "../data/hooks";
import { TextField, SelectField } from "../settings/form-controls";
import { useSubPage } from "../navigation";
import { useAppTranslation } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { useDocumentEffectText } from "../lib/document-effects";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { todayIso } from "../lib/dates";

/** تحويلات المخزون (Stock Transfers) — docs/catalog/03. Valuation-neutral, one-way confirm. On the real document-framework API. */


const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Keys, not copy — the stepper's labels are built with the translator at render. */
const STEPPER_KEYS = [
  { key: "draft", labelKey: "docStatus.draft" },
  { key: "confirmed", labelKey: "docStatus.confirmed" },
] as const;

function headerOf(doc: StockTransferDocumentDTO): { fromWarehouseId: string; toWarehouseId: string } {
  const first = doc.lines[0];
  return first ? { fromWarehouseId: first.fromWarehouseId, toWarehouseId: first.toWarehouseId } : { fromWarehouseId: "—", toWarehouseId: "—" };
}

/** Rebuilds the domain document (Qty instances) from the wire DTO so the REAL `describeEffects` can run client-side. */
function toDomainDoc(doc: StockTransferDocumentDTO) {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      fromWarehouseId: l.fromWarehouseId,
      toWarehouseId: l.toWarehouseId,
      qty: Qty.fromMajor(l.qty),
    })),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

interface LineDraft {
  key: string;
  itemId: string;
  qty: number;
}
let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", qty: 0 };
}

export function StockTransfersScreen() {
  const nameOf = useEntityName();
  const effectText = useDocumentEffectText();
  const { t } = useAppTranslation();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  function warehouseLabel(id: string): string {
    return nameOf(warehouses.find((w) => w.id === id), id);
  }
  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }

  // `#/inventory/stock-transfers` · `…/new` · `…/new/<itemId>` · `…/<docNo>`
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  // Set when «تحويل مخزني» on the item detail routes here, so the first line
  // opens on that item instead of making the user find it again.
  const routedItemId = firstSegment === "new" ? (subPage.segments[1] ?? null) : null;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatusDTO>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const listConfirm = useConfirmStockTransfer();

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1) — the chips
   * and the totals used to be derived in the browser from every document the
   * server had sent, so the KPI strip ignored the active status chip.
   */
  const filter = useMemo<StockDocumentListFilter>(
    () => ({ status: statusFilter, search: search.trim() || undefined }),
    [statusFilter, search],
  );

  const query = useStockTransfers(filter);
  const documents = query.data ?? [];
  const counts = useStockTransferCounts(filter).data ?? {};
  const stats = useStockTransferStats(filter).data ?? {};

  const filtered = documents;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  /**
   * A deep link names a document the LIST may not hold: the list is warehouse-
   * scoped and paged, so `#/…/<id>` for a real document rendered the list with
   * no message at all (D54). Fall back to fetching the one document by id, and
   * say so plainly when the server does not have it either.
   */
  const inList = selectedId ? (documents.find((d) => d.id === selectedId || d.docNo === selectedId) ?? null) : null;
  const fetched = useStockTransfer(selectedId !== null && inList === null ? selectedId : null);
  const selected: StockTransferDocumentDTO | null = inList ?? fetched.data ?? null;
  const selectedMissing = selectedId !== null && selected === null && !fetched.isPending;

  const columns: DocumentListColumn<StockTransferDocumentDTO>[] = [
    {
      key: "docNo",
      header: t("stockXfer.transferNumber"),
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? "—"}</span>,
    },
    { key: "date", header: t("common.date"), sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    {
      key: "route",
      header: t("stockXfer.route"),
      render: (d) => {
        const { fromWarehouseId, toWarehouseId } = headerOf(d);
        return (
          <span className="text-ink">
            {warehouseLabel(fromWarehouseId)} ← {warehouseLabel(toWarehouseId)}
          </span>
        );
      },
    },
    { key: "lines", header: t("stockXfer.lines"), align: "end", render: (d) => <span className="mz-num">{d.lines.length}</span> },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={documentStatusLabel(d.status, t)} tone={DOC_STATUS_TONE[d.status]} /> },
  ];

  function openDetail(id: string) {
    const doc = documents.find((d) => d.id === id);
    subPage.open(doc?.docNo ?? id);
  }

  async function confirmRow(id: string): Promise<void> {
    if (rowPendingId) return;
    setRowError(null);
    setRowPendingId(id);
    try {
      await listConfirm.mutateAsync(id);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowPendingId(null);
    }
  }

  if (firstSegment === "new") {
    return <CreateTransferView warehouses={warehouses} items={items} onDone={subPage.close} initialItemId={routedItemId} />;
  }

  if (selectedMissing) {
    return (
      <div className="w-full p-[24px]">
        <EmptyState
          title={t("stockTransfers.notFoundTitle")}
          description={t("stockTransfers.notFoundBody", { id: selectedId ?? "" })}
          action={{ label: t("common.back"), onClick: subPage.close }}
        />
      </div>
    );
  }

  if (selected) {
    const { fromWarehouseId, toWarehouseId } = headerOf(selected);
    const effects = stockTransferDocumentType.describeEffects(toDomainDoc(selected));
    return (
      <div className="w-full">
        <DocumentDetail
          title={selected.docNo ?? t("stockXfer.stockTransfer")}
          statusLabel={documentStatusLabel(selected.status, t)}
          statusTone={DOC_STATUS_TONE[selected.status]}
          subtitle={<DocumentStatusStepper steps={STEPPER_KEYS.map((step): DocumentStatusStep => ({ key: step.key, label: t(step.labelKey) }))} currentKey={selected.status} />}
          actions={<Button onClick={subPage.close}>{t("common.back")}</Button>}
          summary={[
            { label: t("stockXfer.fromWarehouse"), value: warehouseLabel(fromWarehouseId) },
            { label: t("stockXfer.toWarehouse"), value: warehouseLabel(toWarehouseId) },
            { label: t("common.date"), value: <span className="mz-num">{selected.date}</span> },
            { label: t("stockXfer.lines"), value: <span className="mz-num">{selected.lines.length}</span> },
          ]}
          effects={effects.effects.map((e) => {
            const { text, detail } = effectText(e);
            return (
              <span key={e.key ?? e.description}>
                {text}
                {detail ? <span className="block text-[11.5px] text-ink-muted">{detail}</span> : null}
              </span>
            );
          })}
          tabs={[
            {
              key: "lines",
              label: t("stockXfer.lines2"),
              content: (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[400px] border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.qty")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                            <td className="px-[15px] py-[11px] text-end mz-num">{l.qty}</td>
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
        {selected.status === "confirmed" ? (
          <div className="mt-[16px] rounded-md border border-border bg-surface-2 px-[14px] py-[11px] text-[12px] text-ink-muted">
            {t("stockXfer.aConfirmedTransferCannotBe")}
          </div>
        ) : null}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("stockXfer.stockTransfersCouldNotBe")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
      {rowError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      <DocumentList<StockTransferDocumentDTO>
        title={t("stockXfer.stockTransfers")}
        description={t("stockXfer.draftConfirmedMovingQuantityBetween")}
        actions={
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("stockXfer.newTransfer")}
          </Button>
        }
        listKey="stock-transfers"
        statsCollapsible
        stats={[
          { label: t("stockXfer.totalTransfers"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("docStatus.draft"), value: <span className="mz-num">{stats.draft ?? 0}</span> },
          { label: t("docStatus.confirmed"), value: <span className="mz-num">{stats.confirmed ?? 0}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: counts.all ?? 0 },
          { key: "draft", label: t("docStatus.draft"), count: counts.draft ?? 0 },
          { key: "confirmed", label: t("docStatus.confirmed"), count: counts.confirmed ?? 0 },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | DocumentStatusDTO);
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("stockXfer.searchByTransferNumber")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        rowAction={(d) => {
          // A confirmed transfer is irreversible; the counter-move is a new transfer, so it offers no confirm and no cancel.
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => openDetail(d.id) },
            ...(d.status === "draft"
              ? [{ key: "confirm", label: t("stockXfer.row.confirm"), disabled: rowPendingId === d.id, onSelect: () => void confirmRow(d.id) }]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: d.docNo ?? d.id })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("stockXfer.transfers")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("stockXfer.noMatchingTransfers")}
            description={t("stockXfer.emptyBody")}
            action={{ label: t("stockXfer.newTransfer"), onClick: () => subPage.open("new") }}
          />
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

function CreateTransferView({
  warehouses,
  items,
  onDone,
  initialItemId,
}: {
  warehouses: ReturnType<typeof useWarehouses>["data"];
  items: ReturnType<typeof useItems>["data"];
  onDone: () => void;
  initialItemId?: string | null;
}) {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const createTransfer = useCreateStockTransfer();
  const confirmTransfer = useConfirmStockTransfer();
  const warehouseList = warehouses ?? [];
  const itemList = items ?? [];

  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState(warehouseList[0]?.id ?? "");
  const [toWarehouseId, setToWarehouseId] = useState(warehouseList[1]?.id ?? warehouseList[0]?.id ?? "");
  // Seeded once from the route, not synchronised: the user must be able to
  // change the line the item detail put here.
  const [lines, setLines] = useState<LineDraft[]>(() => [{ ...blankLine(), itemId: initialItemId ?? "" }]);
  const [error, setError] = useState<string | null>(null);

  function warehouseLabel(id: string): string {
    return nameOf(warehouseList.find((w) => w.id === id), id);
  }

  const itemOptions = useMemo(
    () => [{ value: "", label: t("stockXfer.chooseAnItem") }, ...itemList.filter((i) => i.type !== "service").map((i) => ({ value: i.id, label: i.nameAr }))],
    [itemList],
  );
  const warehouseOptions = useMemo(() => warehouseList.map((w) => ({ value: w.id, label: w.name })), [warehouseList]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const sameWarehouse = fromWarehouseId !== "" && fromWarehouseId === toWarehouseId;
  const allLinesValid = lines.every((l) => l.itemId !== "" && l.qty > 0);
  const busy = createTransfer.isPending || confirmTransfer.isPending;
  const canPost = allLinesValid && fromWarehouseId !== "" && toWarehouseId !== "" && !sameWarehouse && !busy;

  async function handlePost() {
    if (!canPost) return;
    setError(null);
    try {
      const draft = await createTransfer.mutateAsync({
        id: crypto.randomUUID(),
        date,
        memo: memo.trim() || t("stockXfer.defaultMemo", { from: warehouseLabel(fromWarehouseId), to: warehouseLabel(toWarehouseId) }),
        lines: lines.map((l) => ({ itemId: l.itemId, fromWarehouseId, toWarehouseId, qty: String(l.qty) })),
      });
      await confirmTransfer.mutateAsync(draft.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stockXfer.theTransferCouldNotBe"));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("stockXfer.newStockTransfer")}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            {t("common.save")}
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[16px]">
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-2">
            <TextField label={t("stockXfer.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <TextField label={t("common.notes")} value={memo} onChange={setMemo} placeholder={t("stockXfer.describeTheTransfer")} />
            <SelectField label={t("stockXfer.fromWarehouse2")} value={fromWarehouseId} onChange={setFromWarehouseId} options={warehouseOptions} />
            <SelectField label={t("stockXfer.toWarehouse2")} value={toWarehouseId} onChange={setToWarehouseId} options={warehouseOptions} />
          </Card>
          {sameWarehouse ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {t("stockXfer.theSourceAndDestinationWarehouses")}
            </div>
          ) : null}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("stockXfer.transferQuantity")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={line.key} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[8px]">
                        <Select
                          size="sm"
                          className="min-w-[160px]"
                          aria-label={t("stockXfer.lineItem", { number: i + 1 })}
                          value={line.itemId}
                          onChange={(value) => updateLine(i, { itemId: value })}
                          options={itemOptions}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[110px] text-end"
                          aria-label={t("stockXfer.lineQty", { number: i + 1 })}
                          value={line.qty || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { qty: e.target.valueAsNumber || 0 })}
                        />
                      </td>
                      <td className="px-[12px] py-[8px] text-center">
                        <IconButton aria-label={t("stockXfer.removeLine", { number: i + 1 })} disabled={lines.length <= 1} onClick={() => removeLine(i)}>
                          ✕
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border p-[12px]">
              <Button size="sm" onClick={addLine}>
                {t("stockXfer.addLine")}
              </Button>
            </div>
          </Card>
        </div>

        <div
          className="rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
          style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
        >
          <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">{t("stockXfer.whatThisTransferDid")}</h3>
          <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
            <li className="flex items-start gap-[8px]">
              <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
              {t("stockXfer.quantitiesLeaveTheSourceWarehouse")}
            </li>
            <li className="flex items-start gap-[8px]">
              <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
              {t("stockXfer.totalStockValueDoesNot")}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
