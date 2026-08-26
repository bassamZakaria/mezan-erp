import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  DocumentStatusStepper,
  FulcrumRule,
  IconButton,
  Money as MoneyDisplay,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
} from "@mezan/ui";
import type { AccountDTO, DocumentStatusDTO, StockAdjustmentDocumentDTO } from "@mezan/contracts";
import {
  Money,
  Qty,
  ADJUSTMENT_REASON_DEFINITIONS,
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
  useItems,
  useJournalEntry,
  useStockAdjustments,
  useWarehouses,
} from "../data/hooks";
import { TextField, SelectField } from "../settings/form-controls";
import { useSubPage } from "../navigation";
import { useAppTranslation } from "../i18n";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { useDomainLabels } from "../lib/domain-labels";
import { todayIso } from "../lib/dates";

/** تسويات المخزون (Stock Adjustments) — docs/catalog/03. List + detail + create, on the real document-framework API. */


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
  return locale === "en" ? def.descriptionEn : def.descriptionAr;
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
  direction: StockMovementDirection;
  qty: number;
  unitCost: number;
}

let lineSeq = 0;
function blankLine(direction: StockMovementDirection): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", direction, qty: 0, unitCost: 0 };
}

export function StockAdjustmentsScreen() {
  const { t, locale } = useAppTranslation();
  const { label: domainLabel } = useDomainLabels();
  const [reasonFilter, setReasonFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const query = useStockAdjustments({
    ...(reasonFilter ? { reason: reasonFilter } : {}),
    ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
  });
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const documents = query.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  function warehouseLabel(id: string): string {
    return warehouses.find((w) => w.id === id)?.name ?? id;
  }
  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }

  // `#/inventory/stock-adjustments` · `…/new` (reason picker, then the form) · `…/<docNo>`
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const [reasonChoice, setReasonChoice] = useState<AdjustmentReasonDefinition | null>(null);
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatusDTO>("all");

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      else if (d.status === "confirmed") c.confirmed += 1;
    }
    return c;
  }, [documents]);

  const filtered = useMemo(() => {
    let rows = documents;
    if (statusFilter !== "all") rows = rows.filter((d) => d.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((d) => (d.docNo ?? "").toLowerCase().includes(q) || d.memo.toLowerCase().includes(q));
    }
    return rows;
  }, [documents, statusFilter, search]);

  const selected = selectedId ? (documents.find((d) => d.id === selectedId || d.docNo === selectedId) ?? null) : null;

  const columns: DocumentListColumn<StockAdjustmentDocumentDTO>[] = [
    {
      key: "docNo",
      header: t("stockAdj.adjustmentNumber"),
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? "—"}</span>,
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

  function openDetail(id: string) {
    const doc = documents.find((d) => d.id === id);
    subPage.open(doc?.docNo ?? id);
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
        <FulcrumRule />
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
        items={items}
        onDone={() => {
          setSelectedReason(null);
          subPage.close();
        }}
        onBack={() => setSelectedReason(null)}
      />
    );
  }

  if (selected) {
    const { warehouseId, reason } = headerOf(selected);
    const def = getAdjustmentReasonDefinition(reason);
    const effects = stockAdjustmentDocumentType.describeEffects(toDomainDoc(selected));
    return (
      <div className="w-full">
        <DocumentDetail
          title={selected.docNo ?? t("stockAdj.stockAdjustment")}
          statusLabel={documentStatusLabel(selected.status, t)}
          statusTone={DOC_STATUS_TONE[selected.status]}
          subtitle={<DocumentStatusStepper steps={STEPPER_KEYS.map((step): DocumentStatusStep => ({ key: step.key, label: t(step.labelKey) }))} currentKey={selected.status} />}
          actions={<Button onClick={subPage.close}>{t("common.back")}</Button>}
          summary={[
            { label: t("common.warehouse"), value: warehouseLabel(warehouseId) },
            { label: t("stockAdj.reason"), value: domainLabel(def) },
            { label: t("common.date"), value: <span className="mz-num">{selected.date}</span> },
            { label: t("stockAdj.lines"), value: <span className="mz-num">{selected.lines.length}</span> },
          ]}
          effects={effects.effects.map((e) => (
            <span key={e.description}>
              {e.description}
              {e.detail ? <span className="block text-[11.5px] text-ink-muted">{e.detail}</span> : null}
            </span>
          ))}
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
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("stockAdj.stockAdjustmentsCouldNotBe")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
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
          { label: t("stockAdj.totalAdjustments"), value: <span className="mz-num">{counts.all}</span> },
          { label: t("docStatus.draft"), value: <span className="mz-num">{counts.draft}</span> },
          { label: t("docStatus.confirmed"), value: <span className="mz-num">{counts.confirmed}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: counts.all },
          { key: "draft", label: t("docStatus.draft"), count: counts.draft },
          { key: "confirmed", label: t("docStatus.confirmed"), count: counts.confirmed },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("stockAdj.searchByAdjustmentNumber")}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <SelectField
              label={t("stockAdj.filter.reason")}
              value={reasonFilter}
              onChange={setReasonFilter}
              options={[
                { value: "", label: t("stockAdj.filter.allReasons") },
                ...ADJUSTMENT_REASON_DEFINITIONS.map((def) => ({ value: def.code, label: domainLabel(def) })),
              ]}
            />
            <SelectField
              label={t("stockAdj.filter.warehouse")}
              value={warehouseFilter}
              onChange={setWarehouseFilter}
              options={[
                { value: "", label: t("stockAdj.filter.allWarehouses") },
                ...warehouses.map((w) => ({ value: w.id, label: w.name })),
              ]}
            />
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{counts.all}</span> {t("stockAdj.adjustments")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("stockAdj.noMatchingAdjustments")}</div>}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Lines tab                                                            */
/* -------------------------------------------------------------------- */

function AdjustmentLinesTable({ doc, itemLabel }: { doc: StockAdjustmentDocumentDTO; itemLabel: (id: string) => string }) {
  const { t } = useAppTranslation();
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.direction")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.qty")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.costPrice")}</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("stockAdj.value")}</th>
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
                  <td className="px-[15px] py-[11px] text-end">{l.unitCost ? <MoneyDisplay value={Number(l.unitCost)} /> : "—"}</td>
                  <td className="px-[15px] py-[11px] text-end">{value !== null ? <MoneyDisplay value={value} /> : t("stockAdj.calculatedAtTheCurrentAverage")}</td>
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

function accountLabel(id: string, accounts: readonly AccountDTO[]): string {
  const account = accounts.find((a) => a.id === id);
  return account ? account.nameAr : id;
}

function AdjustmentGlTab({ docId }: { docId: string }) {
  const { t } = useAppTranslation();
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
                <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId, accounts)}</td>
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
  items,
  onDone,
  onBack,
}: {
  /** Prefills the first line, for "set opening balance" on an item row (R5.3). */
  initialItemId?: string | null;
  reason: AdjustmentReasonDefinition;
  warehouses: ReturnType<typeof useWarehouses>["data"];
  items: ReturnType<typeof useItems>["data"];
  onDone: () => void;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const { label: reasonLabelOf } = useDomainLabels();
  const reasonLabel = reasonLabelOf(reason);
  const createAdjustment = useCreateStockAdjustment();
  const confirmAdjustment = useConfirmStockAdjustment();
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses?.[0]?.id ?? "");
  const defaultDirection: StockMovementDirection = reason.direction === "OUT" ? "OUT" : "IN";
  const [lines, setLines] = useState<LineDraft[]>([
    initialItemId ? { ...blankLine(defaultDirection), itemId: initialItemId } : blankLine(defaultDirection),
  ]);
  const [error, setError] = useState<string | null>(null);

  const warehouseList = warehouses ?? [];
  const itemList = items ?? [];

  function warehouseLabel(id: string): string {
    return warehouseList.find((w) => w.id === id)?.name ?? id;
  }

  const itemOptions = useMemo(
    () => [{ value: "", label: t("stockAdj.chooseAnItem") }, ...itemList.filter((i) => i.type !== "service").map((i) => ({ value: i.id, label: i.nameAr }))],
    [itemList],
  );
  const warehouseOptions = useMemo(() => warehouseList.map((w) => ({ value: w.id, label: w.name })), [warehouseList]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine(defaultDirection)]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const allLinesValid = lines.every(
    (l) => l.itemId !== "" && l.qty > 0 && (l.direction === "OUT" || l.unitCost > 0),
  );
  const busy = createAdjustment.isPending || confirmAdjustment.isPending;
  const canPost = allLinesValid && warehouseId !== "" && !busy;

  async function handlePost() {
    if (!canPost) return;
    setError(null);
    try {
      const draft = await createAdjustment.mutateAsync({
        id: crypto.randomUUID(),
        date,
        memo: memo.trim() || `${reason.labelAr} — ${warehouseLabel(warehouseId)}`,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          warehouseId,
          reason: reason.code,
          direction: l.direction,
          qty: String(l.qty),
          unitCost: l.direction === "IN" ? String(l.unitCost) : undefined,
        })),
      });
      await confirmAdjustment.mutateAsync(draft.id);
      onDone();
    } catch (err) {
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
      <FulcrumRule />

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[16px]">
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-3">
            <TextField label={t("stockAdj.adjustmentDate")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <SelectField label={t("stockAdj.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} />
            <TextField label={t("common.notes")} value={memo} onChange={setMemo} placeholder={t("stockAdj.describeTheAdjustment")} />
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
                          aria-label={t("stockAdj.lineItem", { number: i + 1 })}
                          value={line.itemId}
                          onChange={(value) => updateLine(i, { itemId: value })}
                          options={itemOptions}
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
