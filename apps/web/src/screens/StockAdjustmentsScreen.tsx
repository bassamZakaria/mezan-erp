import { AlreadySavedNotice, useAlreadySavedNotice, useDocumentId } from "../lib/document-id";
import { ReversalDocumentType } from "@mezan/contracts";
import { useReverseDocumentAction } from "../reversal/ReverseDocumentAction";
import { useEffect, useMemo, useState } from "react";
import { HeldDocumentReapproval } from "../shell/ReapprovalNotice";
import { errorMessage } from "../lib/error-message";
import { EMPTY_LOT, LotCells, lotIsComplete, lotPayload, tracksLots, type LotValue } from "./enh/expiry/LotFields";
import {
  ENGLISH_LOCALE,
  RowActionOutcome,
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  DocumentStatusStepper,
  EmptyState,
  EntityPicker,
  IconButton,
  Money as MoneyDisplay,
  RowMenu,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentStatusStep,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { AccountDTO, CostCategoryDTO, DocumentStatusDTO, ItemDTO, ProjectDTO, StockAdjustmentDocumentDTO } from "@mezan/contracts";
import {
  Money,
  Qty,
  ADJUSTMENT_REASON_DEFINITIONS,
  DocumentStatusCode,
  getAdjustmentReasonDefinition,
  isAdjustmentReason,
  stockAdjustmentDocumentType,
  type AdjustmentReason,
  type AdjustmentReasonDefinition,
  type StockMovementDirection,
} from "@mezan/domain";
import {
  useAccounts,
  useConfirmStockAdjustment,
  useCreateStockAdjustment,
  useItemsByIds,
  useJournalEntry,
  useProjects,
  useStockAdjustment,
  useStockAdjustments,
  useStockAdjustmentCounts,
  useStockAdjustmentStats,
  useWarehouses,
  type StockAdjustmentFilter,
} from "../data/hooks";
import { TextField, SelectField } from "../settings/form-controls";
import { useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useDocumentEffectText } from "../lib/document-effects";
import { useEntityName } from "../lib/entity-names";
import { ItemPicker, itemOption, STOCKED_ITEMS } from "./ItemPicker";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { useDomainLabels } from "../lib/domain-labels";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { useMaySeeItemCost } from "../data/item-cost";
import { ResubmitErrorNotice, ResubmitFamily, ResubmitForApprovalAction, resubmitRowMenuItems, useResubmitForApproval } from "./ResubmitForApprovalAction";

/** تسويات المخزون (Stock Adjustments) — docs/archive/catalog/03. List + detail + create, on the real document-framework API. */


const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Keys, not copy — the stepper's labels are built with the translator at render. */
const STEPPER_KEYS = [
  { key: "draft", labelKey: "docStatus.draft" },
  { key: "confirmed", labelKey: "docStatus.confirmed" },
] as const;

/**
 * The reason's helper text. `useDomainLabels` reads labelAr/labelEn and
 * subtitleAr/subtitleEn; a reason's helper text is descriptionAr/descriptionEn,
 * so it is picked here rather than bending the field names.
 */
function reasonDescription(def: AdjustmentReasonDefinition, locale: string): string {
  return locale === ENGLISH_LOCALE ? def.descriptionEn : def.descriptionAr;
}

function headerOf(doc: StockAdjustmentDocumentDTO): { warehouseId: string; reason: AdjustmentReason } {
  const first = doc.lines[0];
  return first ? { warehouseId: first.warehouseId, reason: first.reason } : { warehouseId: "—", reason: "OTHER" };
}

/** Rebuilds the domain document (Money/Qty instances) from the wire DTO so the REAL `describeEffects` can run client-side. */
function toDomainDoc(doc: StockAdjustmentDocumentDTO) {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      reason: l.reason,
      direction: l.direction,
      qty: Qty.fromMajor(l.qty),
      unitCost: l.unitCost ? Money.fromMajor(l.unitCost) : undefined,
    })),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: doc.journalEntryId,
  };
}

/* -------------------------------------------------------------------- */
/* Create form line state                                               */
/* -------------------------------------------------------------------- */

interface LineDraft {
  key: string;
  itemId: string;
  item?: ItemDTO;
  direction: StockMovementDirection;
  qty: number;
  unitCost: number;
  lot: LotValue;
}

/** Projects still open for new spend/income — a finished or cancelled project cannot take new lines. */
const OPEN_PROJECT_STATUSES = new Set<ProjectDTO["status"]>(["planned", "active", "on_hold"]);

const COST_CATEGORY_VALUES: readonly CostCategoryDTO[] = ["materials", "labour", "equipment", "subcontract", "indirect"];


let lineSeq = 0;
function blankLine(direction: StockMovementDirection): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", direction, qty: 0, unitCost: 0, lot: EMPTY_LOT };
}

export function StockAdjustmentsScreen() {
  const reversal = useReverseDocumentAction(ReversalDocumentType.StockAdjustment);
  const effectText = useDocumentEffectText();
  const nameOf = useEntityName();
  const { t, locale } = useAppTranslation();
  const { label: domainLabel } = useDomainLabels();
  const [reasonFilter, setReasonFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useUrlParam("warehouse");
  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | DocumentStatusDTO,
    (next: string) => void,
  ];

  /**
   * R1.1: one filter feeds the rows, the chips and the KPI strip — the strip
   * used to sum every adjustment regardless of the active status chip.
   */
  const filter = useMemo<StockAdjustmentFilter>(
    () => ({
      status: statusFilter,
      reason: reasonFilter || undefined,
      warehouseId: warehouseFilter || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, reasonFilter, warehouseFilter, search],
  );
  const query = useStockAdjustments(filter);
  const counts = useStockAdjustmentCounts(filter).data ?? {};
  const stats = useStockAdjustmentStats(filter).data ?? {};
  const warehousesQuery = useWarehouses();
  const projectsQuery = useProjects();
  const documents = query.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  function projectLabel(id: string | null | undefined): string | null {
    if (!id) return null;
    const p = projects.find((pr) => pr.id === id);
    return p ? `${p.code} — ${nameOf(p)}` : id;
  }

  function warehouseLabel(id: string): string {
    return nameOf(warehouses.find((w) => w.id === id), id);
  }

  // `#/inventory/stock-adjustments` · `…/new` (reason picker, then the form) · `…/<docNo>`
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const [reasonChoice, setReasonChoice] = useState<AdjustmentReasonDefinition | null>(null);
  const savedNotice = useAlreadySavedNotice();
  /**
   * `#/…/stock-adjustments/new/<REASON>/<itemId?>` — the reason (and optionally
   * the item) can arrive in the URL, which is how "set opening balance" on a
   * zero-stock item row lands here already answered (R5.3). Derived from the
   * route rather than synchronised into state, so a reload or a shared link
   * reopens exactly the same form.
   *
   * The two are independent: a caller that knows the item but not the reason
   * passes `any` in the reason slot and still arrives with the item answered,
   * which is what «تسوية المخزون» on the item detail does. Anything that is not
   * a real reason leaves the picker open rather than guessing one, because the
   * reason decides which GL account absorbs the movement.
   */
  const routedReason = subPage.segments[1];
  const routedItemId = subPage.segments[2] ?? null;
  const selectedReason =
    reasonChoice ??
    (routedReason && isAdjustmentReason(routedReason) ? getAdjustmentReasonDefinition(routedReason) : null);
  const setSelectedReason = setReasonChoice;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const listConfirm = useConfirmStockAdjustment();
  const resubmit = useResubmitForApproval(ResubmitFamily.StockAdjustments);

  const pageCount = Math.max(1, Math.ceil(documents.length / pageSize));
  const pageRows = documents.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = (statusFilter === "all" ? 0 : 1) + (reasonFilter ? 1 : 0) + (warehouseFilter ? 1 : 0);

  /**
   * A deep link names a document the LIST may not hold: the list is warehouse-
   * scoped and paged, so `#/…/<id>` for a real document rendered the list with
   * no message at all (D54). Fall back to fetching the one document by id, and
   * say so plainly when the server does not have it either.
   */
  const inList = selectedId ? (documents.find((d) => d.id === selectedId || d.docNo === selectedId) ?? null) : null;
  const fetched = useStockAdjustment(selectedId !== null && inList === null && !query.isPending ? selectedId : null);
  const selected: StockAdjustmentDocumentDTO | null = inList ?? fetched.data ?? null;
  const { byId: itemById } = useItemsByIds(selected?.lines.map((l) => l.itemId) ?? EMPTY);
  function itemLabel(id: string): string {
    const item = itemById.get(id);
    return item ? `${nameOf(item)} (${item.code})` : id;
  }
  const selectedMissing = selectedId !== null && selected === null && !query.isPending && !fetched.isPending;

  const columns: DocumentListColumn<StockAdjustmentDocumentDTO>[] = [
    {
      key: "docNo",
      header: t("stockAdj.adjustmentNumber"),
      sortable: true,
      render: (d) => (
        <span className="flex flex-col items-start gap-[2px]">
          <span className="mz-num font-semibold text-ink">{d.docNo ?? "—"}</span>
          {reversalLink(d)}
        </span>
      ),
    },
    { key: "date", header: t("common.date"), sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    {
      key: "warehouse",
      header: t("stockAdj.warehouseReason"),
      render: (d) => {
        const { warehouseId, reason } = headerOf(d);
        return (
          <span className="text-ink">
            {warehouseLabel(warehouseId)} — {domainLabel(getAdjustmentReasonDefinition(reason))}
          </span>
        );
      },
    },
    { key: "lines", header: t("stockAdj.lines"), align: "end", render: (d) => <span className="mz-num">{d.lines.length}</span> },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={documentStatusLabel(d.status, t)} tone={DOC_STATUS_TONE[d.status]} /> },
  ];

  function reversalLink(d: StockAdjustmentDocumentDTO) {
    const otherId = d.reversedByDocId ?? d.reversesDocId ?? null;
    if (otherId === null) return null;
    const other = documents.find((candidate) => candidate.id === otherId);
    const label = t(d.reversedByDocId ? "stockAdj.reversedByDocument" : "stockAdj.reversesDocument", { number: other?.docNo ?? otherId });
    return (
      <button
        type="button"
        className="text-[11.5px] font-semibold text-brand underline-offset-2 hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          subPage.open(other?.docNo ?? otherId);
        }}
      >
        {label}
      </button>
    );
  }

  function openDetail(id: string) {
    const doc = documents.find((d) => d.id === id);
    subPage.open(doc?.docNo ?? id);
  }

  async function confirmRow(id: string): Promise<RowActionOutcome | void> {
    if (rowPendingId) return;
    setRowError(null);
    setRowPendingId(id);
    try {
      await listConfirm.mutateAsync(id);
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    } finally {
      setRowPendingId(null);
    }
  }

  if (firstSegment === "new" && selectedReason === null) {
    return (
      <div className="w-full">
        <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
          <div>
            <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("stockAdj.chooseTheAdjustmentReason")}</h1>
            <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("stockAdj.theReasonDecidesHowThe")}</p>
          </div>
          <Button onClick={subPage.close}>{t("common.cancel")}</Button>
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {ADJUSTMENT_REASON_DEFINITIONS.map((def) => (
            <button
              key={def.code}
              type="button"
              onClick={() => {
                setSelectedReason(def);
              }}
              className="flex flex-col gap-[6px] rounded-lg border border-border bg-surface p-[16px] text-start transition-colors hover:border-brand hover:bg-brand-soft"
            >
              <span className="font-display text-[14px] font-bold text-ink">{domainLabel(def)}</span>
              <span className="text-[12px] text-ink-muted">{reasonDescription(def, locale)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (firstSegment === "new" && selectedReason) {
    return (
      <CreateAdjustmentView
        reason={selectedReason}
        initialItemId={routedItemId}
        warehouses={warehouses}
        onDone={() => {
          setSelectedReason(null);
          subPage.close();
        }}
        onAlreadySaved={(savedId) => {
          savedNotice.show(savedId);
          setSelectedReason(null);
          subPage.open(savedId);
        }}
        onBack={() => setSelectedReason(null)}
      />
    );
  }

  if (selectedMissing) {
    return (
      <div className="w-full p-[24px]">
        <EmptyState
          title={t("stockAdj.notFoundTitle")}
          description={t("stockAdj.notFoundBody", { id: selectedId ?? "" })}
          action={{ label: t("common.back"), onClick: subPage.close }}
        />
      </div>
    );
  }

  if (selected) {
    const { warehouseId, reason } = headerOf(selected);
    const def = getAdjustmentReasonDefinition(reason);
    const effects = stockAdjustmentDocumentType.describeEffects(toDomainDoc(selected));
    return (
      <div className="w-full">
        <AlreadySavedNotice notice={savedNotice} openId={selected.id} message={t("documents.alreadySaved")} dismissLabel={t("documents.alreadySaved.dismiss")} />
        <HeldDocumentReapproval document={selected} pending={listConfirm.isPending} confirm={(id) => listConfirm.mutateAsync(id)} />
        {rowError ? (
          <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {rowError}
          </div>
        ) : null}
        <DocumentDetail
          title={selected.docNo ?? t("stockAdj.stockAdjustment")}
          statusLabel={documentStatusLabel(selected.status, t)}
          statusTone={DOC_STATUS_TONE[selected.status]}
          actions={
            selected.status === "draft" ? (
              <Button variant="primary" disabled={listConfirm.isPending} onClick={() => void confirmRow(selected.id)}>
                {t("stockAdj.row.confirm")}
              </Button>
            ) : undefined
          }
          subtitle={<DocumentStatusStepper steps={STEPPER_KEYS.map((step): DocumentStatusStep => ({ key: step.key, label: t(step.labelKey) }))} currentKey={selected.status} />}
          summary={[
            { label: t("common.warehouse"), value: warehouseLabel(warehouseId) },
            { label: t("stockAdj.reason"), value: domainLabel(def) },
            { label: t("common.date"), value: <span className="mz-num">{selected.date}</span> },
            { label: t("stockAdj.lines"), value: <span className="mz-num">{selected.lines.length}</span> },
            ...(selected.reversedByDocId || selected.reversesDocId ? [{ label: t("stockAdj.linkedReversal"), value: reversalLink(selected) }] : []),
            ...(selected.projectId ? [{ label: t("common.project"), value: projectLabel(selected.projectId) ?? selected.projectId }] : []),
            ...(selected.costCategory
              ? [{ label: t("common.costCategory"), value: t(`costCategory.${selected.costCategory}` as AppTranslationKey) }]
              : []),
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
              label: t("stockAdj.adjustmentLines"),
              content: <AdjustmentLinesTable doc={selected} itemLabel={itemLabel} />,
            },
            {
              key: "gl",
              label: t("stockAdj.accounting"),
              content: <AdjustmentGlTab docId={selected.id} />,
            },
          ]}
        />
        <div className="mt-[16px]">
          <ResubmitForApprovalAction family={ResubmitFamily.StockAdjustments} document={selected} />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("stockAdj.stockAdjustmentsCouldNotBe")}</p>
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
      <ResubmitErrorNotice controller={resubmit} />
      <DocumentList<StockAdjustmentDocumentDTO>
        title={t("stockAdj.stockAdjustments")}
        description={t("stockAdj.draftConfirmedAdjustmentsThatChange")}
        actions={
          <Button variant="primary" onClick={() => { setSelectedReason(null); subPage.open("new"); }}>
            {t("stockAdj.newAdjustment")}
          </Button>
        }
        listKey="stock-adjustments"
        statsCollapsible
        stats={[
          { label: t("stockAdj.totalAdjustments"), value: <span className="mz-num">{stats.count ?? 0}</span> },
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
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("stockAdj.searchByAdjustmentNumber")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <SelectField
              label={t("stockAdj.filter.reason")}
              value={reasonFilter}
              onChange={(v) => {
                setReasonFilter(v);
                setPage(1);
              }}
              options={[
                { value: "", label: t("stockAdj.filter.allReasons") },
                ...ADJUSTMENT_REASON_DEFINITIONS.map((def) => ({ value: def.code, label: domainLabel(def) })),
              ]}
            />
            <SelectField
              label={t("stockAdj.filter.warehouse")}
              value={warehouseFilter}
              onChange={(v) => {
                setWarehouseFilter(v);
                setPage(1);
              }}
              options={[
                { value: "", label: t("stockAdj.filter.allWarehouses") },
                ...warehouses.map((w) => ({ value: w.id, label: w.name })),
              ]}
            />
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        rowAction={(d) => {
          // A confirmed adjustment has already moved stock and posted; it is corrected by a new adjustment, never re-confirmed.
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => openDetail(d.id) },
            ...(d.status === "draft"
              ? [{ key: "confirm", label: t("stockAdj.row.confirm"), disabled: rowPendingId === d.id, onSelect: () => confirmRow(d.id) }]
              : []),
            ...resubmitRowMenuItems(resubmit, d),
            ...(d.status === DocumentStatusCode.Confirmed && !d.reversesDocId ? reversal.menuItems({ id: d.id, params: { id: d.id }, subject: d.docNo ?? d.id }) : []),
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{documents.length}</span> {t("stockAdj.adjustments")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("stockAdj.noMatchingAdjustments")}
            description={t("stockAdj.emptyBody")}
            action={{ label: t("stockAdj.newAdjustment"), onClick: () => { setSelectedReason(null); subPage.open("new"); } }}
          />
        }
      />
      {reversal.dialog}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Lines tab                                                            */
/* -------------------------------------------------------------------- */

function AdjustmentLinesTable({ doc, itemLabel }: { doc: StockAdjustmentDocumentDTO; itemLabel: (id: string) => string }) {
  const { t } = useAppTranslation();
  const showCost = useMaySeeItemCost();
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.direction")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.qty")}</th>
              {showCost ? <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.costPrice")}</th> : null}
              {showCost ? <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.value")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => {
              const value = l.unitCost ? Number(l.qty) * Number(l.unitCost) : null;
              return (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                  <td className="px-[15px] py-[11px]">
                    <StatusPill label={l.direction === "IN" ? t("stockAdj.increase") : t("stockAdj.decrease")} tone={l.direction === "IN" ? "success" : "danger"} />
                  </td>
                  <td className="px-[15px] py-[11px] text-end mz-num">{l.qty}</td>
                  {showCost ? <td className="px-[15px] py-[11px] text-end">{l.unitCost ? <MoneyDisplay value={Number(l.unitCost)} /> : "—"}</td> : null}
                  {showCost ? <td className="px-[15px] py-[11px] text-end">{value !== null ? <MoneyDisplay value={value} /> : t("stockAdj.calculatedAtTheCurrentAverage")}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* GL tab — looks the journal entry up by the adjustment's OWN id        */
/* -------------------------------------------------------------------- */

function accountLabel(id: string, accounts: readonly AccountDTO[], nameOf: (a: AccountDTO | undefined) => string): string {
  const account = accounts.find((a) => a.id === id);
  return account ? nameOf(account) : id;
}

function AdjustmentGlTab({ docId }: { docId: string }) {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const entryQuery = useJournalEntry(docId);
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];

  if (entryQuery.isPending) return <div className="p-4 text-[12.5px] text-ink-muted">{t("common.loading")}</div>;
  if (entryQuery.isError) {
    if (entryQuery.error.status === 404) {
      return <div className="p-4 text-[12.5px] text-ink-muted">{t("stockAdj.noJournalEntryForThis")}</div>;
    }
    return <div className="p-4 text-[12.5px] text-danger-ink">{t("stockAdj.theJournalEntryCouldNot")}</div>;
  }

  const entry = entryQuery.data;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.account")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId, accounts, nameOf)}</td>
                <td className="px-[15px] py-[11px] text-end">{Number(l.debit) !== 0 ? <MoneyDisplay value={Number(l.debit)} /> : "—"}</td>
                <td className="px-[15px] py-[11px] text-end">{Number(l.credit) !== 0 ? <MoneyDisplay value={Number(l.credit)} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

function CreateAdjustmentView({
  initialItemId,
  reason,
  warehouses,
  onDone,
  onAlreadySaved,
  onBack,
}: {
  onAlreadySaved: (savedId: string) => void;
  /** Prefills the first line, for "set opening balance" on an item row (R5.3). */
  initialItemId?: string | null;
  reason: AdjustmentReasonDefinition;
  warehouses: ReturnType<typeof useWarehouses>["data"];
  onDone: () => void;
  onBack: () => void;
}) {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const { label: reasonLabelOf } = useDomainLabels();
  const reasonLabel = reasonLabelOf(reason);
  const createAdjustment = useCreateStockAdjustment();
  const confirmAdjustment = useConfirmStockAdjustment();
  const adjustmentId = useDocumentId(onAlreadySaved);
  const projectsQuery = useProjects();
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses?.[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [costCategory, setCostCategory] = useState<CostCategoryDTO | "">("");
  const defaultDirection: StockMovementDirection = reason.direction === "OUT" ? "OUT" : "IN";
  const [lines, setLines] = useState<LineDraft[]>([
    initialItemId ? { ...blankLine(defaultDirection), itemId: initialItemId } : blankLine(defaultDirection),
  ]);
  const [error, setError] = useState<string | null>(null);

  const warehouseList = warehouses ?? EMPTY;

  function warehouseLabel(id: string): string {
    return nameOf(warehouseList.find((w) => w.id === id), id);
  }

  const warehouseOptions = useMemo(() => warehouseList.map((w) => ({ value: w.id, label: w.name })), [warehouseList]);
  const projectOptions: EntityPickerOption[] = (projectsQuery.data ?? [])
    .filter((p) => OPEN_PROJECT_STATUSES.has(p.status))
    .map((p) => ({ id: p.id, label: `${p.code} — ${nameOf(p)}` }));
  const costCategoryOptions = [
    { value: "", label: t("common.none") },
    ...COST_CATEGORY_VALUES.map((c) => ({ value: c, label: t(`costCategory.${c}` as AppTranslationKey) })),
  ];

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine(defaultDirection)]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const { byId: routedItems } = useItemsByIds(lines.filter((l) => !l.item).map((l) => l.itemId));
  const itemOf = (line: LineDraft) => line.item ?? routedItems.get(line.itemId);
  const pickerValue = (line: LineDraft) => {
    const item = itemOf(line);
    return item ? itemOption(item) : null;
  };
  const countsLotsFree = reason.code === "PHYSICAL_COUNT";
  const showLotColumns = !countsLotsFree && lines.some((l) => l.direction === "IN" && tracksLots(itemOf(l)));
  const allLinesValid = lines.every(
    (l) =>
      itemOf(l) !== undefined &&
      l.qty > 0 &&
      (l.direction === "OUT" || l.unitCost > 0) &&
      (l.direction === "OUT" || countsLotsFree || lotIsComplete(itemOf(l), l.lot)),
  );
  const busy = createAdjustment.isPending || confirmAdjustment.isPending;
  const canPost = allLinesValid && warehouseId !== "" && !busy;

  async function handlePost() {
    if (!canPost) return;
    setError(null);
    try {
      const draft = await createAdjustment.mutateAsync({
        id: adjustmentId.current(),
        date,
        memo: memo.trim() || `${reason.labelAr} — ${warehouseLabel(warehouseId)}`,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          warehouseId,
          reason: reason.code,
          direction: l.direction,
          qty: String(l.qty),
          unitCost: l.direction === "IN" ? String(l.unitCost) : undefined,
          ...(l.direction === "IN" && tracksLots(itemOf(l)) ? lotPayload(l.lot) : {}),
        })),
        projectId: projectId || null,
        costCategory: projectId && costCategory ? costCategory : null,
      });
      if (draft.status === "draft") await confirmAdjustment.mutateAsync(draft.id);
      adjustmentId.renew();
      onDone();
    } catch (err) {
      if (adjustmentId.recover(err)) return;
      setError(err instanceof Error ? err.message : t("stockAdj.theAdjustmentCouldNotBe"));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{reason.code === "INITIAL_STOCK" ? t("stockAdj.openingBalance") : t("stockAdj.titleForReason", { reason: reasonLabel })}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onBack}>{t("common.back")}</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            {t("stockAdj.approveAdjustment")}
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-[16px]">
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-3">
            <TextField label={t("stockAdj.adjustmentDate")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <SelectField label={t("stockAdj.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} />
            <TextField label={t("common.notes")} value={memo} onChange={setMemo} placeholder={t("stockAdj.describeTheAdjustment")} />
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("common.project")}</div>
              <EntityPicker
                label={undefined}
                value={projectOptions.find((o) => o.id === projectId) ?? null}
                onChange={(o) => {
                  setProjectId(o?.id ?? "");
                  if (!o) setCostCategory("");
                }}
                options={projectOptions}
                placeholder={t("common.noProject")}
              />
            </div>
            <SelectField
              label={t("common.costCategory")}
              value={costCategory}
              onChange={(v) => setCostCategory(v as CostCategoryDTO | "")}
              options={costCategoryOptions}
              disabled={!projectId}
            />
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
                    {reason.direction === "EITHER" ? (
                      <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.direction")}</th>
                    ) : null}
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.qty")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.costPrice")}</th>
                    {showLotColumns ? (
                      <>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("expiry.lot.batchNo")}</th>
                        <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("expiry.lot.expiryDate")}</th>
                      </>
                    ) : null}
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={line.key} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[8px]">
                        <ItemPicker
                          className="min-w-[160px]"
                          ariaLabel={t("stockAdj.lineItem", { number: i + 1 })}
                          placeholder={t("stockAdj.chooseAnItem")}
                          value={pickerValue(line)}
                          onChange={(item) => updateLine(i, { itemId: item?.id ?? "", item: item ?? undefined })}
                          filter={STOCKED_ITEMS}
                        />
                      </td>
                      {reason.direction === "EITHER" ? (
                        <td className="px-[12px] py-[8px]">
                          <Select
                            size="sm"
                            className="min-w-[100px]"
                            aria-label={t("stockAdj.lineDirection", { number: i + 1 })}
                            value={line.direction}
                            onChange={(value) => updateLine(i, { direction: value as StockMovementDirection })}
                            options={[
                              { value: "IN", label: t("stockAdj.increase") },
                              { value: "OUT", label: t("stockAdj.decrease") },
                            ]}
                          />
                        </td>
                      ) : null}
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[100px] text-end"
                          aria-label={t("stockAdj.lineQty", { number: i + 1 })}
                          value={line.qty || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { qty: e.target.valueAsNumber || 0 })}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[110px] text-end"
                          aria-label={t("stockAdj.lineCost", { number: i + 1 })}
                          value={line.unitCost || ""}
                          min={0}
                          disabled={line.direction === "OUT"}
                          onChange={(e) => updateLine(i, { unitCost: e.target.valueAsNumber || 0 })}
                        />
                      </td>
                      {showLotColumns ? (
                        <LotCells
                          item={itemOf(line)}
                          value={line.lot}
                          disabled={line.direction === "OUT"}
                          lineNumber={i + 1}
                          onChange={(lot) => updateLine(i, { lot })}
                        />
                      ) : null}
                      <td className="px-[12px] py-[8px] text-center">
                        <IconButton aria-label={t("stockAdj.removeLine", { number: i + 1 })} disabled={lines.length <= 1} onClick={() => removeLine(i)}>
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
                {t("stockAdj.addLine")}
              </Button>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-[16px]">
          <div
            className="rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
            style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
          >
            <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">{t("stockAdj.whatThisAdjustmentDid")}</h3>
            <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {lines.some((l) => l.direction === "IN") ? t("stockAdj.stockValueWentUp") : t("stockAdj.stockValueWentDown")} {t("stockAdj.accordingToTheAdjustmentLines")}
              </li>
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {t("stockAdj.noEffectOnAnySupplier")}
              </li>
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {t("stockAdj.itPostsABalancingJournal")}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
